import { Clock01Icon, KeyboardIcon, ViewIcon, ViewOffSlashIcon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { ApiError } from '../../api/client'
import { useDemoUsers, useLogin, useSession } from '../../api/queries'
import { Button } from '../../components/Button'
import { Hint } from '../../components/Hint'
import { Icon } from '../../components/Icon'
import { ROLE_LABEL } from '../../lib/states'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { PasswordHint } from './PasswordHint'
import { safeRedirect } from './redirect'

/** Um anel só: a borda do campo; o foco usa o contorno global de :focus-visible. */
const FIELD =
  'h-controle-toque w-full rounded-md bg-superficie px-3.5 text-corpo-lg text-texto shadow-controle ring-1 ring-borda-controle ring-inset sm:text-corpo'
const LABEL = 'font-medium text-apoio text-texto'

function loginError(error: unknown): string | null {
  if (!error) return null
  if (!(error instanceof ApiError)) return 'Não foi possível entrar agora. Tente de novo.'
  if (error.status === 0) return 'Sem conexão com a API. Confira se a stack está no ar.'
  if (error.status >= 500) return 'O servidor não respondeu. Tente de novo em instantes.'
  // 401 (e-mail ou senha incorretos), 429 (muitas tentativas) e 400 já vêm em português da API
  return error.message
}

export function LoginPage() {
  useDocumentTitle('Entrar')
  const session = useSession()
  const login = useLogin()
  const demoUsers = useDemoUsers()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const target = safeRedirect(params.get('voltar'))
  const expired = params.get('motivo') === 'expirada'

  if (session.data) return <Navigate to={target} replace />

  const submit = (event: FormEvent) => {
    event.preventDefault()
    login.mutate({ email, password }, { onSuccess: () => navigate(target, { replace: true }) })
  }

  const readCapsLock = (event: KeyboardEvent<HTMLInputElement>) =>
    setCapsLock(event.getModifierState('CapsLock'))

  const chooseDemoUser = (address: string) => {
    setEmail(address)
    passwordRef.current?.focus()
  }

  const error = loginError(login.error)
  const users = demoUsers.data ?? []

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <section className="fundo-login relative hidden flex-col p-12 text-texto-inverso-2 lg:sticky lg:top-0 lg:flex lg:h-dvh lg:self-start">
        <img src="/marca/diel-logotipo-negativo.svg" alt="Diel Energia" className="h-9 w-auto self-start" />
        <div className="mt-auto flex max-w-texto flex-col gap-6">
          <img src="/marca/celsius-360-negativo.svg" alt="Celsius 360" className="h-8 w-auto self-start" />
          <p className="max-w-manchete text-balance text-display text-texto-inverso">
            {/* As expressões não se partem entre linhas */}
            Conforto térmico da rede, <span className="whitespace-nowrap">loja por loja,</span>{' '}
            <span className="whitespace-nowrap text-marca-ciano-claro">em tempo real</span>
          </p>
          <p className="max-w-manchete text-corpo-lg text-texto-inverso-3">
            Telemetria dos ambientes tratada e comparada com a faixa de conforto de cada um, no horário em que
            ele funciona.
          </p>
        </div>
      </section>

      <section className="flex items-center justify-center px-4 py-10 sm:px-6 lg:py-12">
        <div className="flex w-full max-w-formulario flex-col gap-8">
          <div className="flex flex-col gap-2">
            <img
              src="/marca/diel-logotipo.svg"
              alt="Diel Energia"
              className="mb-4 h-8 w-auto self-start lg:hidden"
            />
            <h1 className="text-texto text-titulo-1">Entrar</h1>
            <p className="text-corpo-lg text-texto-3">
              Use um usuário do cadastro. Cada perfil vê só os clientes e lojas que lhe cabem.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {expired && (
              <p
                role="status"
                className="flex items-start gap-2 rounded-md bg-neutro-fundo px-3.5 py-2.5 text-apoio text-neutro-texto ring-1 ring-neutro-borda ring-inset"
              >
                <Icon icon={Clock01Icon} className="mt-px text-neutro" />
                Sua sessão expirou. Entre de novo.
              </p>
            )}

            <form onSubmit={submit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="login-email" className={LABEL}>
                  E-mail
                </label>
                <input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="username"
                  spellCheck={false}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className={FIELD}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="login-senha" className={LABEL}>
                  Senha
                </label>
                <div className="relative">
                  <input
                    ref={passwordRef}
                    id="login-senha"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={readCapsLock}
                    onKeyUp={readCapsLock}
                    onBlur={() => setCapsLock(false)}
                    aria-describedby="login-caps"
                    className={clsx(FIELD, 'pe-12')}
                  />
                  <Hint content={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                    {/* Nome pelo texto oculto, não por aria-label: o campo continua sendo o único
                        rótulo "Senha" da página (getByLabel('Senha') nos testes e em automações) */}
                    <button
                      type="button"
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((shown) => !shown)}
                      className="foco-interno absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-md text-texto-3 transition-colors duration-100 ease-linear hover:text-texto"
                    >
                      <Icon icon={showPassword ? ViewOffSlashIcon : ViewIcon} />
                      <span className="so-leitor">Mostrar senha</span>
                    </button>
                  </Hint>
                </div>
                {/* Espaço reservado: o aviso aparece sem empurrar o layout */}
                <p
                  id="login-caps"
                  aria-live="polite"
                  className="flex h-4 items-center gap-1 text-alerta-texto text-legenda"
                >
                  {capsLock && (
                    <>
                      <Icon icon={KeyboardIcon} size={12} />
                      Caps Lock ativado
                    </>
                  )}
                </p>
              </div>

              {error && (
                <p
                  role="alert"
                  className="rounded-md bg-falha-fundo px-3.5 py-2.5 text-apoio text-falha-texto ring-1 ring-falha-borda ring-inset"
                >
                  {error}
                </p>
              )}

              <Button
                type="submit"
                variant="primary"
                busy={login.isPending}
                busyLabel="Entrando…"
                className="h-controle-toque w-full"
              >
                Entrar
              </Button>
            </form>
          </div>

          {users.length > 0 && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <h2 id="usuarios-demo" className="font-medium text-apoio text-texto-3">
                  Usuários de demonstração
                </h2>
                <ul aria-labelledby="usuarios-demo" className="flex flex-col gap-2">
                  {users.map((user) => (
                    <li key={user.email}>
                      <button
                        type="button"
                        onClick={() => chooseDemoUser(user.email)}
                        className={clsx(
                          'pressionavel flex w-full flex-col items-start gap-0.5 rounded-md bg-superficie px-3.5 py-2.5 text-left ring-1 ring-inset',
                          email === user.email ? 'ring-acento' : 'ring-borda hover:ring-borda-forte',
                        )}
                      >
                        <span className="font-medium text-corpo text-texto">
                          {user.name} · {ROLE_LABEL[user.role]}
                        </span>
                        {/* Quebra no "·" antes de partir o e-mail ou o escopo no meio */}
                        <span className="text-apoio text-texto-3">
                          <span className="inline-block max-w-full break-words">{user.email}</span> ·{' '}
                          <span className="inline-block max-w-full">{user.scope}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <PasswordHint />
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
