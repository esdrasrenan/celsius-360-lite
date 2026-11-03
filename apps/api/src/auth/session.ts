import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common'

export const SESSION_COOKIE = 'celsius_session'

export type Role = 'admin_diel' | 'gestor_cliente' | 'gerente_loja'

/**
 * O que o usuário pode ver. Administrador da Diel vê tudo; gestor de cliente, as lojas do cliente;
 * gerente, só as lojas listadas no cadastro. Toda consulta da API filtra por este escopo.
 */
export interface UserScope {
  all: boolean
  storeIds: string[]
}

export interface SessionUser {
  id: string
  name: string
  email: string
  role: Role
  clientId: string | null
  scope: UserScope
}

export const IS_PUBLIC = 'isPublic'
export const Public = () => SetMetadata(IS_PUBLIC, true)

export const ROLES = 'roles'
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles)

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext) => context.switchToHttp().getRequest<{ user: SessionUser }>().user,
)

export function canSeeStore(scope: UserScope, storeId: string): boolean {
  return scope.all || scope.storeIds.includes(storeId)
}
