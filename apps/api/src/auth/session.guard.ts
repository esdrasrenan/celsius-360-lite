import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { AuthService } from './auth.service'
import { IS_PUBLIC, ROLES, type Role, SESSION_COOKIE, type SessionUser } from './session'

/** Guard global: toda rota exige sessão, salvo as marcadas com @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()]
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true

    const request = context.switchToHttp().getRequest<Request & { user?: SessionUser }>()
    const token = request.cookies?.[SESSION_COOKIE] as string | undefined
    const user = token ? await this.auth.resolve(token) : null
    if (!user) throw new UnauthorizedException('Sessão ausente ou expirada.')
    request.user = user

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets)
    if (roles && !roles.includes(user.role))
      throw new ForbiddenException('Seu perfil não tem acesso a este recurso.')
    return true
  }
}
