-- Dado cru: cada pacote exatamente como chegou, na ordem de chegada.
-- Append-only, imutável e de alto volume (20 GB/dia em produção): armazenamento colunar,
-- compressão ZSTD e partição mensal por horário do pacote.
-- A chave (source, seq) identifica a posição na fonte; reprocessar a mesma fonte não duplica
-- (a ingestão pula o que já existe e o ReplacingMergeTree colapsa eventuais repetições).

CREATE DATABASE IF NOT EXISTS raw;

CREATE TABLE IF NOT EXISTS raw.telemetry_packet
(
    source       LowCardinality(String),
    seq          UInt64,
    received_at  DateTime64(3, 'UTC'),
    device_id    LowCardinality(String),
    sent_at      Nullable(DateTime('UTC')),
    gmt_offset   Nullable(Int8),
    sampling_s   Nullable(UInt16),
    saved_data   Bool,
    samples      Array(Float32),
    payload      String CODEC(ZSTD(3)),
    payload_hash UInt64,
    valid        Bool,
    error        LowCardinality(String),
    INDEX idx_device device_id TYPE bloom_filter GRANULARITY 4,
    INDEX idx_sent sent_at TYPE minmax GRANULARITY 4
)
ENGINE = ReplacingMergeTree(received_at)
PARTITION BY toYYYYMM(ifNull(sent_at, toDateTime(0, 'UTC')))
ORDER BY (source, seq);
