import { Alert02Icon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import { useState } from 'react'
import { Button } from './Button'
import { Icon } from './Icon'

/** O que o aviso precisa de cada consulta da tela (o resultado do useQuery serve). */
export interface Refreshable {
  /** A última atualização falhou, e a consulta continua com o dado anterior. */
  isRefetchError: boolean
  refetch: (options: { cancelRefetch: boolean }) => Promise<unknown>
}

/**
 * Aviso de atualização que falhou (seção 3.13). A tela mantém o último dado que deu certo, porque
 * apagar tudo por uma falha passageira seria pior, mas diz que ele pode estar desatualizado e
 * oferece a nova tentativa. Some sozinho quando uma atualização, manual ou do tempo real, dá certo.
 * A carga inicial que falha continua com o ErrorState, já que não há dado para mostrar.
 */
export function RefreshFailed({
  queries,
  className,
}: {
  queries: readonly Refreshable[]
  className?: string
}) {
  const [retrying, setRetrying] = useState(false)
  const failed = queries.filter((query) => query.isRefetchError)
  if (failed.length === 0) return null

  const retry = async () => {
    setRetrying(true)
    try {
      // Duas telas podem ler a mesma consulta (a série de 24 h e a tendência, por exemplo): sem
      // cancelar, a segunda chamada reaproveita a busca em curso em vez de abortá-la
      await Promise.all(failed.map((query) => query.refetch({ cancelRefetch: false })))
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div
      role="status"
      className={clsx(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-alerta-fundo px-4 py-2.5 text-alerta-texto ring-1 ring-alerta-borda ring-inset',
        className,
      )}
    >
      <Icon icon={Alert02Icon} className="text-alerta" />
      <p className="min-w-0 flex-1 text-apoio">
        A atualização falhou. Os números na tela podem estar desatualizados.
      </p>
      <Button size="sm" busy={retrying} busyLabel="Tentando…" onClick={retry}>
        Tentar de novo
      </Button>
    </div>
  )
}
