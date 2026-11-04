import { Copy01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import { useEffect, useState } from 'react'
import { Hint } from './Hint'
import { Icon } from './Icon'

/**
 * Copia um texto (requestId, comando de terminal). Por 2 s o ícone vira um visto e o leitor de
 * tela ouve "Copiado". Com `showLabel`, mostra o rótulo ao lado do ícone ("Copiar comando").
 */
export function CopyButton({
  text,
  label = 'Copiar',
  showLabel = false,
  className,
}: {
  text: string
  label?: string
  showLabel?: boolean
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // Sem permissão de área de transferência: o texto continua visível para copiar à mão
    }
  }

  const button = (
    <button
      type="button"
      onClick={copy}
      aria-label={showLabel ? undefined : label}
      className={clsx(
        'pressionavel inline-flex shrink-0 items-center justify-center gap-1.5 rounded-sm font-medium text-apoio text-texto-3 hover:bg-realce hover:text-texto',
        showLabel ? 'h-7 px-2' : 'size-7',
        copied && 'text-ok-texto hover:text-ok-texto',
        className,
      )}
    >
      <Icon icon={copied ? Tick02Icon : Copy01Icon} size={14} />
      {showLabel && <span>{copied ? 'Copiado' : label}</span>}
      <span role="status" className="so-leitor">
        {copied ? 'Copiado' : ''}
      </span>
    </button>
  )
  return showLabel ? button : <Hint content={copied ? 'Copiado' : label}>{button}</Hint>
}
