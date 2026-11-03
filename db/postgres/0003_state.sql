-- Estado e projeções de leitura, mantidos pela ingestão (lado de escrita) e lidos pela API.
-- "Agora" é o horário do pacote mais recente processado (state.ingestion.now_ts), nunca o relógio do servidor.

CREATE TABLE state.ingestion (
  source text PRIMARY KEY,
  last_seq bigint NOT NULL DEFAULT 0,
  now_ts timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE state.device (
  device_id text PRIMARY KEY,
  -- "agora" no momento em que o último pacote do dispositivo foi processado (chegada)
  last_contact_at timestamptz NOT NULL,
  -- amostra mais recente recebida, de qualquer qualidade
  last_sample_at timestamptz NOT NULL,
  last_valid_at timestamptz,
  last_valid_value real
);

-- Dispositivos que enviaram dados mas não constam no cadastro (quarentena)
CREATE TABLE state.unknown_device (
  device_id text PRIMARY KEY,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);

CREATE TABLE state.environment_snapshot (
  environment_id text PRIMARY KEY REFERENCES registry.environment (id),
  status text NOT NULL CHECK (status IN ('online', 'sensor_fault', 'offline', 'no_data')),
  situation text NOT NULL CHECK (situation IN ('within', 'above', 'below', 'closed', 'unknown')),
  last_value real,
  last_valid_at timestamptz,
  last_contact_at timestamptz,
  now_ts timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE state.environment_indicator (
  environment_id text NOT NULL REFERENCES registry.environment (id),
  period text NOT NULL CHECK (period IN ('1d', '7d', '30d')),
  from_ts timestamptz NOT NULL,
  to_ts timestamptz NOT NULL,
  samples_in_hours integer NOT NULL,
  samples_within integer NOT NULL,
  samples_above integer NOT NULL,
  samples_below integer NOT NULL,
  samples_expected integer NOT NULL,
  samples_discarded integer NOT NULL,
  value_avg real,
  value_min real,
  value_max real,
  comfort_pct real,
  coverage_pct real,
  PRIMARY KEY (environment_id, period)
);

-- Uma linha por loja e período: alimenta a visão da rede com filtro, ordenação e paginação no banco
CREATE TABLE state.store_snapshot (
  store_id text NOT NULL REFERENCES registry.store (id),
  period text NOT NULL CHECK (period IN ('1d', '7d', '30d')),
  status text NOT NULL CHECK (status IN ('online', 'degraded', 'offline', 'no_data')),
  status_rank smallint NOT NULL,
  environments integer NOT NULL,
  env_online integer NOT NULL,
  env_sensor_fault integer NOT NULL,
  env_offline integer NOT NULL,
  env_no_data integer NOT NULL,
  env_out_of_range integer NOT NULL,
  env_below_target integer NOT NULL,
  samples_in_hours integer NOT NULL,
  samples_within integer NOT NULL,
  comfort_pct real,
  coverage_pct real,
  now_ts timestamptz,
  PRIMARY KEY (store_id, period)
);
CREATE INDEX store_snapshot_period_comfort_idx ON state.store_snapshot (period, comfort_pct);
CREATE INDEX store_snapshot_period_status_idx ON state.store_snapshot (period, status_rank DESC);

-- Relatório de qualidade dos dados, recalculado pela ingestão a partir do dado cru e da série tratada
CREATE TABLE state.quality_report (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  generated_at timestamptz NOT NULL,
  report jsonb NOT NULL
);
