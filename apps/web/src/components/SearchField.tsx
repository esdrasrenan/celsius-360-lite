import { Cancel01Icon, Loading03Icon, Search01Icon } from '@hugeicons/core-free-icons'
import { clsx } from 'clsx'
import { type RefObject, useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { useDelayed } from '../lib/hooks'
import { Hint } from './Hint'
import { Icon } from './Icon'

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT')

/**
 * Busca da seção 3.9. O valor confirmado (`value`) vem de fora, normalmente da URL, que é a única
 * fonte: uma mudança externa (clique no logo, voltar do navegador) substitui o texto local. A
 * digitação é confirmada depois de `debounceMs`; limpar confirma na hora. "/" foca o campo fora
 * de outros campos; Esc limpa e, com o campo vazio, tira o foco. O spinner só aparece se a
 * consulta (`busy`) passar de 150 ms.
 */
export function SearchField({
  value,
  onValueChange,
  label,
  placeholder,
  busy = false,
  debounceMs = 250,
  maxLength = 80,
  shortcut = true,
  inputRef,
  className,
}: {
  value: string
  onValueChange: (value: string) => void
  /** Nome acessível, oculto ("Buscar lojas"). */
  label: string
  placeholder?: string
  busy?: boolean
  debounceMs?: number
  maxLength?: number
  /** Atalho "/" para focar. */
  shortcut?: boolean
  /** Para a tela devolver o foco à busca (ao remover um chip de filtro, por exemplo). */
  inputRef?: RefObject<HTMLInputElement | null>
  className?: string
}) {
  const id = useId()
  const ownRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? ownRef
  const [text, setText] = useState(value)
  const [focused, setFocused] = useState(false)
  const committed = useRef(value)
  const spinning = useDelayed(busy, 150)

  const commit = useEffectEvent((next: string) => {
    committed.current = next
    onValueChange(next)
  })

  // Mudança que não veio daqui (a URL mudou por fora) vence o texto local
  useEffect(() => {
    if (value === committed.current) return
    committed.current = value
    setText(value)
  }, [value])

  useEffect(() => {
    if (text === committed.current) return
    const timer = setTimeout(() => commit(text), debounceMs)
    return () => clearTimeout(timer)
  }, [text, debounceMs])

  useEffect(() => {
    if (!shortcut) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target))
        return
      event.preventDefault()
      ref.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [shortcut, ref])

  const clear = () => {
    setText('')
    commit('')
  }

  return (
    <div className={clsx('relative min-w-0', className)}>
      <label htmlFor={id} className="so-leitor">
        {label}
      </label>
      <span className="pointer-events-none absolute start-3 top-1/2 flex -translate-y-1/2 text-texto-3">
        <Icon
          icon={spinning ? Loading03Icon : Search01Icon}
          className={spinning ? 'motion-safe:animate-spin' : undefined}
        />
      </span>
      <input
        ref={ref}
        id={id}
        type="search"
        value={text}
        maxLength={maxLength}
        placeholder={placeholder}
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        aria-busy={spinning || undefined}
        onChange={(event) => setText(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          if (text) {
            // Com valor, Esc só limpa: não deixa a gaveta ou o popup em volta fechar junto
            event.stopPropagation()
            clear()
          } else event.currentTarget.blur()
        }}
        className="h-controle w-full appearance-none text-ellipsis rounded-md bg-superficie ps-9 pe-16 text-corpo-lg text-texto shadow-controle ring-1 ring-borda-controle ring-inset transition-shadow duration-100 ease-linear placeholder:text-texto-3 hover:ring-borda-controle-hover sm:text-corpo pointer-coarse:h-controle-toque"
      />
      <span className="absolute end-2 top-1/2 flex -translate-y-1/2 items-center">
        {text ? (
          <Hint content="Limpar busca">
            <button
              type="button"
              aria-label="Limpar busca"
              onClick={() => {
                clear()
                ref.current?.focus()
              }}
              className="inline-flex size-6 items-center justify-center rounded-sm text-texto-3 transition-colors duration-100 ease-linear hover:bg-realce hover:text-texto pointer-coarse:size-8"
            >
              <Icon icon={Cancel01Icon} />
            </button>
          </Hint>
        ) : (
          !focused &&
          shortcut && (
            <kbd className="id-tecnico inline-flex h-5 min-w-5 items-center justify-center rounded-xs px-1 ring-1 ring-borda pointer-coarse:hidden">
              /
            </kbd>
          )
        )}
      </span>
    </div>
  )
}
