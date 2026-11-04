import type { PeriodKey } from '@celsius/contracts'
import { useQueries } from '@tanstack/react-query'
import { queries } from '../../api/queries'

export interface EnvironmentName {
  name: string
  store: string
}

/**
 * Nome do ambiente e da loja de cada episódio, que o relatório traz só como id. Usa o resumo do
 * período que o link "Ver no gráfico" abre: a mesma consulta já fica em cache para o detalhe.
 */
export function useEnvironmentNames(targets: ReadonlyArray<{ environmentId: string; period: PeriodKey }>) {
  const unique = [...new Map(targets.map((target) => [target.environmentId, target])).values()]
  const results = useQueries({
    queries: unique.map(({ environmentId, period }) => ({
      ...queries.summary(environmentId, period),
      staleTime: 300_000,
    })),
  })
  const names = new Map<string, EnvironmentName | 'pending' | 'missing'>()
  unique.forEach(({ environmentId }, index) => {
    const result = results[index]
    names.set(
      environmentId,
      result?.data
        ? { name: result.data.environment.name, store: result.data.store.name }
        : result?.isPending
          ? 'pending'
          : 'missing',
    )
  })
  return names
}
