import { clsx } from 'clsx'
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { Hint } from './Hint'

/**
 * Texto que trunca no fim e mostra o texto completo numa dica só quando há corte de verdade
 * (seção 2.7). Com `wrapOnMobile`, quebra em até 2 linhas abaixo de md e trunca a partir dele.
 */
export function TruncatedText({
  text,
  children,
  wrapOnMobile = false,
  className,
}: {
  /** Texto completo da dica. */
  text: string
  /** Conteúdo visível, quando difere do texto (ex.: com <Highlight>). */
  children?: ReactNode
  wrapOnMobile?: boolean
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [cut, setCut] = useState(false)

  // Mede de novo quando o texto muda; o ResizeObserver cobre a mudança de largura
  useLayoutEffect(() => {
    const element = ref.current
    if (!element || text === '') return
    const check = () =>
      setCut(element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight + 1)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])

  return (
    <Hint content={text} disabled={!cut}>
      <span
        ref={ref}
        className={clsx(
          'block min-w-0',
          wrapOnMobile ? 'line-clamp-2 break-words md:line-clamp-none md:truncate' : 'truncate',
          className,
        )}
      >
        {children ?? text}
      </span>
    </Hint>
  )
}
