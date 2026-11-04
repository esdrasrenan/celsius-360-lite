import { AlertCircleIcon, Refresh01Icon } from '@hugeicons/core-free-icons'
import type { ReactNode } from 'react'
import { isRouteErrorResponse, Link, useLocation, useRouteError } from 'react-router'
import { ApiError } from '../../api/client'
import { Button, buttonClass } from '../../components/Button'
import { CopyButton } from '../../components/CopyButton'
import { EmptyState } from '../../components/EmptyState'
import { BRAND_HOME_LABEL, BrandLockup } from '../../components/shell/BrandLockup'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { NotFoundPage } from './NotFoundPage'

/** Texto de "Detalhes técnicos": o que o suporte precisa para achar o erro, sem a pilha. */
export function technicalDetails(error: unknown, path: string): string {
  const lines = [`Endereço: ${path}`]
  if (isRouteErrorResponse(error)) lines.push(`HTTP ${error.status} ${error.statusText}`.trim())
  else if (error instanceof ApiError) {
    lines.push(error.status ? `HTTP ${error.status}: ${error.message}` : error.message)
    if (error.requestId) lines.push(`requestId: ${error.requestId}`)
  } else if (error instanceof Error) lines.push(`${error.name}: ${error.message}`)
  else lines.push(String(error))
  return lines.join('\n')
}

/** Fora da casca (erro na própria casca ou no login): a página leva o logo, como o cabeçalho. */
function BrandFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex h-cabecalho w-full max-w-conteudo items-center px-4 sm:px-6 lg:px-8">
        <a href="/" aria-label={BRAND_HOME_LABEL} className="rounded-sm">
          <BrandLockup />
        </a>
      </header>
      <main className="mx-auto flex w-full max-w-conteudo flex-1 flex-col justify-center px-4 pb-16 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  )
}

function CrashPage({ error, inShell }: { error: unknown; inShell: boolean }) {
  const { pathname, search } = useLocation()
  useDocumentTitle('Algo deu errado')
  const details = technicalDetails(error, pathname + search)

  return (
    <EmptyState
      heading="h1"
      tone="falha"
      icon={AlertCircleIcon}
      title="Algo deu errado"
      description="A tela encontrou um erro inesperado. Recarregar a página costuma resolver; se o erro continuar, os detalhes técnicos ajudam o suporte."
      className="min-h-96"
      actions={
        <div className="flex w-full flex-col items-center gap-5">
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" icon={Refresh01Icon} onClick={() => window.location.reload()}>
              Recarregar
            </Button>
            {/* Fora da casca, a volta recarrega o documento: o estado que quebrou não sobrevive */}
            <Link to="/" reloadDocument={!inShell} className={buttonClass('secondary')}>
              Ir para a visão da rede
            </Link>
          </div>
          <details className="w-full max-w-texto text-legenda text-texto-3">
            <summary className="mx-auto w-fit cursor-pointer select-none rounded-xs px-1 hover:text-texto-2">
              Detalhes técnicos
            </summary>
            <div className="mt-3 flex items-start gap-2 rounded-md bg-superficie-3 py-2 ps-3 pe-2 text-left">
              <pre className="id-tecnico min-w-0 flex-1 whitespace-pre-wrap break-words py-1.5">
                {details}
              </pre>
              <CopyButton text={details} label="Copiar detalhes" />
            </div>
          </details>
        </div>
      }
    />
  )
}

/**
 * errorElement da raiz e da casca (P0 #5): a página da marca "Algo deu errado" no lugar da tela
 * crua do React Router com a pilha. Dentro da casca, o cabeçalho continua.
 */
export function RouteError({ inShell = false }: { inShell?: boolean }) {
  const error = useRouteError()
  const content =
    isRouteErrorResponse(error) && error.status === 404 ? (
      <NotFoundPage />
    ) : (
      <CrashPage error={error} inShell={inShell} />
    )
  return inShell ? content : <BrandFrame>{content}</BrandFrame>
}
