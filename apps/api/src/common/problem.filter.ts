import { STATUS_CODES } from 'node:http'
import type { ProblemDetails } from '@celsius/contracts'
import {
  type ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { requestIdFrom } from './request-id'

type FieldError = NonNullable<ProblemDetails['errors']>[number]

export class FieldErrorDto implements FieldError {
  @ApiProperty({ example: 'period' }) field: string
  @ApiProperty({ example: 'Período inválido: use 1d, 7d ou 30d.' }) message: string
}

export class ProblemDetailsDto implements ProblemDetails {
  @ApiProperty({ example: 'about:blank' }) type: string
  @ApiProperty({ example: 'Bad Request', description: 'Frase do status HTTP' }) title: string
  @ApiProperty({ type: 'integer', example: 400 }) status: number
  @ApiProperty({ example: 'Período inválido: use 1d, 7d ou 30d.', description: 'O que houve, em português' })
  detail: string
  @ApiPropertyOptional({ example: '/api/v1/stores?period=2d' }) instance?: string
  @ApiPropertyOptional({ description: 'Id da requisição no log; também no cabeçalho x-request-id' })
  requestId?: string
  @ApiPropertyOptional({ type: [FieldErrorDto], description: 'Um item por parâmetro inválido' })
  errors?: FieldErrorDto[]
}

/** Corpo que as exceções da API podem carregar além da mensagem. */
interface ExceptionBody {
  errors?: FieldError[]
  retryAfterSeconds?: number
}

/** 400 com o campo que causou o erro, no mesmo formato da validação dos DTOs. */
export function invalidField(field: string, message: string): BadRequestException {
  return new BadRequestException({ message, errors: [{ field, message }] })
}

/** Texto para quando a exceção não traz mensagem própria em português. */
const GENERIC_DETAIL: Record<number, string> = {
  400: 'Requisição inválida: confira os parâmetros e o corpo enviado.',
  401: 'Sessão ausente ou expirada.',
  403: 'Seu perfil não tem acesso a este recurso.',
  404: 'Recurso não encontrado.',
  413: 'O corpo da requisição passou do tamanho permitido.',
  415: 'Formato do corpo não suportado: envie JSON.',
  429: 'Muitas tentativas. Tente de novo em alguns minutos.',
  503: 'Serviço indisponível no momento. Tente de novo em instantes.',
}
const INTERNAL_DETAIL = 'Erro interno. Tente de novo em instantes.'
const TIMEOUT_DETAIL = 'A consulta passou do tempo limite. Tente de novo ou escolha um período menor.'
const DATABASE_DETAIL = 'O banco de dados não respondeu. Tente de novo em instantes.'

const codeOf = (exception: unknown) => (exception as { code?: unknown } | null)?.code

/** statement_timeout do Postgres (query_canceled): é sobrecarga, não defeito. */
const isQueryTimeout = (exception: unknown) => codeOf(exception) === '57014'

/**
 * Códigos de banco fora do ar ou recusando conexões: os do socket (inclusive o AggregateError de
 * um nome com dois endereços) e os SQLSTATE de desligamento, de "ainda subindo" e de excesso de
 * conexões. A classe 08 inteira é falha de conexão.
 */
const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  '57P01',
  '57P02',
  '57P03',
  '53300',
])

/** Banco indisponível é 503 (tente de novo), não 500 (defeito) nem 401 (sessão). */
export function isDatabaseUnavailable(exception: unknown): boolean {
  const code = codeOf(exception)
  if (typeof code === 'string' && (UNAVAILABLE_CODES.has(code) || code.startsWith('08'))) return true
  // O pg não põe código no tempo de conexão esgotado nem na conexão que caiu no meio da consulta
  const message = exception instanceof Error ? exception.message : ''
  return /timeout exceeded when trying to connect|Connection terminated/.test(message)
}

function statusOf(exception: unknown): number {
  if (exception instanceof HttpException) return exception.getStatus()
  return isQueryTimeout(exception) || isDatabaseUnavailable(exception)
    ? HttpStatus.SERVICE_UNAVAILABLE
    : HttpStatus.INTERNAL_SERVER_ERROR
}

function detailOf(exception: unknown, status: number, request: Request): string {
  if (isQueryTimeout(exception)) return TIMEOUT_DETAIL
  if (isDatabaseUnavailable(exception)) return DATABASE_DETAIL
  const generic =
    GENERIC_DETAIL[status] ?? (status >= 500 ? INTERNAL_DETAIL : (GENERIC_DETAIL[400] as string))
  if (!(exception instanceof HttpException)) return generic
  // Sem rota (JSON malformado, corpo grande demais) a mensagem vem do Express, em inglês; a rota
  // inexistente passa pela rota curinga do Nest, que responde "Cannot GET /x"
  if (request.route === undefined || exception.message.startsWith('Cannot ')) return generic
  // Sem mensagem própria, o Nest usa a frase do status em inglês ("Not Found")
  return exception.message && exception.message !== STATUS_CODES[status] ? exception.message : generic
}

/**
 * Erros no formato RFC 9457 (application/problem+json), com detail sempre em português e o id da
 * requisição para correlacionar no log.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp()
    const request = context.getRequest<Request & { id?: string }>()
    const response = context.getResponse<Response>()
    if (response.headersSent) return

    const status = statusOf(exception)
    if (status >= 500) this.logger.error(exception)
    if (isDatabaseUnavailable(exception)) response.setHeader('retry-after', '5')
    const payload = exception instanceof HttpException ? exception.getResponse() : null
    const extra: ExceptionBody = typeof payload === 'object' && payload !== null ? payload : {}

    // Erros do body-parser chegam antes do pino-http, que é quem atribui o id
    const requestId = request.id ?? requestIdFrom(request.header('x-request-id'))
    if (!response.getHeader('x-request-id')) response.setHeader('x-request-id', requestId)
    if (extra.retryAfterSeconds) response.setHeader('retry-after', String(extra.retryAfterSeconds))

    const problem: ProblemDetails = {
      type: 'about:blank',
      title: STATUS_CODES[status] ?? 'Error',
      status,
      detail: detailOf(exception, status, request),
      instance: request.originalUrl,
      requestId,
      ...(extra.errors?.length ? { errors: extra.errors } : {}),
    }
    response.status(status).type('application/problem+json').json(problem)
  }
}
