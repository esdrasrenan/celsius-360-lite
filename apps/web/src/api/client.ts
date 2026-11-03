type QueryValue = string | number | boolean | string[] | null | undefined

/** Erro da API no formato problem+json, com o status HTTP para a interface decidir o que mostrar. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export function buildPath(path: string, query?: Record<string, QueryValue>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, Array.isArray(value) ? value.join(',') : String(value))
  }
  const search = params.toString()
  return `/api/v1${path}${search ? `?${search}` : ''}`
}

export async function api<T>(
  path: string,
  options: { query?: Record<string, QueryValue>; method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch(buildPath(path, options.query), {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  })
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new ApiError(response.status, problem?.detail ?? response.statusText)
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}
