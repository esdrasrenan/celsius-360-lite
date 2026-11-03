export interface SourceLine {
  /** Posição da linha no arquivo (1, 2, 3...): a ordem de chegada ao broker */
  seq: number
  line: string
}

/**
 * Lê o arquivo de telemetria em fluxo, sem carregá-lo inteiro na memória, e retoma depois de `afterSeq`.
 * Aceita .jsonl e .jsonl.gz. Linhas vazias contam na numeração, mas não são entregues.
 */
export async function* readLines(path: string, afterSeq = 0): AsyncGenerator<SourceLine> {
  // Os tipos do DOM declaram BufferSource na entrada desses streams; em runtime eles recebem Uint8Array
  let stream: ReadableStream<Uint8Array> = Bun.file(path).stream()
  if (path.endsWith('.gz')) {
    stream = stream.pipeThrough(
      new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>,
    )
  }
  const reader = stream
    .pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>)
    .getReader()

  let buffer = ''
  let seq = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let start = 0
    for (let end = buffer.indexOf('\n', start); end >= 0; end = buffer.indexOf('\n', start)) {
      const line = buffer.slice(start, end).replace(/\r$/, '')
      start = end + 1
      seq++
      if (seq > afterSeq && line.trim()) yield { seq, line }
    }
    buffer = buffer.slice(start)
  }
  if (buffer.trim()) {
    seq++
    if (seq > afterSeq) yield { seq, line: buffer }
  }
}

/** Primeira e última linha não vazias, sem percorrer o arquivo (para saber o período dos dados). */
export async function boundaryLines(path: string): Promise<{ first: string; last: string } | null> {
  const file = Bun.file(path)
  if (!(await file.exists()) || path.endsWith('.gz')) return null
  const head = await file.slice(0, 64 * 1024).text()
  const tail = await file.slice(Math.max(0, file.size - 64 * 1024)).text()
  const first = head.split('\n').find((line) => line.trim())
  const last = tail
    .split('\n')
    .filter((line) => line.trim())
    .at(-1)
  return first && last ? { first, last } : null
}
