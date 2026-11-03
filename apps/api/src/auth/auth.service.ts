import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { jwtVerify, SignJWT } from 'jose'
import type pg from 'pg'
import { APP_CONFIG, type AppConfig } from '../config'
import { PG_POOL } from '../database/database.module'
import type { Role, SessionUser } from './session'

const MAX_FAILURES = 5
const LOCK_MS = 5 * 60_000
const SCOPE_CACHE_MS = 30_000

interface UserRow {
  id: string
  name: string
  email: string
  role: Role
  client_id: string | null
  password_hash: string | null
  store_ids: string[] | null
}

const USER_QUERY = `
  SELECT u.id, u.name, u.email::text AS email, u.role, u.client_id, u.password_hash,
    CASE
      WHEN u.role = 'admin_diel' THEN NULL
      WHEN u.role = 'gestor_cliente' THEN
        (SELECT coalesce(array_agg(s.id ORDER BY s.id), '{}') FROM registry.store s WHERE s.client_id = u.client_id)
      ELSE (SELECT coalesce(array_agg(us.store_id ORDER BY us.store_id), '{}') FROM registry.user_store us WHERE us.user_id = u.id)
    END AS store_ids
  FROM registry.app_user u`

@Injectable()
export class AuthService {
  private readonly key: Uint8Array
  private readonly failures = new Map<string, { count: number; until: number }>()
  private readonly cache = new Map<string, { user: SessionUser; expires: number }>()
  // Hash de referência para responder no mesmo tempo quando o e-mail não existe
  private readonly dummyHash = Bun.password.hash(crypto.randomUUID(), { algorithm: 'argon2id' })

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.key = new TextEncoder().encode(config.JWT_SECRET)
  }

  async login(email: string, password: string, ip: string): Promise<{ user: SessionUser; token: string }> {
    const attemptKey = `${email.toLowerCase()}|${ip}`
    const failure = this.failures.get(attemptKey)
    if (failure && failure.count >= MAX_FAILURES && failure.until > Date.now()) {
      throw new HttpException(
        'Muitas tentativas. Tente de novo em alguns minutos.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    const { rows } = await this.pool.query<UserRow>(`${USER_QUERY} WHERE u.email = $1`, [email])
    const row = rows[0]
    const valid = await Bun.password.verify(password, row?.password_hash ?? (await this.dummyHash))
    if (!row?.password_hash || !valid) {
      const count = (failure && failure.until > Date.now() ? failure.count : 0) + 1
      this.failures.set(attemptKey, { count, until: Date.now() + LOCK_MS })
      throw new UnauthorizedException('E-mail ou senha incorretos')
    }

    this.failures.delete(attemptKey)
    const user = toSessionUser(row)
    const token = await new SignJWT({ role: user.role })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(`${this.config.SESSION_TTL_HOURS}h`)
      .sign(this.key)
    return { user, token }
  }

  /** Valida o token e recarrega o usuário com o escopo atual (cache curto, para refletir mudanças no cadastro). */
  async resolve(token: string): Promise<SessionUser | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] })
      if (!payload.sub) return null
      const cached = this.cache.get(payload.sub)
      if (cached && cached.expires > Date.now()) return cached.user
      const { rows } = await this.pool.query<UserRow>(`${USER_QUERY} WHERE u.id = $1`, [payload.sub])
      if (!rows[0]) return null
      const user = toSessionUser(rows[0])
      this.cache.set(user.id, { user, expires: Date.now() + SCOPE_CACHE_MS })
      return user
    } catch {
      return null
    }
  }

  get sessionMaxAgeMs(): number {
    return this.config.SESSION_TTL_HOURS * 3_600_000
  }

  /** Usuários do cadastro com o alcance de cada perfil, para a tela de login no modo demonstração. */
  async demoUsers(): Promise<Array<{ email: string; name: string; role: Role; scope: string }> | null> {
    if (!this.config.DEMO_MODE) return null
    const { rows } = await this.pool.query<{ email: string; name: string; role: Role; scope: string }>(
      `SELECT u.email::text AS email, u.name, u.role,
         CASE u.role
           WHEN 'admin_diel' THEN 'Todos os clientes e lojas'
           WHEN 'gestor_cliente' THEN 'Lojas de ' || c.name
           ELSE (SELECT string_agg(s.name, ', ' ORDER BY s.name)
                 FROM registry.user_store us JOIN registry.store s ON s.id = us.store_id WHERE us.user_id = u.id)
         END AS scope
       FROM registry.app_user u LEFT JOIN registry.client c ON c.id = u.client_id
       ORDER BY u.id`,
    )
    return rows
  }
}

function toSessionUser(row: UserRow): SessionUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    clientId: row.client_id,
    scope: { all: row.role === 'admin_diel', storeIds: row.store_ids ?? [] },
  }
}
