import { Popover } from '@base-ui/react/popover'
import { formatDateTime, formatLongDateTime, NETWORK_TIME_ZONE_LABEL } from '../../lib/format'
import { type LiveStatus, useLiveStatus } from '../../lib/live'
import type { Tone } from '../../lib/states'
import { StatusDot } from '../StatusDot'

const TONE: Record<LiveStatus, Tone> = {
  connecting: 'neutro',
  live: 'ok',
  idle: 'neutro',
  reconnecting: 'alerta',
  expired: 'falha',
}

const CLOCK_NOTE = 'O relógio do sistema é o último pacote processado. O conjunto de dados é histórico.'

function describeLive(
  status: LiveStatus,
  now: string | null,
  retryInSeconds: number | null,
): { label: string; lines: string[] } {
  const last = now && `${formatLongDateTime(now)} (${NETWORK_TIME_ZONE_LABEL})`
  switch (status) {
    case 'live':
      return {
        label: now ? `Ao vivo · ${formatDateTime(now)}` : 'Ao vivo',
        lines: [`A ingestão está processando pacotes${last ? `. Último: ${last}` : ''}.`, CLOCK_NOTE],
      }
    case 'idle':
      return now
        ? {
            label: `Dados até ${formatDateTime(now)}`,
            lines: [`Último pacote processado: ${last}.`, CLOCK_NOTE],
          }
        : { label: 'Aguardando dados', lines: ['A ingestão ainda não processou nenhum pacote.'] }
    case 'reconnecting':
      return {
        label: retryInSeconds ? `Reconectando em ${retryInSeconds} s` : 'Reconectando…',
        lines: ['A conexão de tempo real caiu. Os números na tela podem estar desatualizados.'],
      }
    case 'expired':
      return { label: 'Sessão expirada', lines: ['Entre de novo para continuar.'] }
    case 'connecting':
      return { label: 'Conectando…', lines: ['Abrindo a conexão de tempo real com a API.'] }
  }
}

/** Chip ao vivo do cabeçalho, ligado ao SSE. */
export function LiveChip() {
  return <LiveChipView {...useLiveStatus()} />
}

/**
 * Chip ao vivo (seção 3.14): estado do SSE e o "agora" da ingestão. A explicação abre em hover,
 * foco ou toque (Popover com openOnHover). No celular o chip vira só o ponto, mas nunca some.
 */
export function LiveChipView({
  status,
  now,
  retryInSeconds,
}: {
  status: LiveStatus
  now: string | null
  retryInSeconds: number | null
}) {
  const { label, lines } = describeLive(status, now, retryInSeconds)

  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={300}
        aria-label={label}
        className="pressionavel inline-flex size-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-superficie font-medium text-legenda text-texto-2 ring-1 ring-borda ring-inset hover:ring-borda-forte data-popup-open:ring-borda-forte md:h-7 md:w-auto md:px-2.5"
      >
        <StatusDot tone={TONE[status]} pulse={status === 'live'} />
        <span className="num hidden whitespace-nowrap md:inline">{label}</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} collisionPadding={8} className="z-50">
          <Popover.Popup className="animacao-dica flex max-w-dica flex-col gap-1 rounded-md bg-inverso px-2.5 py-2 text-legenda text-texto-inverso shadow-dica outline-none">
            <Popover.Arrow className="seta-dica">
              <svg viewBox="0 0 8 4" className="size-full fill-current" aria-hidden="true">
                <path d="M0 0h8L4 4z" />
              </svg>
            </Popover.Arrow>
            <Popover.Title className="num font-semibold">{label}</Popover.Title>
            {lines.map((line) => (
              <Popover.Description key={line} className="text-texto-inverso-2">
                {line}
              </Popover.Description>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
