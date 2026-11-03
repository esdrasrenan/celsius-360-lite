import type { EnvironmentListItem, PeriodKey, StoreListItem } from '@celsius/contracts'
import { ArrowDown01Icon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import { useState } from 'react'
import { Link } from 'react-router'
import { Badge, ComfortBar, Dot, Icon } from '../../components/ui'
import { formatTemperature } from '../../lib/format'
import { COMFORT_TARGET, DEVICE_STATUS, SITUATION, STORE_STATUS } from '../../lib/labels'

function EnvironmentRow({ environment, period }: { environment: EnvironmentListItem; period: PeriodKey }) {
  const status =
    DEVICE_STATUS[environment.status] ?? (DEVICE_STATUS.no_data as (typeof DEVICE_STATUS)[string])
  const situation = SITUATION[environment.situation] ?? (SITUATION.unknown as (typeof SITUATION)[string])
  return (
    <li>
      <Link
        to={`/ambientes/${environment.id}?periodo=${period}`}
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 rounded-[13px] px-3 py-2.5 transition-colors hover:bg-gelo md:grid-cols-[minmax(0,1.6fr)_8.5rem_7.5rem_9rem_minmax(9rem,1fr)_1.25rem]"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span title={status.hint}>
            <Dot tone={status.tone} />
          </span>
          <span className="truncate font-medium text-[0.92rem] text-tinta">{environment.name}</span>
        </span>
        <span className="hidden text-[0.84rem] text-tinta-3 md:block" title={status.hint}>
          {status.label}
        </span>
        <span className="flex flex-col text-right md:text-left">
          <span className="font-medium text-[0.92rem] text-tinta tabular-nums">
            {formatTemperature(environment.lastValue)}
          </span>
          <span className="text-[0.74rem] text-tinta-3 tabular-nums">
            faixa {environment.comfortRange.min}–{environment.comfortRange.max} °C
          </span>
        </span>
        <span className="hidden md:block">
          <Badge tone={situation.tone}>{situation.label}</Badge>
        </span>
        <span className="col-span-2 md:col-span-1">
          <ComfortBar value={environment.comfortPct} compact />
        </span>
        <Icon
          icon={ArrowRight01Icon}
          className="hidden text-tinta-3 transition-transform group-hover:translate-x-0.5 md:block"
        />
      </Link>
    </li>
  )
}

export function StoreCard({
  store,
  period,
  defaultOpen,
}: {
  store: StoreListItem
  period: PeriodKey
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const status = STORE_STATUS[store.status] ?? (STORE_STATUS.no_data as (typeof STORE_STATUS)[string])
  const counts = store.environmentCounts
  const offline = counts.offline + counts.noData + counts.sensorFault

  return (
    <article className="cartao overflow-hidden" aria-label={store.name}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-3 px-5 py-4 text-left transition-colors hover:bg-gelo/60 md:grid-cols-[minmax(0,1.4fr)_auto_minmax(12rem,1fr)_auto]"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-semibold text-[1.02rem] text-tinta tracking-[-0.01em]">
            {store.name}
          </span>
          <span className="truncate text-[0.84rem] text-tinta-3">
            {store.client.name} · {store.city}/{store.state} · {store.kind}
          </span>
        </span>
        <span className="justify-self-end md:justify-self-start">
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
        <span className="col-span-2 flex flex-col gap-1 md:col-span-1">
          <span className="t-rotulo text-[0.66rem] text-tinta-3">Conforto no período</span>
          <ComfortBar value={store.comfortPct} target={COMFORT_TARGET} />
        </span>
        <span className="col-span-2 flex items-center gap-4 text-[0.84rem] text-tinta-3 md:col-span-1">
          <span>
            <strong className="font-semibold text-tinta">{counts.total}</strong> ambientes
          </span>
          <span className={clsx(counts.outOfRange > 0 && 'text-calor')}>
            <strong className="font-semibold">{counts.outOfRange}</strong> fora da faixa agora
          </span>
          {offline > 0 && (
            <span className="text-falha">
              <strong className="font-semibold">{offline}</strong> sem leitura
            </span>
          )}
          <Icon
            icon={ArrowDown01Icon}
            className={clsx('ml-auto transition-transform', open && 'rotate-180')}
          />
        </span>
      </button>
      {open && (
        <ul className="flex flex-col gap-0.5 border-linha border-t px-2 py-2">
          {store.environments.map((environment) => (
            <EnvironmentRow key={environment.id} environment={environment} period={period} />
          ))}
        </ul>
      )}
    </article>
  )
}
