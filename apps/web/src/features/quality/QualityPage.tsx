import { Clock01Icon, SquareLock02Icon } from '@hugeicons/core-free-icons'
import { Link } from 'react-router'
import { ApiError } from '../../api/client'
import { useQuality, useSession } from '../../api/queries'
import { buttonClass } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Kpi } from '../../components/Kpi'
import { RefreshFailed } from '../../components/RefreshFailed'
import { Skeleton } from '../../components/Skeleton'
import { formatLongDateTime, NETWORK_TIME_ZONE_LABEL } from '../../lib/format'
import { ROLE_LABEL } from '../../lib/states'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { QualityReportView } from './QualityReportView'

const TITLE = 'Qualidade dos dados'

function LoadingReport() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="so-leitor">Carregando o relatório</span>
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {['Pacotes recebidos', 'Duplicatas exatas', 'Pacotes atrasados', 'Amostras válidas'].map((label) => (
          <Kpi key={label} label={label} loading />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-12">
        <div className="cartao flex h-72 flex-col gap-4 p-5 lg:col-span-7">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="mt-4 h-2 w-full" />
          <Skeleton className="h-2 w-1/3" />
        </div>
        <div className="cartao flex h-72 flex-col gap-4 p-5 lg:col-span-5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-4 h-14 w-full" />
        </div>
      </div>
    </div>
  )
}

/**
 * /qualidade (seção 7, P0 #11): o relatório que a ingestão grava ao terminar, lido como um relatório
 * de engenharia. Só para o administrador da Diel; os outros perfis veem um 403 explicado.
 */
export function QualityPage() {
  useDocumentTitle(TITLE)
  const session = useSession()
  const role = session.data?.role
  const isAdmin = role === 'admin_diel'
  const quality = useQuality({ enabled: isAdmin })

  if (role && !isAdmin) {
    return (
      <EmptyState
        heading="h1"
        icon={SquareLock02Icon}
        title="Você não tem acesso a esta página"
        description={`A qualidade dos dados cobre a telemetria de todos os clientes e é exclusiva do administrador da Diel. Seu perfil (${ROLE_LABEL[role]}) acompanha as lojas do seu acesso na visão da rede.`}
        actions={
          <Link to="/" className={buttonClass('primary')}>
            Ir para a visão da rede
          </Link>
        }
        className="min-h-96"
      />
    )
  }

  const notGenerated = quality.error instanceof ApiError && quality.error.status === 404
  const report = quality.data

  return (
    <div className="flex flex-col gap-6 md:gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-texto text-titulo-1">{TITLE}</h1>
        <p className="text-corpo text-texto-3">
          {report ? (
            <>
              <code className="id-tecnico">{report.source}</code> · gerado em{' '}
              {formatLongDateTime(report.generatedAt)} · {NETWORK_TIME_ZONE_LABEL}
            </>
          ) : (
            'O que a telemetria trouxe, o que ficou fora da série e por quê.'
          )}
        </p>
      </header>

      <RefreshFailed queries={[quality]} />
      {report ? (
        <QualityReportView report={report} />
      ) : notGenerated ? (
        <div className="cartao">
          <EmptyState
            icon={Clock01Icon}
            title="O relatório ainda não foi gerado"
            description="Ele sai quando a ingestão termina de reproduzir a telemetria. A tela se atualiza sozinha."
          />
        </div>
      ) : quality.isError ? (
        <div className="cartao">
          <ErrorState error={quality.error} onRetry={() => quality.refetch()} />
        </div>
      ) : (
        <LoadingReport />
      )}
    </div>
  )
}
