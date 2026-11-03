import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module'
import { APP_CONFIG, type AppConfig } from './config'
import { configureApp, mountDocs } from './setup'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  const logger = app.get(Logger)
  app.useLogger(logger)
  configureApp(app)
  mountDocs(app)

  const config = app.get<AppConfig>(APP_CONFIG)
  if (config.CORS_ORIGIN) app.enableCors({ origin: config.CORS_ORIGIN, credentials: true })
  if (config.generatedSecret)
    logger.warn('JWT_SECRET não definido: segredo aleatório gerado; sessões caem ao reiniciar')

  await app.listen(config.PORT, '0.0.0.0')
  logger.log(`API em http://localhost:${config.PORT} (documentação em /api/docs)`)
}

void bootstrap()
