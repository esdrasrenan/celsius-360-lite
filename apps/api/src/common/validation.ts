import { BadRequestException, ValidationPipe } from '@nestjs/common'
import type { ValidationError } from 'class-validator'

/** Mensagem por parâmetro, para quem chama a API e para a interface mostrarem sem tradução. */
const FIELD_MESSAGES: Record<string, string> = {
  period: 'Período inválido: use 1d, 7d ou 30d.',
  search: 'A busca aceita até 80 caracteres.',
  sort: 'Ordenação inválida: use status, comfort, comfort_desc, out_of_range, worst_env ou name.',
  status: 'Status inválido: use online, degraded, offline ou no_data, separados por vírgula.',
  clientId: 'Cliente inválido.',
  storeId: 'Loja inválida: informe o id exato, com até 64 caracteres.',
  belowTarget: 'belowTarget aceita só true ou false.',
  outOfRange: 'outOfRange aceita só true ou false.',
  page: 'A página precisa ser um número inteiro a partir de 1.',
  pageSize: 'O tamanho da página precisa ser um número inteiro de 1 a 100.',
  bucket: 'Agregação inválida: use auto, raw, 5m, 15m ou 1h.',
  from: 'Início inválido: use ISO 8601 com fuso, como 2026-02-10T00:00:00-03:00.',
  to: 'Fim inválido: use ISO 8601 com fuso, como 2026-02-10T23:59:59-03:00.',
  email: 'Informe um e-mail válido, com até 254 caracteres.',
  password: 'Informe a senha, com até 256 caracteres.',
}

function messageFor(error: ValidationError): string {
  // Parâmetro que o endpoint não aceita: o nome pode existir em outro endpoint, então vem antes
  if (error.constraints?.whitelistValidation) return `Parâmetro desconhecido: ${error.property}.`
  if (error.property === 'search' && error.constraints?.notContains) {
    return 'A busca não aceita o caractere nulo.'
  }
  return FIELD_MESSAGES[error.property] ?? `Valor inválido em ${error.property}.`
}

export function validationException(errors: ValidationError[]): BadRequestException {
  const fields = errors.map((error) => ({ field: error.property, message: messageFor(error) }))
  return new BadRequestException({ message: fields.map((field) => field.message).join(' '), errors: fields })
}

export const validationPipe = () =>
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: validationException,
  })
