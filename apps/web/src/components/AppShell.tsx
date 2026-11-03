import { Logout03Icon } from '@hugeicons/core-free-icons'
import { useEffect, useReducer } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router'
import { useLogout, useSession } from '../api/queries'
import { formatFullDateTime } from '../lib/format'
import { ROLE_LABEL } from '../lib/labels'
import { useLiveState, useLiveUpdates } from '../lib/live'
import { Button, Dot, Icon, Skeleton } from './ui'

const LIVE_WINDOW_MS = 10_000

function LiveIndicator() {
  const live = useLiveState()
  // Rerenderiza a cada 2 s para o indicador sair de "ao vivo" quando os eventos param
  const [, tick] = useReducer((count: number) => count + 1, 0)
  useEffect(() => {
    const id = setInterval(tick, 2000)
    return () => clearInterval(id)
  }, [])
  const streaming = live.lastEventAt !== null && Date.now() - live.lastEventAt < LIVE_WINDOW_MS
  return (
    <div
      className="hidden items-center gap-2 rounded-full bg-gelo px-3 py-1.5 text-[0.8rem] text-tinta-3 ring-1 ring-linha md:flex"
      title="Horário do último pacote processado pela ingestão: é o “agora” do sistema"
    >
      <Dot tone={streaming ? 'ok' : live.connected ? 'neutro' : 'falha'} pulse={streaming} />
      {streaming ? 'Ingestão ao vivo' : live.connected ? 'Conectado' : 'Reconectando'}
      {live.now && <span className="text-tinta">· {formatFullDateTime(live.now)}</span>}
    </div>
  )
}

export function AppShell() {
  const session = useSession()
  const logout = useLogout()
  const location = useLocation()
  useLiveUpdates(!!session.data)

  if (session.isPending) {
    return (
      <div className="mx-auto max-w-[1280px] px-5 py-10">
        <Skeleton className="h-10 w-64" />
      </div>
    )
  }
  if (!session.data)
    return (
      <Navigate to={`/entrar?voltar=${encodeURIComponent(location.pathname + location.search)}`} replace />
    )

  const user = session.data
  const initials = user.name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-linha border-b bg-white/88 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-4 px-5 md:px-8">
          <Link to="/" className="flex items-center gap-3" aria-label="Visão da rede">
            <img src="/marca/diel-logotipo.svg" alt="Diel Energia" className="h-7 w-auto" />
            <span className="h-6 w-px bg-linha-forte" />
            <img src="/marca/celsius-360.svg" alt="Celsius 360" className="h-[18px] w-auto" />
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <LiveIndicator />
            <div className="flex items-center gap-2.5">
              <span className="grid size-9 place-items-center rounded-full bg-tinta font-semibold text-[0.8rem] text-white">
                {initials}
              </span>
              <span className="hidden flex-col leading-tight sm:flex">
                <span className="font-medium text-[0.86rem] text-tinta">{user.name}</span>
                <span className="text-[0.76rem] text-tinta-3">{ROLE_LABEL[user.role]}</span>
              </span>
            </div>
            <Button
              variant="fantasma"
              onClick={() => logout.mutate()}
              aria-label="Sair"
              className="h-9 px-2.5"
            >
              <Icon icon={Logout03Icon} />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1280px] px-5 pt-8 pb-16 md:px-8">
        <Outlet />
      </main>
    </div>
  )
}
