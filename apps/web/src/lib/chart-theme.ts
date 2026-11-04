/**
 * Ponte de tokens CSS para o canvas (seção 5.11). O ECharts não lê variáveis CSS, então o gráfico
 * pega as cores --grafico-* calculadas do documento: nenhuma cor fica escrita em TypeScript.
 */

const TOKENS = {
  temperatura: 'temperatura',
  acima: 'acima',
  abaixo: 'abaixo',
  foraHorario: 'fora-horario',
  variacao: 'variacao',
  externa: 'externa',
  comparacao: 'comparacao',
  faixa: 'faixa',
  faixaBorda: 'faixa-borda',
  faixaTexto: 'faixa-texto',
  fechado: 'fechado',
  semDados: 'sem-dados',
  descartada: 'descartada',
  descartadaFundo: 'descartada-fundo',
  grade: 'grade',
  eixo: 'eixo',
  cursor: 'cursor',
  zoom: 'zoom',
  superficie: 'superficie',
  pilula: 'pilula',
  naFaixa: 'na-faixa',
  acento: 'acento',
  trilho: 'trilho',
  alca: 'alca',
} as const

export type ChartTokens = Record<keyof typeof TOKENS, string> & { fontFamily: string }

let cache: ChartTokens | null = null

/** Lê os tokens uma vez por carga da página (o tema não muda em tempo de execução). */
export function chartTokens(root: Element = document.documentElement): ChartTokens {
  if (cache) return cache
  const css = getComputedStyle(root)
  const read = (name: string) => css.getPropertyValue(name).trim()
  const colors = Object.fromEntries(
    Object.entries(TOKENS).map(([key, name]) => [key, read(`--grafico-${name}`)]),
  ) as Record<keyof typeof TOKENS, string>
  cache = { ...colors, fontFamily: read('--font-sans') || 'sans-serif' }
  return cache
}

export interface HatchPattern {
  image: HTMLCanvasElement
  repeat: 'repeat'
  scaleX: number
  scaleY: number
}

/**
 * Hachura para markArea e itemStyle do ECharts: traço diagonal num ladrilho de 6 px, no mesmo
 * desenho dos utilitários hachura-sem-dados (45°, ↗) e hachura-descartada (135°, ↘). O ladrilho
 * tem 6 px de tela para ficar nítido, e a escala 1/DPR o devolve a 6 px CSS: o zrender pinta num
 * contexto já escalado pelo DPR. As pontas nos cantos fecham a emenda entre ladrilhos vizinhos.
 */
export function hatchPattern(
  stroke: string,
  fill: string,
  angle: 45 | 135,
  width = 1,
): HatchPattern | string {
  const ratio = globalThis.devicePixelRatio || 1
  const canvas = Object.assign(document.createElement('canvas'), { width: 6 * ratio, height: 6 * ratio })
  const context = canvas.getContext('2d')
  if (!context) return fill
  context.scale(ratio, ratio)
  context.fillStyle = fill
  context.fillRect(0, 0, 6, 6)
  context.strokeStyle = stroke
  context.lineWidth = width
  context.beginPath()
  const segments: ReadonlyArray<readonly [number, number, number, number]> =
    angle === 45
      ? [
          [0, 6, 6, 0],
          [-1, 1, 1, -1],
          [5, 7, 7, 5],
        ]
      : [
          [0, 0, 6, 6],
          [-1, 5, 1, 7],
          [5, -1, 7, 1],
        ]
  for (const [x1, y1, x2, y2] of segments) {
    context.moveTo(x1, y1)
    context.lineTo(x2, y2)
  }
  context.stroke()
  return { image: canvas, repeat: 'repeat', scaleX: 1 / ratio, scaleY: 1 / ratio }
}

/** Com movimento reduzido, o ECharts recebe animation: false (seção 1.7). */
export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/** As duas hachuras do gráfico, já com as cores dos tokens. */
export function chartHatches(tokens: ChartTokens = chartTokens()) {
  return {
    semDados: hatchPattern(tokens.semDados, tokens.superficie, 45, 1),
    descartada: hatchPattern(tokens.descartada, tokens.descartadaFundo, 135, 1.5),
  }
}
