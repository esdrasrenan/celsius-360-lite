import type { PeriodKey } from '@celsius/contracts'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { queries } from '../../api/queries'

export interface EnvironmentName {
  name: string
  store: string
}

/**
 * Nome do ambiente e da loja de cada episódio, que o relatório traz só como id. A chave fica fora
 * do prefixo 'environment', que o tempo real refaz a cada lote: nomes não mudam. O resumo do
 * período que o link "Ver no gráfico" abre continua no cache, pronto para o detalhe.
 */
export function useEnvironmentNames(targets: ReadonlyArray<{ environmentId: string; period: PeriodKey }>) {
  const client = useQueryClient()
  const unique = [...new Map(targets.map((target) => [target.environmentId, target])).values()]
  const results = useQueries({
    queries: unique.map(({ environmentId, period }) => ({
      queryKey: ['environment-name', environmentId, period] as const,
      queryFn: async (): Promise<EnvironmentName> => {
        const summary = await client.fetchQuery({
          ...queries.summary(environmentId, period),
          staleTime: 300_000,
        })
        return { name: summary.environment.name, store: summary.store.name }
      },
      staleTime: Number.POSITIVE_INFINITY,
    })),
  })
  const names = new Map<string, EnvironmentName | 'pending' | 'missing'>()
  unique.forEach(({ environmentId }, index) => {
    const result = results[index]
    names.set(environmentId, result?.data ?? (result?.isPending ? 'pending' : 'missing'))
  })
  return names
}
