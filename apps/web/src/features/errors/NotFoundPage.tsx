import { Compass01Icon } from '@hugeicons/core-free-icons'
import { Link, useLocation } from 'react-router'
import { buttonClass } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { useDocumentTitle } from '../../lib/useDocumentTitle'

/** Rota inexistente (404), dentro da casca. */
export function NotFoundPage() {
  const { pathname } = useLocation()
  useDocumentTitle('Página não encontrada')
  return (
    <EmptyState
      heading="h1"
      icon={Compass01Icon}
      title="Página não encontrada"
      description={<code className="id-tecnico break-all">{pathname}</code>}
      actions={
        <Link to="/" className={buttonClass('primary')}>
          Ir para a visão da rede
        </Link>
      }
      className="min-h-96"
    />
  )
}
