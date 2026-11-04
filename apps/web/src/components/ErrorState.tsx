import { AlertCircleIcon } from '@hugeicons/core-free-icons'
import { useState } from 'react'
import { Link } from 'react-router'
import { ApiError } from '../api/client'
import { Button, buttonClass } from './Button'
import { CopyButton } from './CopyButton'
import { EmptyState } from './EmptyState'

export type ErrorAction = 'retry' | 'clear-filters' | 'home' | null

export interface ErrorDescription {
  title: string
  description?: string
  action: ErrorAction
  status: number | null
  requestId: string | null
}

/** Traduz um erro em mensagem e ação (seção 3.13). Exportado para quem mostra o erro em linha. */
export function describeError(error: unknown): ErrorDescription {
  if (!(error instanceof ApiError)) {
    return {
      title: 'Algo deu errado',
      description: 'Tente de novo em instantes.',
      action: 'retry',
      status: null,
      requestId: null,
    }
  }
  const base = { status: error.status || null, requestId: error.requestId }
  if (error.status === 0)
    return {
      ...base,
      title: 'Sem conexão com a API',
      description: 'Confira se a stack está no ar.',
      action: 'retry',
    }
  if (error.status >= 500)
    return {
      ...base,
      title: 'O servidor não respondeu',
      description: 'Tente de novo em instantes.',
      action: 'retry',
    }
  if (error.status === 400)
    return {
      ...base,
      title: 'Um filtro da URL era inválido',
      description: error.problem?.detail || 'Limpe os filtros para ver a lista de novo.',
      action: 'clear-filters',
    }
  if (error.status === 401)
    return {
      ...base,
      title: 'Sua sessão expirou',
      description: 'Entre de novo para continuar.',
      action: null,
    }
  if (error.status === 403) return { ...base, title: 'Você não tem acesso a este recurso', action: 'home' }
  if (error.status === 404)
    return {
      ...base,
      title: 'Não encontrado',
      description: 'O endereço não existe ou saiu do seu acesso.',
      action: 'home',
    }
  return { ...base, title: 'Algo deu errado', description: 'Tente de novo em instantes.', action: 'retry' }
}

/**
 * Estado de erro: mensagem em pt-BR conforme o status, a ação certa ("Tentar de novo" fica ocupado
 * enquanto o refetch roda) e, em "Detalhes técnicos", o status e o requestId com botão de copiar.
 */
export function ErrorState({
  error,
  onRetry,
  onClearFilters,
  homeHref = '/',
  heading = 'h2',
  className,
}: {
  error: unknown
  /** Normalmente o refetch() da consulta. */
  onRetry?: () => unknown
  onClearFilters?: () => void
  homeHref?: string
  heading?: 'h1' | 'h2'
  className?: string
}) {
  const [retrying, setRetrying] = useState(false)
  const info = describeError(error)

  const retry = async () => {
    setRetrying(true)
    try {
      await onRetry?.()
    } finally {
      setRetrying(false)
    }
  }

  const action =
    info.action === 'retry' && onRetry ? (
      <Button variant="primary" busy={retrying} busyLabel="Tentando…" onClick={retry}>
        Tentar de novo
      </Button>
    ) : info.action === 'clear-filters' && onClearFilters ? (
      <Button variant="primary" onClick={onClearFilters}>
        Limpar filtros
      </Button>
    ) : info.action === 'home' ? (
      <Link to={homeHref} className={buttonClass('primary')}>
        Ir para a visão da rede
      </Link>
    ) : null

  const details = (info.status || info.requestId) && (
    <details className="text-legenda text-texto-3">
      <summary className="cursor-pointer select-none rounded-xs hover:text-texto-2">
        Detalhes técnicos
      </summary>
      <div className="mt-2 flex items-center gap-2">
        {info.status && <span className="num">HTTP {info.status}</span>}
        {info.requestId && (
          <>
            <code className="id-tecnico">{info.requestId}</code>
            <CopyButton text={info.requestId} label="Copiar requestId" />
          </>
        )}
      </div>
    </details>
  )

  return (
    <div role="alert" className={className}>
      <EmptyState
        tone="falha"
        icon={AlertCircleIcon}
        heading={heading}
        title={info.title}
        description={info.description}
        actions={
          (action || details) && (
            <div className="flex flex-col items-center gap-3">
              {action}
              {details}
            </div>
          )
        }
      />
    </div>
  )
}
