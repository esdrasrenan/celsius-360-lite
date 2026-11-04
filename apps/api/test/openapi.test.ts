import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'
import { AppModule } from '../src/app.module'
import { buildOpenApi, configureApp } from '../src/setup'

let app: INestApplication
let document: OpenAPIObject

beforeAll(async () => {
  // Mesmo caminho do src/openapi.ts: sem banco, só rotas e esquemas
  app = await NestFactory.create(AppModule, { preview: true, logger: false, abortOnError: false })
  configureApp(app)
  document = buildOpenApi(app)
})

afterAll(async () => {
  await app?.close()
})

const responses = (path: string, method: 'get' | 'post' = 'get') =>
  document.paths[path]?.[method]?.responses ?? {}
const PROBLEM = { 'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetailsDto' } } }

describe('OpenAPI (P1 #31)', () => {
  test('erros em application/problem+json: 400 com parâmetros, 401 com sessão, 404 no ambiente', () => {
    expect(responses('/api/v1/stores')['400']).toMatchObject({ content: PROBLEM })
    expect(responses('/api/v1/stores')['401']).toMatchObject({ content: PROBLEM })
    expect(responses('/api/v1/environments/{id}/series')['404']).toMatchObject({ content: PROBLEM })
    expect(responses('/api/v1/auth/login', 'post')['429']).toMatchObject({ content: PROBLEM })
    // Sem parâmetros e pública: nada de 400 nem 401 inventados
    expect(Object.keys(responses('/health/live'))).toEqual(['200'])
    expect(document.components?.schemas?.ProblemDetailsDto).toMatchObject({
      required: expect.arrayContaining(['type', 'title', 'status', 'detail']),
    })
  })

  test('readiness com 200 descrito e SSE como text/event-stream', () => {
    expect(responses('/health/ready')['200']).toMatchObject({
      content: { 'application/json': { schema: { $ref: '#/components/schemas/ReadinessDto' } } },
    })
    const sse = responses('/api/v1/events')['200']
    expect(sse && 'content' in sse ? Object.keys(sse.content ?? {}) : []).toEqual(['text/event-stream'])
  })

  test('página e tamanho como inteiros', () => {
    const parameters = document.paths['/api/v1/stores']?.get?.parameters ?? []
    const types = Object.fromEntries(
      parameters.map((parameter) => [
        'name' in parameter ? parameter.name : '',
        'schema' in parameter ? parameter.schema : null,
      ]),
    )
    expect(types.page).toMatchObject({ type: 'integer' })
    expect(types.pageSize).toMatchObject({ type: 'integer' })
  })
})
