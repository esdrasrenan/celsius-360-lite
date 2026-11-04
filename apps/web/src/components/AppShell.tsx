import { clsx } from 'clsx'
import { type ReactNode, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router'
import { useLogout, useSession } from '../api/queries'
import { useSessionExpired } from '../api/query-client'
import { loginPath } from '../features/auth/redirect'
import { useLiveUpdates } from '../lib/live'
import { ErrorState } from './ErrorState'
import { BRAND_HOME_LABEL, BrandLockup } from './shell/BrandLockup'
import { useScrolledPast } from './shell/hooks'
import { LiveChip } from './shell/LiveChip'
import { MainNav, navEntries } from './shell/MainNav'
import { UserMenu } from './shell/UserMenu'

/**
 * Moldura de todas as telas logadas: link de pular, cabeçalho fixo (transparente no topo, com
 * superfície e blur depois de 8 px de rolagem) e o <main>. Também desenha o estado de espera da
 * sessão, para o logo não pular entre a carga e a tela.
 */
function ShellFrame({
  nav,
  actions,
  children,
}: {
  nav?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  const [sentinel, setSentinel] = useState<HTMLSpanElement | null>(null)
  const scrolled = useScrolledPast(sentinel)

  return (
    <div className="relative min-h-dvh">
      <span
        ref={setSentinel}
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-2"
      />
      <a
        href="#conteudo"
        className="fixed top-2 left-2 z-50 rounded-md bg-inverso px-3.5 py-2 font-medium text-corpo text-texto-inverso shadow-flutuante not-focus:so-leitor"
      >
        Pular para o conteúdo
      </a>
      <header
        className={clsx(
          'nao-imprimir sticky top-0 z-20 h-cabecalho border-b transition-colors duration-150 ease-linear',
          scrolled ? 'border-borda bg-superficie/90 backdrop-blur-md' : 'border-transparent',
        )}
      >
        <div className="mx-auto flex h-full max-w-conteudo items-center gap-8 px-4 sm:px-6 lg:px-8">
          <Link to="/" aria-label={BRAND_HOME_LABEL} className="shrink-0 rounded-sm">
            <BrandLockup />
          </Link>
          {nav}
          <div className="ms-auto flex items-center gap-2 sm:gap-3">{actions}</div>
        </div>
      </header>
      <main
        id="conteudo"
        tabIndex={-1}
        className="mx-auto max-w-conteudo px-4 pt-6 pb-16 outline-none sm:px-6 md:pt-8 lg:px-8"
      >
        {children}
      </main>
    </div>
  )
}

export function AppShell() {
  const session = useSession()
  const expired = useSessionExpired()
  const logout = useLogout()
  const location = useLocation()
  // Sair é escolha do usuário: vai para /entrar sem "voltar", e o próximo perfil começa na rede
  const [leaving, setLeaving] = useState(false)
  useLiveUpdates(!!session.data)

  if (session.isPending) return <ShellFrame />

  if (!session.data) {
    if (session.isError) {
      return (
        <ShellFrame>
          <ErrorState error={session.error} heading="h1" onRetry={() => session.refetch()} />
        </ShellFrame>
      )
    }
    const to = leaving ? '/entrar' : loginPath(location.pathname + location.search, expired)
    return <Navigate to={to} replace />
  }

  const user = session.data
  const nav = navEntries(user.role)
  const signOut = () => {
    setLeaving(true)
    logout.mutate()
  }

  return (
    <ShellFrame
      nav={<MainNav entries={nav} />}
      actions={
        <>
          <LiveChip />
          <UserMenu user={user} nav={nav} onLogout={signOut} />
        </>
      }
    >
      <Outlet />
    </ShellFrame>
  )
}
