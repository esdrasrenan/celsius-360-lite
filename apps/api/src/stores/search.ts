export const MAX_SEARCH_TERMS = 5

/**
 * Termos da busca da visão da rede, prontos para `ILIKE ... ESCAPE '\'`: sem acento, em minúsculas,
 * sem caracteres de controle, no máximo cinco (combinados com AND) e com os curingas do LIKE
 * escapados, para "%" e "_" valerem como texto.
 */
export function searchPatterns(search: string | undefined): string[] {
  if (!search) return []
  return search
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\p{Cc}/gu, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TERMS)
    .map((term) => `%${term.replace(/[\\%_]/g, '\\$&')}%`)
}

/**
 * A loja casa com o termo pelo próprio texto (id, nome, tipo, cidade, UF e "cidade/UF"), pelo nome
 * do cliente ou por um dos ambientes (nome ou dispositivo). Cada ramo usa o índice trigrama da
 * coluna search_text correspondente (migração 0004).
 */
export function storeMatches(param: string): string {
  return `ss.store_id IN (
    SELECT id FROM registry.store WHERE search_text ILIKE ${param} ESCAPE '\\'
    UNION ALL
    SELECT store_id FROM registry.environment WHERE search_text ILIKE ${param} ESCAPE '\\'
    UNION ALL
    SELECT st.id FROM registry.store st JOIN registry.client cl ON cl.id = st.client_id
    WHERE public.f_unaccent(cl.name) ILIKE ${param} ESCAPE '\\')`
}
