-- Cadastro: clientes, lojas, ambientes, dispositivos e usuários.
-- Volume pequeno, relações fortes e consistência transacional: modelo relacional clássico.

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE SCHEMA IF NOT EXISTS registry;
CREATE SCHEMA IF NOT EXISTS telemetry;
CREATE SCHEMA IF NOT EXISTS state;

CREATE TABLE registry.client (
  id text PRIMARY KEY,
  name text NOT NULL,
  segment text
);

CREATE TABLE registry.store (
  id text PRIMARY KEY,
  client_id text NOT NULL REFERENCES registry.client (id),
  name text NOT NULL,
  kind text NOT NULL,
  city text NOT NULL,
  state_code char(2) NOT NULL,
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  timezone text NOT NULL,
  -- {"seg": ["09:00", "20:00"], ..., "dom": null}, como no cadastro de origem
  opening_hours jsonb NOT NULL
);
CREATE INDEX store_client_idx ON registry.store (client_id);

CREATE TABLE registry.device (
  id text PRIMARY KEY
);

CREATE TABLE registry.environment (
  id text PRIMARY KEY,
  store_id text NOT NULL REFERENCES registry.store (id),
  name text NOT NULL,
  comfort_min real NOT NULL,
  comfort_max real NOT NULL,
  opening_hours jsonb NOT NULL,
  device_id text UNIQUE REFERENCES registry.device (id),
  CHECK (comfort_min < comfort_max)
);
CREATE INDEX environment_store_idx ON registry.environment (store_id);

CREATE TABLE registry.app_user (
  id text PRIMARY KEY,
  name text NOT NULL,
  email citext NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('admin_diel', 'gestor_cliente', 'gerente_loja')),
  client_id text REFERENCES registry.client (id),
  password_hash text,
  CHECK (role = 'admin_diel' OR client_id IS NOT NULL)
);

-- Lojas de um gerente (perfil gerente_loja)
CREATE TABLE registry.user_store (
  user_id text NOT NULL REFERENCES registry.app_user (id) ON DELETE CASCADE,
  store_id text NOT NULL REFERENCES registry.store (id),
  PRIMARY KEY (user_id, store_id)
);
