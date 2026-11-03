import { type INestApplication, ValidationPipe, VersioningType } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import cookieParser from 'cookie-parser'
import { SESSION_COOKIE } from './auth/session'

/** Configuração comum ao servidor, aos testes e à geração do OpenAPI. */
export function configureApp(app: INestApplication) {
  // Atrás do nginx: IP real e protocolo vêm dos cabeçalhos X-Forwarded-* da rede interna
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback, linklocal, uniquelocal')
  app.use(cookieParser())
  app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready', 'metrics'] })
  app.enableVersioning({ type: VersioningType.URI })
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  app.enableShutdownHooks()
}

export function buildOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Celsius 360 Lite')
    .setDescription(
      'API da versão reduzida do Celsius 360: visão da rede de lojas, detalhe de ambientes, tempo real e operação. ' +
        '"Agora" é sempre o horário do último pacote processado pela ingestão.',
    )
    .setVersion('1.0')
    .addCookieAuth(SESSION_COOKIE)
    .build()
  return SwaggerModule.createDocument(app, config)
}

export function mountDocs(app: INestApplication) {
  SwaggerModule.setup('api/docs', app, buildOpenApi(app), {
    jsonDocumentUrl: 'api/docs/openapi.json',
    customSiteTitle: 'Celsius 360 Lite · API',
  })
}
