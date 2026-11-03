import 'reflect-metadata'
import { resolve } from 'node:path'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { buildOpenApi, configureApp } from './setup'

// Gera openapi.json sem banco: o modo preview registra rotas e esquemas sem instanciar os providers
const app = await NestFactory.create(AppModule, { preview: true, logger: false, abortOnError: false })
configureApp(app)
const document = buildOpenApi(app)
const target = resolve(import.meta.dir, '../openapi.json')
await Bun.write(target, `${JSON.stringify(document, null, 2)}\n`)
console.info(`OpenAPI gerado em ${target}`)
await app.close()
