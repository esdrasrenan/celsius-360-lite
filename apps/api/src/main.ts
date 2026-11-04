import 'reflect-metadata'
import { Logger as NestLogger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module'
import { APP_CONFIG, type AppConfig, ConfigError, loadConfig } from './config'
import { configureApp, mountDocs, NEST_OPTIONS } from './setup'

async function bootstrap() {
  // Valida antes do Nest para sair com a lista do que corrigir, sem pilha de erro
  try {
    loadConfig()
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    console.error(error.message)
    process.exit(1)
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: true, ...NEST_OPTIONS })
  const logger = app.get(Logger)
  app.useLogger(logger)

  // Uma promise esquecida não pode derrubar a API (e, com ela, todas as conexões): só registra
  const processLogger = new NestLogger('Processo')
  process.on('unhandledRejection', (reason) =>
    processLogger.error(reason, 'promise rejeitada sem tratamento'),
  )
  process.on('uncaughtException', (error) => processLogger.error(error, 'exceção sem tratamento'))

  configureApp(app)
  mountDocs(app)

  const config = app.get<AppConfig>(APP_CONFIG)
  if (config.CORS_ORIGIN) app.enableCors({ origin: config.CORS_ORIGIN, credentials: true })
  if (config.generatedSecret) {
    logger.warn(
      'JWT_SECRET e JWT_SECRET_FILE vazios: o DEMO_MODE gerou um segredo temporário, e as sessões caem ' +
        'quando a API reinicia. Para mantê-las, defina JWT_SECRET (mínimo 32 caracteres) no .env.',
    )
  }

  await app.listen(config.PORT, '0.0.0.0')
  logger.log(`API em http://127.0.0.1:${config.PORT} (documentação em /api/docs)`)
}

void bootstrap()
