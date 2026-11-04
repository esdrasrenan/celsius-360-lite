import { randomUUID } from 'node:crypto'

const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/

/**
 * Id de correlação: o x-request-id recebido, se for curto e simples; senão, um UUID novo. O valor
 * volta no cabeçalho, no corpo dos erros e em cada linha de log, então não pode ser arbitrário.
 */
export const requestIdFrom = (value: unknown): string =>
  typeof value === 'string' && REQUEST_ID.test(value) ? value : randomUUID()
