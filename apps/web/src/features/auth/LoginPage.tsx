import { type FormEvent, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { ApiError } from '../../api/client'
import { useDemoUsers, useLogin, useSession } from '../../api/queries'
import { Button } from '../../components/ui'
import { ROLE_LABEL } from '../../lib/labels'

export function LoginPage() {
  const session = useSession()
  const login = useLogin()
  const demoUsers = useDemoUsers()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const target = params.get('voltar')?.startsWith('/') ? (params.get('voltar') as string) : '/'

  if (session.data) return <Navigate to={target} replace />

  const submit = (event: FormEvent) => {
    event.preventDefault()
    login.mutate({ email, password }, { onSuccess: () => navigate(target, { replace: true }) })
  }

  const error =
    login.error instanceof ApiError
      ? login.error.message
      : login.error
        ? 'Não foi possível entrar agora. Tente de novo.'
        : null

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      <section className="relative hidden overflow-hidden bg-noite p-12 text-claro-2 lg:flex lg:flex-col">
        <div
          aria-hidden
          className="absolute inset-0 opacity-90"
          style={{
            background:
              'radial-gradient(120% 80% at 0% 100%, rgb(0 185 206 / 0.28), transparent 60%), radial-gradient(90% 70% at 100% 0%, rgb(54 59 196 / 0.45), transparent 60%)',
          }}
        />
        <img
          src="/marca/diel-logotipo-negativo.svg"
          alt="Diel Energia"
          className="relative h-9 w-auto self-start"
        />
        <div className="relative mt-auto flex max-w-lg flex-col gap-6">
          <img src="/marca/celsius-360-negativo.svg" alt="Celsius 360" className="h-8 w-auto self-start" />
          <h1 className="font-semibold text-[2.6rem] text-white leading-[1.05] tracking-[-0.04em]">
            Conforto térmico da rede, loja por loja, <span className="text-ciano-claro">em tempo real</span>
          </h1>
          <p className="text-[1.05rem] text-claro-3 leading-relaxed">
            Telemetria dos ambientes tratada e comparada com a faixa de conforto de cada um, no horário em que
            ele funciona.
          </p>
        </div>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <div className="flex flex-col gap-2">
            <img
              src="/marca/diel-logotipo.svg"
              alt="Diel Energia"
              className="mb-4 h-8 w-auto self-start lg:hidden"
            />
            <h2 className="t-titulo text-[1.9rem]">Entrar</h2>
            <p className="text-tinta-3">
              Use um usuário do cadastro. Cada perfil vê só os clientes e lojas que lhe cabem.
            </p>
          </div>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="font-medium text-[0.86rem] text-tinta">E-mail</span>
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="h-11 rounded-[11px] bg-branco px-3.5 text-tinta outline-none ring-1 ring-linha-forte ring-inset focus:ring-2 focus:ring-celsius"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium text-[0.86rem] text-tinta">Senha</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="h-11 rounded-[11px] bg-branco px-3.5 text-tinta outline-none ring-1 ring-linha-forte ring-inset focus:ring-2 focus:ring-celsius"
              />
            </label>
            {error && (
              <p role="alert" className="rounded-[11px] bg-falha/8 px-3.5 py-2.5 text-[0.88rem] text-falha">
                {error}
              </p>
            )}
            <Button type="submit" disabled={login.isPending} className="mt-1 h-11">
              {login.isPending ? 'Entrando…' : 'Entrar'}
            </Button>
          </form>

          {(demoUsers.data?.length ?? 0) > 0 && (
            <div className="flex flex-col gap-3">
              <span className="t-rotulo text-tinta-3">Usuários de demonstração</span>
              <ul className="flex flex-col gap-2">
                {demoUsers.data?.map((user) => (
                  <li key={user.email}>
                    <button
                      type="button"
                      onClick={() => setEmail(user.email)}
                      className="pressionavel flex w-full flex-col items-start rounded-[13px] bg-branco px-3.5 py-2.5 text-left ring-1 ring-linha transition hover:ring-linha-forte"
                    >
                      <span className="font-medium text-[0.88rem] text-tinta">
                        {user.name} · {ROLE_LABEL[user.role]}
                      </span>
                      <span className="text-[0.8rem] text-tinta-3">
                        {user.email} · {user.scope}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-[0.8rem] text-tinta-3">
                A senha é a definida em DEMO_PASSWORD ou a gerada no primeiro setup (veja o README).
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
