import type { DemoUser, SessionUser as SessionUserContract } from '@celsius/contracts'
import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Post, Req, Res } from '@nestjs/common'
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator'
import type { CookieOptions, Request, Response } from 'express'
import { APP_CONFIG, type AppConfig } from '../config'
import { AuthService } from './auth.service'
import { CurrentUser, Public, type Role, SESSION_COOKIE, type SessionUser } from './session'

export class LoginDto {
  @ApiProperty({ example: 'ana.ribeiro@diel.example', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email: string

  // O teto evita que uma senha enorme vire custo de CPU no argon2id sem autenticação
  @ApiProperty({ description: 'Senha de demonstração (DEMO_PASSWORD ou a gerada no seed)', maxLength: 256 })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password: string
}

export class SessionUserDto implements SessionUserContract {
  @ApiProperty({ example: 'USR-002' }) id: string
  @ApiProperty({ example: 'Carlos Mendes' }) name: string
  @ApiProperty({ example: 'carlos.mendes@modacarioca.example' }) email: string
  @ApiProperty({ enum: ['admin_diel', 'gestor_cliente', 'gerente_loja'] }) role: Role
  @ApiPropertyOptional({ nullable: true, example: 'CLI-001' }) clientId: string | null
  @ApiProperty({ description: 'Vê todas as lojas (administrador da Diel)' }) allStores: boolean
  @ApiProperty({ type: [String], description: 'Lojas visíveis quando allStores é falso' }) storeIds: string[]
}

export class DemoUserDto implements DemoUser {
  @ApiProperty({ example: 'juliana.prado@modacarioca.example' }) email: string
  @ApiProperty({ example: 'Juliana Prado' }) name: string
  @ApiProperty({ enum: ['admin_diel', 'gestor_cliente', 'gerente_loja'] }) role: Role
  @ApiProperty({ example: 'Loja Paulista' }) scope: string
}

const toDto = (user: SessionUser): SessionUserDto => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  clientId: user.clientId,
  allStores: user.scope.all,
  storeIds: user.scope.storeIds,
})

@ApiTags('Sessão')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private cookieOptions(request: Request): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.COOKIE_SECURE || request.secure,
      path: '/',
    }
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Entra com um usuário do cadastro e recebe o cookie de sessão (httpOnly)' })
  @ApiOkResponse({ type: SessionUserDto })
  @ApiUnauthorizedResponse({ description: 'E-mail ou senha incorretos' })
  @ApiTooManyRequestsResponse({
    description:
      'Mais de 20 tentativas por minuto do mesmo IP, ou 5 falhas em 5 minutos no mesmo e-mail. O cabeçalho Retry-After diz quantos segundos esperar',
  })
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { user, token } = await this.auth.login(body.email, body.password, request.ip ?? 'desconhecido')
    response.cookie(SESSION_COOKIE, token, {
      ...this.cookieOptions(request),
      maxAge: this.auth.sessionMaxAgeMs,
    })
    return toDto(user)
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Encerra a sessão' })
  logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    response.clearCookie(SESSION_COOKIE, this.cookieOptions(request))
  }

  @Public()
  @Get('demo-users')
  @ApiOperation({
    summary: 'Usuários de demonstração (só com DEMO_MODE=true): e-mail, perfil e alcance, sem senha',
  })
  @ApiOkResponse({ type: [DemoUserDto] })
  async demoUsers() {
    const users = await this.auth.demoUsers()
    if (!users) throw new NotFoundException('A lista de usuários só existe no modo de demonstração.')
    return users
  }

  @Get('me')
  @ApiCookieAuth(SESSION_COOKIE)
  @ApiOperation({ summary: 'Usuário da sessão e o escopo de lojas que ele enxerga' })
  @ApiOkResponse({ type: SessionUserDto })
  @ApiUnauthorizedResponse({ description: 'Sem sessão válida' })
  me(@CurrentUser() user: SessionUser) {
    return toDto(user)
  }
}
