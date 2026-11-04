import { Fragment } from 'react'
import { highlightRanges } from '../lib/text'

/**
 * Destaca com <mark> os termos da busca no texto, comparando sem acento e sem caixa: "sao paulo"
 * marca "São Paulo". Sem busca, devolve o texto puro.
 */
export function Highlight({ text, query }: { text: string; query: string | null | undefined }) {
  const ranges = query ? highlightRanges(text, query) : []
  if (ranges.length === 0) return <>{text}</>
  const parts: Array<{ text: string; marked: boolean; at: number }> = []
  let cursor = 0
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), marked: false, at: cursor })
    parts.push({ text: text.slice(start, end), marked: true, at: start })
    cursor = end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), marked: false, at: cursor })
  return (
    <>
      {parts.map((part) =>
        part.marked ? <mark key={part.at}>{part.text}</mark> : <Fragment key={part.at}>{part.text}</Fragment>,
      )}
    </>
  )
}
