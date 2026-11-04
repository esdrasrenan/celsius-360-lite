import { randomBytes } from 'node:crypto'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Config } from '../config'
import type { Logger } from '../infra'

/**
 * Segredo das sessões que sobrevive a reinícios da API: o setup o gera uma única vez num volume que a
 * API lê só para leitura (JWT_SECRET_FILE). JWT_SECRET definido no .env tem precedência e dispensa o arquivo.
 */
export async function ensureSessionSecret(config: Config, logger: Logger): Promise<void> {
  if (config.JWT_SECRET) {
    logger.info('segredo da sessão definido em JWT_SECRET')
    return
  }
  const path = config.JWT_SECRET_FILE
  if (!path) return
  const file = Bun.file(path)
  if ((await file.exists()) && (await file.text()).trim().length >= 32) {
    logger.info({ path }, 'segredo da sessão mantido')
    return
  }
  await mkdir(dirname(path), { recursive: true })
  // 36 bytes em base64url: 48 caracteres
  await writeFile(path, randomBytes(36).toString('base64url'), { mode: 0o600 })
  await chmod(path, 0o600)
  logger.info({ path }, 'segredo da sessão gerado')
}
