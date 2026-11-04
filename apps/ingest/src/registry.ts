import {
  type ComfortRange,
  type CompiledSchedule,
  compileSchedule,
  type OpeningHours,
  timeZoneOffsetMs,
} from '@celsius/domain'
import type pg from 'pg'
import { z } from 'zod'
import type { Logger } from './infra'

const window = z.tuple([z.string(), z.string()]).nullable()
const openingHoursSchema = z.object({
  seg: window,
  ter: window,
  qua: window,
  qui: window,
  sex: window,
  sab: window,
  dom: window,
})

/** Formato do cadastro.json recebido, validado antes de entrar no banco. */
export const registryFileSchema = z
  .object({
    clientes: z.array(z.object({ id: z.string(), nome: z.string(), segmento: z.string().nullish() })),
    lojas: z.array(
      z.object({
        id: z.string(),
        cliente_id: z.string(),
        nome: z.string(),
        tipo: z.string(),
        cidade: z.string(),
        uf: z.string().length(2),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        fuso_horario: z.string(),
        horario_funcionamento: openingHoursSchema,
      }),
    ),
    ambientes: z.array(
      z.object({
        id: z.string(),
        loja_id: z.string(),
        nome: z.string(),
        faixa_conforto_c: z.object({ min: z.number(), max: z.number() }),
        horario_funcionamento: openingHoursSchema,
        dev_id: z.string(),
      }),
    ),
    usuarios: z.array(
      z.object({
        id: z.string(),
        nome: z.string(),
        email: z.email(),
        perfil: z.enum(['admin_diel', 'gestor_cliente', 'gerente_loja']),
        cliente_id: z.string().nullable(),
        lojas: z.array(z.string()).nullable(),
      }),
    ),
  })
  .superRefine((registry, ctx) => {
    const clients = new Set(registry.clientes.map((client) => client.id))
    const stores = new Set(registry.lojas.map((store) => store.id))
    const devices = new Set<string>()
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })

    for (const store of registry.lojas) {
      if (!clients.has(store.cliente_id)) issue(`Loja ${store.id}: cliente ${store.cliente_id} não existe`)
      try {
        timeZoneOffsetMs(Date.now(), store.fuso_horario)
        compileSchedule(store.horario_funcionamento as OpeningHours)
      } catch (error) {
        issue(`Loja ${store.id}: ${(error as Error).message}`)
      }
    }
    for (const environment of registry.ambientes) {
      if (!stores.has(environment.loja_id))
        issue(`Ambiente ${environment.id}: loja ${environment.loja_id} não existe`)
      if (environment.faixa_conforto_c.min >= environment.faixa_conforto_c.max)
        issue(`Ambiente ${environment.id}: faixa de conforto inválida`)
      if (devices.has(environment.dev_id)) issue(`Dispositivo ${environment.dev_id} em mais de um ambiente`)
      devices.add(environment.dev_id)
      try {
        compileSchedule(environment.horario_funcionamento as OpeningHours)
      } catch (error) {
        issue(`Ambiente ${environment.id}: ${(error as Error).message}`)
      }
    }
    for (const user of registry.usuarios) {
      if (user.perfil !== 'admin_diel' && (!user.cliente_id || !clients.has(user.cliente_id)))
        issue(`Usuário ${user.id}: perfil ${user.perfil} exige cliente válido`)
      if (user.perfil === 'gerente_loja' && !user.lojas?.length)
        issue(`Usuário ${user.id}: gerente sem lojas`)
      for (const store of user.lojas ?? [])
        if (!stores.has(store)) issue(`Usuário ${user.id}: loja ${store} não existe`)
    }
  })

export type RegistryFile = z.infer<typeof registryFileSchema>

/** Cliente das lojas de carga (comando rede-sintetica): a ingestão e o relatório de qualidade as ignoram. */
export const SYNTHETIC_CLIENT_ID = 'CLI-SINT'

type Role = RegistryFile['usuarios'][number]['perfil']

const ROLE_LABEL: Record<Role, string> = {
  admin_diel: 'Administrador Diel',
  gestor_cliente: 'Gestor do cliente',
  gerente_loja: 'Gerente de loja',
}

export const PASSWORD_RESET_HINT =
  'Os usuários já têm senha de uma subida anterior. Para redefinir: defina DEMO_PASSWORD no .env (mínimo 8 caracteres) e rode docker compose up -d.'

/** O que o setup mostra no fim: onde abrir, com quem entrar e de onde vem a senha. */
export interface DemoAccess {
  users: Array<{ email: string; role: Role }>
  passwordFromEnv: boolean
  /** Senha gerada nesta execução, para quem ainda não tinha uma; só aparece aqui */
  generatedPassword: string | null
  /** Usuários que mantiveram a senha de uma subida anterior */
  previousPasswords: number
}

/** Quadro em texto puro (fora do JSON do log), fácil de achar em `docker compose logs setup`. */
export function formatAccess(access: DemoAccess, appUrl: string): string {
  const width = Math.max(...access.users.map((user) => user.email.length))
  const users = access.users.map((user) => `${user.email.padEnd(width)}  ${ROLE_LABEL[user.role]}`)
  const password = access.passwordFromEnv
    ? ['a DEMO_PASSWORD do arquivo .env']
    : [
        ...(access.generatedPassword
          ? [
              `${access.generatedPassword} (gerada agora e mostrada só desta vez; anote ou defina DEMO_PASSWORD no .env)`,
            ]
          : []),
        ...(access.previousPasswords > 0 ? [PASSWORD_RESET_HINT] : []),
      ]
  const rows = (label: string, lines: string[]) =>
    lines.map((line, index) => `  ${(index === 0 ? label : '').padEnd(10)} ${line}`)
  return [
    '',
    'Celsius 360 Lite: acesso',
    ...rows('Aplicação', [appUrl]),
    ...rows('Usuários', users),
    ...rows('Senha', password),
    '',
  ].join('\n')
}

function generatePassword(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (byte) => alphabet[byte % alphabet.length],
  ).join('')
}

/**
 * Grava o cadastro de forma idempotente (upsert por id). Senhas não vêm do cadastro nem do repositório:
 * se DEMO_PASSWORD estiver definida, todos os usuários de demonstração passam a usá-la (a cada setup,
 * então ela também serve para redefinir uma senha perdida); senão, quem ainda não tem senha recebe
 * uma aleatória, mostrada uma única vez no quadro de acesso.
 */
export async function seedRegistry(
  pool: pg.Pool,
  registry: RegistryFile,
  demoPassword: string | undefined,
  logger: Logger,
): Promise<DemoAccess> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const item of registry.clientes) {
      await client.query(
        `INSERT INTO registry.client (id, name, segment) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, segment = EXCLUDED.segment`,
        [item.id, item.nome, item.segmento ?? null],
      )
    }
    for (const store of registry.lojas) {
      await client.query(
        `INSERT INTO registry.store (id, client_id, name, kind, city, state_code, latitude, longitude, timezone, opening_hours)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET client_id = EXCLUDED.client_id, name = EXCLUDED.name, kind = EXCLUDED.kind,
           city = EXCLUDED.city, state_code = EXCLUDED.state_code, latitude = EXCLUDED.latitude,
           longitude = EXCLUDED.longitude, timezone = EXCLUDED.timezone, opening_hours = EXCLUDED.opening_hours`,
        [
          store.id,
          store.cliente_id,
          store.nome,
          store.tipo,
          store.cidade,
          store.uf,
          store.latitude,
          store.longitude,
          store.fuso_horario,
          JSON.stringify(store.horario_funcionamento),
        ],
      )
    }
    for (const environment of registry.ambientes) {
      await client.query('INSERT INTO registry.device (id) VALUES ($1) ON CONFLICT DO NOTHING', [
        environment.dev_id,
      ])
      await client.query(
        `INSERT INTO registry.environment (id, store_id, name, comfort_min, comfort_max, opening_hours, device_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET store_id = EXCLUDED.store_id, name = EXCLUDED.name,
           comfort_min = EXCLUDED.comfort_min, comfort_max = EXCLUDED.comfort_max,
           opening_hours = EXCLUDED.opening_hours, device_id = EXCLUDED.device_id`,
        [
          environment.id,
          environment.loja_id,
          environment.nome,
          environment.faixa_conforto_c.min,
          environment.faixa_conforto_c.max,
          JSON.stringify(environment.horario_funcionamento),
          environment.dev_id,
        ],
      )
    }

    for (const user of registry.usuarios) {
      await client.query(
        `INSERT INTO registry.app_user (id, name, email, role, client_id) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role,
           client_id = EXCLUDED.client_id`,
        [user.id, user.nome, user.email, user.perfil, user.cliente_id],
      )
      await client.query('DELETE FROM registry.user_store WHERE user_id = $1', [user.id])
      for (const store of user.lojas ?? []) {
        await client.query('INSERT INTO registry.user_store (user_id, store_id) VALUES ($1, $2)', [
          user.id,
          store,
        ])
      }
    }
    // Senha escolhida vale para todos; sem ela, só quem ainda não tem senha recebe uma gerada
    const { rows: users } = await client.query<{ id: string; has_password: boolean }>(
      'SELECT id, password_hash IS NOT NULL AS has_password FROM registry.app_user',
    )
    const target = users.filter((user) => demoPassword || !user.has_password).map((user) => user.id)
    const generatedPassword = target.length > 0 && !demoPassword ? generatePassword() : null
    const password = demoPassword ?? generatedPassword
    if (password) {
      const hash = await Bun.password.hash(password, { algorithm: 'argon2id' })
      await client.query('UPDATE registry.app_user SET password_hash = $1 WHERE id = ANY($2)', [hash, target])
    }
    await client.query('COMMIT')

    logger.info(
      {
        clients: registry.clientes.length,
        stores: registry.lojas.length,
        environments: registry.ambientes.length,
        users: registry.usuarios.length,
      },
      'cadastro gravado',
    )
    const previousPasswords = users.length - target.length
    if (generatedPassword)
      logger.info({ users: target.length }, 'senha de demonstração gerada (veja o quadro de acesso)')
    if (previousPasswords > 0) logger.warn(PASSWORD_RESET_HINT)
    return {
      users: registry.usuarios.map((user) => ({ email: user.email, role: user.perfil })),
      passwordFromEnv: demoPassword !== undefined,
      generatedPassword,
      previousPasswords,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export interface EnvironmentContext {
  environmentId: string
  storeId: string
  clientId: string
  deviceId: string | null
  range: ComfortRange
  schedule: CompiledSchedule
  timeZone: string
}

/** Contexto que a ingestão consulta a cada amostra, carregado do banco uma vez por execução. */
export async function loadEnvironments(pool: pg.Pool): Promise<EnvironmentContext[]> {
  const { rows } = await pool.query<{
    id: string
    store_id: string
    client_id: string
    device_id: string | null
    comfort_min: number
    comfort_max: number
    opening_hours: OpeningHours
    timezone: string
  }>(
    `SELECT e.id, e.store_id, s.client_id, e.device_id, e.comfort_min, e.comfort_max, e.opening_hours, s.timezone
     FROM registry.environment e JOIN registry.store s ON s.id = e.store_id
     WHERE s.client_id <> $1
     ORDER BY e.id`,
    [SYNTHETIC_CLIENT_ID],
  )
  return rows.map((row) => ({
    environmentId: row.id,
    storeId: row.store_id,
    clientId: row.client_id,
    deviceId: row.device_id,
    range: { min: row.comfort_min, max: row.comfort_max },
    schedule: compileSchedule(row.opening_hours),
    timeZone: row.timezone,
  }))
}
