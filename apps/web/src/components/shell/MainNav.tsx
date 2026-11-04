import type { Role } from '@celsius/contracts'
import { DashboardSquare01Icon, DocumentValidationIcon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import { clsx } from 'clsx'
import { Link, useLocation } from 'react-router'

/** "page": o link é a tela atual; "section": a tela é filha dele (o detalhe é parte da rede). */
type Current = 'page' | 'section' | null

export interface NavEntry {
  to: string
  label: string
  icon: IconSvgElement
  current: (pathname: string) => Current
}

const NETWORK: NavEntry = {
  to: '/',
  label: 'Visão da rede',
  icon: DashboardSquare01Icon,
  current: (pathname) => (pathname === '/' ? 'page' : pathname.startsWith('/ambientes/') ? 'section' : null),
}

const QUALITY: NavEntry = {
  to: '/qualidade',
  label: 'Qualidade dos dados',
  icon: DocumentValidationIcon,
  current: (pathname) => (pathname === '/qualidade' ? 'page' : null),
}

/** A qualidade dos dados é só do administrador da Diel (a API responde 403 aos outros perfis). */
export function navEntries(role: Role): NavEntry[] {
  return role === 'admin_diel' ? [NETWORK, QUALITY] : [NETWORK]
}

/** Navegação do cabeçalho a partir de md; no celular, os itens vão para o menu do usuário. */
export function MainNav({ entries }: { entries: readonly NavEntry[] }) {
  const { pathname } = useLocation()
  return (
    <nav aria-label="Navegação principal" className="hidden h-full items-stretch gap-6 md:flex">
      {entries.map((entry) => {
        const current = entry.current(pathname)
        return (
          <Link
            key={entry.to}
            to={entry.to}
            aria-current={current === 'page' ? 'page' : current ? 'true' : undefined}
            className={clsx(
              'foco-interno relative flex items-center whitespace-nowrap rounded-sm font-medium text-corpo transition-colors duration-100 ease-linear',
              current ? 'text-texto' : 'text-texto-3 hover:text-texto',
            )}
          >
            {entry.label}
            {/* A "barra que acende" do site da Diel: assinatura da marca no item ativo */}
            {current && (
              <span
                aria-hidden="true"
                className="traco-marca absolute inset-x-0 bottom-0 h-0.5 rounded-full"
              />
            )}
          </Link>
        )
      })}
    </nav>
  )
}
