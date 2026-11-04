-- Visão da rede e detalhe do ambiente: distribuição acima e abaixo da faixa, abertos agora, próxima
-- abertura e pior ambiente gravados pela projeção; busca sem acento; índices alinhados às ordenações
-- da listagem; estatísticas do horário de funcionamento direto da série.
-- Aditiva: as colunas novas têm valor padrão, então um escritor que ainda não as conhece continua válido.
-- O primeiro ciclo de projeção depois da migração preenche os valores (a ingestão roda um ao subir).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent() é STABLE porque depende do dicionário em uso. Com o dicionário fixo, o resultado só
-- depende da entrada, e a função pode entrar em índice.
CREATE FUNCTION public.f_unaccent(text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  RETURN public.unaccent('public.unaccent'::regdictionary, $1);

-- Texto pesquisável sem acento, calculado na escrita (vale para qualquer escritor do cadastro). A API
-- busca cada termo com ILIKE nestas colunas: o índice trigrama atende aos termos de 3 letras ou mais,
-- e os mais curtos comparam o texto pronto, sem refazer o unaccent linha a linha.
ALTER TABLE registry.store ADD COLUMN search_text text GENERATED ALWAYS AS (
  public.f_unaccent(id || ' ' || name || ' ' || kind || ' ' || city || ' ' || state_code || ' ' || city || '/' || state_code)
) STORED;
ALTER TABLE registry.environment ADD COLUMN search_text text GENERATED ALWAYS AS (
  public.f_unaccent(name || ' ' || coalesce(device_id, ''))
) STORED;

CREATE INDEX store_search_idx ON registry.store USING gin (search_text gin_trgm_ops);
CREATE INDEX environment_search_idx ON registry.environment USING gin (search_text gin_trgm_ops);

-- Leituras válidas no horário de funcionamento: a temperatura no horário e o conforto por dia saem da
-- série com limites exatos, lendo só este índice (os agregados contínuos não separam o horário).
CREATE INDEX reading_valid_in_hours_idx ON telemetry.reading (device_id, ts) INCLUDE (value, comfort)
  WHERE quality = 0 AND in_hours;

ALTER TABLE state.environment_snapshot
  ADD COLUMN open_now boolean NOT NULL DEFAULT false,
  ADD COLUMN next_open_at timestamptz;

ALTER TABLE state.environment_indicator
  ADD COLUMN above_pct real,
  ADD COLUMN below_pct real;

ALTER TABLE state.store_snapshot
  ADD COLUMN store_name text,
  ADD COLUMN env_above integer NOT NULL DEFAULT 0,
  ADD COLUMN env_below integer NOT NULL DEFAULT 0,
  ADD COLUMN env_open_now integer NOT NULL DEFAULT 0,
  ADD COLUMN samples_above integer NOT NULL DEFAULT 0,
  ADD COLUMN samples_below integer NOT NULL DEFAULT 0,
  ADD COLUMN samples_expected integer NOT NULL DEFAULT 0,
  ADD COLUMN above_pct real,
  ADD COLUMN below_pct real,
  -- Só quando todos os ambientes da loja estão fechados agora
  ADD COLUMN next_open_at timestamptz,
  -- Ambiente de menor conforto no período (o desempate é o id)
  ADD COLUMN worst_env_id text REFERENCES registry.environment (id),
  ADD COLUMN worst_env_comfort real;

-- O nome da loja fica na própria projeção para a ordenação por nome (e o desempate das outras) usar
-- os índices abaixo. O gatilho o mantém igual ao cadastro, seja quem for que grave a linha.
CREATE FUNCTION state.store_snapshot_fill_name() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  SELECT name INTO NEW.store_name FROM registry.store WHERE id = NEW.store_id;
  RETURN NEW;
END
$$;

CREATE TRIGGER store_snapshot_fill_name BEFORE INSERT OR UPDATE ON state.store_snapshot
  FOR EACH ROW EXECUTE FUNCTION state.store_snapshot_fill_name();

UPDATE state.store_snapshot ss SET store_name = s.name FROM registry.store s WHERE s.id = ss.store_id;
ALTER TABLE state.store_snapshot ALTER COLUMN store_name SET NOT NULL;

-- Um índice por ordenação da visão da rede, com as mesmas colunas e direções do ORDER BY da API
DROP INDEX state.store_snapshot_period_comfort_idx;
DROP INDEX state.store_snapshot_period_status_idx;
CREATE INDEX store_snapshot_order_status_idx ON state.store_snapshot
  (period, status_rank DESC, env_out_of_range DESC, comfort_pct ASC NULLS LAST, store_name, store_id);
CREATE INDEX store_snapshot_order_comfort_idx ON state.store_snapshot
  (period, comfort_pct ASC NULLS LAST, store_name, store_id);
CREATE INDEX store_snapshot_order_comfort_desc_idx ON state.store_snapshot
  (period, comfort_pct DESC NULLS LAST, store_name, store_id);
CREATE INDEX store_snapshot_order_out_of_range_idx ON state.store_snapshot
  (period, env_out_of_range DESC, env_below_target DESC, store_name, store_id);
CREATE INDEX store_snapshot_order_worst_env_idx ON state.store_snapshot
  (period, worst_env_comfort ASC NULLS LAST, store_name, store_id);
CREATE INDEX store_snapshot_order_name_idx ON state.store_snapshot (period, store_name, store_id);
