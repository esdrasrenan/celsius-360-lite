-- Série tratada: uma linha por amostra (dispositivo, instante), já classificada.
-- Hypertable particionada por dia; agregados contínuos em 5 min, 15 min e 1 h.
--
-- quality: 0 válida, 1 código de erro do sensor (-127/85), 2 fora da faixa física,
--          3 pico isolado, 4 sensor travado (valor idêntico por 60 min ou mais)
-- in_hours: amostra dentro do horário de funcionamento do ambiente (fuso da loja)
-- comfort: -1 abaixo, 0 dentro, 1 acima da faixa; preenchido só para amostra válida no horário

CREATE TABLE telemetry.reading (
  device_id text NOT NULL,
  ts timestamptz NOT NULL,
  value real NOT NULL,
  quality smallint NOT NULL CHECK (quality BETWEEN 0 AND 4),
  in_hours boolean NOT NULL,
  comfort smallint CHECK (comfort BETWEEN -1 AND 1),
  PRIMARY KEY (device_id, ts)
);

SELECT create_hypertable('telemetry.reading', by_range('ts', INTERVAL '1 day'));

ALTER TABLE telemetry.reading SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'device_id',
  timescaledb.compress_orderby = 'ts'
);

CREATE MATERIALIZED VIEW telemetry.reading_5m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  device_id,
  time_bucket(INTERVAL '5 minutes', ts) AS bucket,
  count(*) AS samples,
  sum(CASE WHEN quality = 0 THEN 1 ELSE 0 END) AS samples_ok,
  sum(CASE WHEN quality = 0 THEN value ELSE 0 END)::double precision AS value_sum,
  min(CASE WHEN quality = 0 THEN value END) AS value_min,
  max(CASE WHEN quality = 0 THEN value END) AS value_max,
  sum(CASE WHEN quality = 0 AND in_hours THEN 1 ELSE 0 END) AS in_hours,
  sum(CASE WHEN comfort = 0 THEN 1 ELSE 0 END) AS within,
  sum(CASE WHEN comfort = 1 THEN 1 ELSE 0 END) AS above,
  sum(CASE WHEN comfort = -1 THEN 1 ELSE 0 END) AS below,
  sum(CASE WHEN quality = 1 THEN 1 ELSE 0 END) AS sensor_error,
  sum(CASE WHEN quality = 2 THEN 1 ELSE 0 END) AS out_of_range,
  sum(CASE WHEN quality = 3 THEN 1 ELSE 0 END) AS spike,
  sum(CASE WHEN quality = 4 THEN 1 ELSE 0 END) AS stuck
FROM telemetry.reading
GROUP BY device_id, bucket
WITH NO DATA;

CREATE MATERIALIZED VIEW telemetry.reading_15m
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  device_id,
  time_bucket(INTERVAL '15 minutes', bucket) AS bucket,
  sum(samples) AS samples,
  sum(samples_ok) AS samples_ok,
  sum(value_sum) AS value_sum,
  min(value_min) AS value_min,
  max(value_max) AS value_max,
  sum(in_hours) AS in_hours,
  sum(within) AS within,
  sum(above) AS above,
  sum(below) AS below,
  sum(sensor_error) AS sensor_error,
  sum(out_of_range) AS out_of_range,
  sum(spike) AS spike,
  sum(stuck) AS stuck
FROM telemetry.reading_5m
GROUP BY device_id, time_bucket(INTERVAL '15 minutes', bucket)
WITH NO DATA;

CREATE MATERIALIZED VIEW telemetry.reading_1h
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  device_id,
  time_bucket(INTERVAL '1 hour', bucket) AS bucket,
  sum(samples) AS samples,
  sum(samples_ok) AS samples_ok,
  sum(value_sum) AS value_sum,
  min(value_min) AS value_min,
  max(value_max) AS value_max,
  sum(in_hours) AS in_hours,
  sum(within) AS within,
  sum(above) AS above,
  sum(below) AS below,
  sum(sensor_error) AS sensor_error,
  sum(out_of_range) AS out_of_range,
  sum(spike) AS spike,
  sum(stuck) AS stuck
FROM telemetry.reading_15m
GROUP BY device_id, time_bucket(INTERVAL '1 hour', bucket)
WITH NO DATA;

-- Temperatura externa horária (Open-Meteo), uma série por loja
CREATE TABLE telemetry.outdoor_temperature (
  store_id text NOT NULL REFERENCES registry.store (id),
  ts timestamptz NOT NULL,
  value real NOT NULL,
  source text NOT NULL,
  PRIMARY KEY (store_id, ts)
);
