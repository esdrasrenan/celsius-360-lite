import type { ProblemDetails } from '@celsius/contracts'

type QueryValue = string | number | boolean | readonly string[] | null | undefined

/**
 * Erro da API. Carrega o status HTTP (0 quando a requisição nem chegou ao servidor), o corpo
 * problem+json e o requestId, que a interface mostra em "Detalhes técnicos" para o suporte.
 */
export class ApiError extends Error {
  readonly status: number
  readonly problem: ProblemDetails | null
  readonly requestId: string | null

  constructor(
    status: number,
    message: string,
    problem: ProblemDetails | null = null,
    requestId: string | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.problem = problem
    this.requestId = requestId ?? problem?.requestId ?? null
  }
}

export function buildPath(path: string, query?: Record<string, QueryValue>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    params.set(key, Array.isArray(value) ? value.join(',') : String(value))
  }
  const search = params.toString()
  return `/api/v1${path}${search ? `?${search}` : ''}`
}

async function readProblem(response: Response): Promise<ProblemDetails | null> {
  try {
    const body = (await response.json()) as Partial<ProblemDetails> | null
    return body && typeof body === 'object' && typeof body.status === 'number'
      ? (body as ProblemDetails)
      : null
  } catch {
    return null
  }
}

export async function api<T>(
  path: string,
  options: { query?: Record<string, QueryValue>; method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(buildPath(path, options.query), {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    // Cancelamento é do React Query; falha de rede vira status 0 para a interface saber o que dizer
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'Sem conexão com a API.')
  }
  if (!response.ok) {
    const problem = await readProblem(response)
    throw new ApiError(
      response.status,
      problem?.detail || problem?.title || response.statusText,
      problem,
      response.headers.get('x-request-id'),
    )
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}
