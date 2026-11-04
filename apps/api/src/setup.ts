import { type INestApplication, type NestApplicationOptions, VersioningType } from '@nestjs/common'
import { DocumentBuilder, getSchemaPath, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'
import { SESSION_COOKIE } from './auth/session'
import { ProblemDetailsDto } from './common/problem.filter'
import { validationPipe } from './common/validation'

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

/**
 * Opções do Nest comuns ao servidor e aos testes. O encerramento fecha as conexões abertas: o fluxo
 * SSE nunca termina sozinho, e sem isto uma aba aberta segurava o docker stop até o SIGKILL. O
 * EventSource do navegador reconecta sozinho quando a API volta.
 */
export const NEST_OPTIONS = { forceCloseConnections: true } as const satisfies NestApplicationOptions

/** Configuração comum ao servidor, aos testes e à geração do OpenAPI. */
export function configureApp(app: INestApplication) {
  // Atrás de um único nginx, que sobrescreve o X-Forwarded-For com o IP da conexão. Confiar em
  // mais saltos deixaria o cliente escolher o próprio IP e escapar do limite de login. Isso só vale
  // para quem passa pelo nginx: quem conecta direto na porta da API (no Compose, 127.0.0.1:3000,
  // para operação) escolhe o X-Forwarded-For, e então o freio é o limite por e-mail.
  app.getHttpAdapter().getInstance().set('trust proxy', 1)
  app.use(cookieParser())
  app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready', 'metrics'] })
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalPipes(validationPipe())
  app.enableShutdownHooks()
}

export function buildOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Celsius 360 Lite')
    .setDescription(
      'API da versão reduzida do Celsius 360: visão da rede de lojas, detalhe de ambientes, tempo real e operação. ' +
        '"Agora" é sempre o horário do último pacote processado pela ingestão. ' +
        'Erros seguem a RFC 9457 (application/problem+json), com detail em português.',
    )
    .setVersion('1.0')
    .addCookieAuth(SESSION_COOKIE)
    .build()
  return documentProblems(SwaggerModule.createDocument(app, config, { extraModels: [ProblemDetailsDto] }))
}

/**
 * Todo erro sai do ProblemDetailsFilter: as respostas 4xx e 5xx passam a ter o corpo problem+json,
 * com 400 onde há parâmetros ou corpo e 401 onde a sessão é exigida.
 */
function documentProblems(document: OpenAPIObject): OpenAPIObject {
  const content = { 'application/problem+json': { schema: { $ref: getSchemaPath(ProblemDetailsDto) } } }
  for (const path of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = path[method]
      if (!operation) continue
      const { responses } = operation
      const hasInput =
        operation.requestBody !== undefined ||
        operation.parameters?.some((parameter) => 'in' in parameter && parameter.in === 'query')
      if (hasInput) {
        responses['400'] ??= { description: 'Parâmetro ou corpo inválido; errors[] diz qual e por quê' }
      }
      if (operation.security?.length) responses['401'] ??= { description: 'Sem sessão válida' }
      for (const [status, response] of Object.entries(responses)) {
        if (response && Number(status) >= 400 && !('$ref' in response)) response.content = content
      }
    }
  }
  return document
}

export function mountDocs(app: INestApplication) {
  SwaggerModule.setup('api/docs', app, buildOpenApi(app), {
    jsonDocumentUrl: 'api/docs/openapi.json',
    customSiteTitle: 'Celsius 360 Lite · API',
  })
}
