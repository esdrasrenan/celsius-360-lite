import { clsx } from 'clsx'
import { Skeleton } from '../../components/Skeleton'
import { useDelayed } from '../../lib/hooks'

/**
 * Uma linha de texto: a caixa tem a altura da entrelinha real e a barra fica no meio dela. Assim o
 * skeleton soma as mesmas alturas do conteúdo, e nada pula quando os dados chegam.
 */
function Line({ box, bar }: { box: string; bar: string }) {
  return (
    <span className={clsx('flex items-center', box)}>
      <Skeleton className={bar} />
    </span>
  )
}

/**
 * Área do gráfico com a geometria real: título e subtítulo, legenda, plot de 320 px (240 no
 * celular) com grade fantasma e "Carregando leituras…" no centro, e a faixa da tira de situação,
 * do eixo e do brush (que não existe em 24 horas).
 */
export function ChartSkeleton({ brush = true }: { brush?: boolean }) {
  const visible = useDelayed(true, 150)
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <span className="flex h-10 flex-col justify-center gap-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-56" />
      </span>
      <Line box="h-7" bar="h-4 w-full max-w-120" />
      <div className="flex flex-col">
        <div className={clsx('relative h-grafico-movel sm:h-grafico', !visible && 'invisible')}>
          <div aria-hidden="true" className="absolute inset-0 flex flex-col justify-between ps-12 pe-16">
            {[0, 1, 2, 3, 4].map((line) => (
              <span key={line} className="border-borda border-t border-dashed" />
            ))}
          </div>
          <p className="absolute inset-0 flex items-center justify-center text-apoio text-texto-3">
            Carregando leituras…
          </p>
        </div>
        {/* Tira de situação e eixo; com brush, mais os 40 px dele e o respiro */}
        <div className={clsx('flex flex-col gap-2 ps-12 pe-16 pt-3', brush ? 'h-27' : 'h-14')}>
          <Skeleton className="h-2.5 w-full" />
          {brush && <Skeleton className="mt-auto mb-2 h-10 w-full" />}
        </div>
      </div>
    </div>
  )
}

/** Uma célula de KPI: rótulo, valor, contexto e a barra da base, nas alturas da KpiCell. */
function KpiSkeleton({ className }: { className: string }) {
  return (
    <div className={clsx('flex min-h-26 flex-col gap-1.5 border-borda p-4', className)}>
      <Line box="h-9 sm:h-4.5" bar="h-3 w-24" />
      <Line box="h-8" bar="h-6 w-18" />
      <Line box="h-8 sm:h-4" bar="h-2.5 w-35 max-w-full" />
      <span className="mt-auto pt-1.5">
        <Skeleton className="h-1 w-full" />
      </span>
    </div>
  )
}

/**
 * Primeira carga do detalhe com a geometria real (seção 3.13): breadcrumb, cabeçalho, o cartão do
 * período com a faixa de KPIs e o gráfico. Aparece só depois de 150 ms.
 */
export function DetailSkeleton({ brush }: { brush?: boolean }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="so-leitor">Carregando o ambiente…</span>
      <div className="flex flex-col gap-1">
        <Line box="h-8" bar="h-3 w-64 max-w-full" />
        <div className="flex flex-col gap-5 md:flex-row md:justify-between md:gap-10">
          <div className="flex flex-col gap-1.5">
            <Line box="h-8" bar="h-6 w-72 max-w-full" />
            <Line box="h-6" bar="h-5 w-40" />
            <Line box="h-4.5" bar="h-3 w-80 max-w-full" />
            <span className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
              <Line box="h-4.5" bar="h-3 w-24" />
              <Line box="h-4.5" bar="h-3 w-72 max-w-full" />
            </span>
          </div>
          <div className="flex flex-col gap-0.5 md:items-end">
            <Line box="h-4.5" bar="h-3 w-32" />
            <Line box="h-8 md:h-11" bar="h-7 w-28 md:h-9 md:w-36" />
            <Line box="h-5" bar="h-3.5 w-56" />
            <Line box="h-4" bar="h-3 w-40" />
          </div>
        </div>
      </div>
      <div className="cartao overflow-clip">
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <Skeleton className="h-controle w-full sm:w-56" />
            <Line box="h-9 sm:h-4.5" bar="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-controle w-full sm:w-96" />
        </div>
        <div className="grid grid-cols-2 border-borda border-t lg:grid-cols-4">
          <KpiSkeleton className="" />
          <KpiSkeleton className="border-s" />
          <KpiSkeleton className="border-t lg:border-s lg:border-t-0" />
          <KpiSkeleton className="border-s border-t lg:border-t-0" />
        </div>
        <div className="border-borda border-t p-4 md:p-5">
          <ChartSkeleton brush={brush} />
        </div>
      </div>
    </div>
  )
}
