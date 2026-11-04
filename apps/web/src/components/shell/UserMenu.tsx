import type { SessionUser } from '@celsius/contracts'
import { ArrowDown01Icon, Logout03Icon } from '@hugeicons/core-free-icons'
import { useNavigate } from 'react-router'
import { ROLE_LABEL } from '../../lib/states'
import { truncateMiddle } from '../../lib/text'
import { Badge } from '../Badge'
import { Icon } from '../Icon'
import { Menu, type MenuEntry } from '../Menu'
import { useMediaQuery } from './hooks'
import type { NavEntry } from './MainNav'

const EMAIL_MAX = 30

function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  const letters = words.length > 1 ? [words[0], words.at(-1)] : [words[0]]
  return letters
    .map((word) => word?.[0] ?? '')
    .join('')
    .toLocaleUpperCase('pt-BR')
}

/**
 * Menu do usuário (Base UI Menu): nome, e-mail truncado no meio e perfil no cabeçalho, e "Sair".
 * Abaixo de md, a navegação principal também entra aqui, porque o cabeçalho só tem o logo, o
 * ponto ao vivo e o avatar.
 */
export function UserMenu({
  user,
  nav,
  onLogout,
}: {
  user: SessionUser
  nav: readonly NavEntry[]
  onLogout: () => void
}) {
  const navigate = useNavigate()
  const wide = useMediaQuery('(min-width: 48rem)')
  const email = truncateMiddle(user.email, EMAIL_MAX)

  const items: MenuEntry[] = [
    ...(!wide && nav.length > 1
      ? [
          ...nav.map((entry) => ({
            label: entry.label,
            icon: entry.icon,
            onSelect: () => navigate(entry.to),
          })),
          'separator' as const,
        ]
      : []),
    { label: 'Sair', icon: Logout03Icon, onSelect: onLogout },
  ]

  return (
    <Menu
      align="end"
      trigger={
        <button
          type="button"
          aria-label={`${user.name}: menu da conta`}
          className="pressionavel flex h-9 shrink-0 items-center gap-2 rounded-full ps-1 pe-2 text-texto-3 hover:bg-realce hover:text-texto data-popup-open:bg-realce data-popup-open:text-texto pointer-coarse:h-controle-toque"
        >
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-full bg-inverso font-semibold text-legenda text-texto-inverso"
          >
            {initials(user.name)}
          </span>
          <span className="hidden max-w-40 truncate font-medium text-apoio text-texto lg:block">
            {user.name}
          </span>
          <Icon icon={ArrowDown01Icon} size={12} />
        </button>
      }
      header={
        <div className="flex min-w-56 flex-col items-start gap-0.5">
          <p className="max-w-full truncate font-medium text-corpo text-texto">{user.name}</p>
          <p className="text-apoio text-texto-3">
            <span aria-hidden={email !== user.email || undefined}>{email}</span>
            {email !== user.email && <span className="so-leitor">{user.email}</span>}
          </p>
          <Badge size="sm" className="mt-1.5">
            {ROLE_LABEL[user.role]}
          </Badge>
        </div>
      }
      items={items}
    />
  )
}
