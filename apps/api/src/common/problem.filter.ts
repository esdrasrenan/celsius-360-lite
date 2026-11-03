import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'
import type { Request, Response } from 'express'

/** Erros no formato RFC 9457 (application/problem+json), com o id da requisição para correlacionar no log. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name)

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp()
    const request = context.getRequest<Request & { id?: string }>()
    const response = context.getResponse<Response>()
    if (response.headersSent) return

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR
    const body = exception instanceof HttpException ? exception.getResponse() : null
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? (body as { message: string | string[] }).message
        : exception instanceof HttpException
          ? exception.message
          : 'Erro interno'

    if (status >= 500) this.logger.error(exception)

    response
      .status(status)
      .type('application/problem+json')
      .json({
        type: 'about:blank',
        title: HttpStatus[status] ?? 'Error',
        status,
        detail: Array.isArray(message) ? message.join('; ') : message,
        instance: request.originalUrl,
        requestId: request.id,
      })
  }
}
