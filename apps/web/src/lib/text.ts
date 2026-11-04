/** Forma de comparação sem acento e sem caixa: "São Paulo" e "sao paulo" casam. */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
}

/** Termos da busca, como a API os trata: até 5, separados por espaço. */
export function searchTerms(query: string): string[] {
  return foldText(query).split(/\s+/).filter(Boolean).slice(0, 5)
}

export function matchesSearch(text: string, query: string): boolean {
  const folded = foldText(text)
  return searchTerms(query).every((term) => folded.includes(term))
}

/**
 * Trechos de `text` (índices do texto original) que casam com algum termo da busca, comparando
 * sem acento. Cada caractere original vira zero ou mais caracteres na forma dobrada; o mapa
 * devolve a posição original de cada um.
 */
export function highlightRanges(text: string, query: string): Array<[number, number]> {
  const terms = searchTerms(query)
  if (terms.length === 0) return []
  let folded = ''
  const origin: number[] = []
  let index = 0
  for (const char of text) {
    const part = foldText(char)
    folded += part
    for (let i = 0; i < part.length; i++) origin.push(index)
    index += char.length
  }
  const ranges: Array<[number, number]> = []
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + 1)) {
      const start = origin[at] ?? 0
      const last = origin[at + term.length - 1] ?? start
      ranges.push([start, last + ((text.codePointAt(last) ?? 0) > 0xffff ? 2 : 1)])
    }
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const range of ranges) {
    const previous = merged.at(-1)
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1])
    else merged.push([...range])
  }
  return merged
}

/** Trunca no meio, para e-mail: ("ana.ribeiro@diel.example", 16) → "ana.ribe…example". */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`
}
