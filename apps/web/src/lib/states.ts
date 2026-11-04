import type {
  DeviceStatus,
  DiscardReason,
  Gap,
  PeriodKey,
  Role,
  Situation,
  StoreSort,
  StoreStatus,
} from '@celsius/contracts'
import { COMFORT_CRITICAL_PCT, COMFORT_TARGET_PCT, COVERAGE_MIN_PCT } from '@celsius/domain'
import {
  Alert02Icon,
  AlertDiamondIcon,
  ArrowDown02Icon,
  ArrowUp02Icon,
  CircleDashedIcon,
  Clock01Icon,
  MinusSignIcon,
  WifiDisconnected01Icon,
} from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'

/**
 * Vocabulário único de estados (seção 2.2): rótulo, tom, ícone, apresentação e dica. Lista, badge,
 * ponto, gráfico, legenda e filtros leem daqui, e nenhum outro arquivo define cor de estado.
 */

export type Tone = 'ok' | 'alerta' | 'falha' | 'neutro' | 'quente' | 'frio'

/**
 * silent: o normal, sem destaque (só o ponto); badge: pílula com fundo do tom;
 * outline: pílula contornada (fechado); text: só texto em texto-3 ("Na faixa").
 */
export type Presentation = 'silent' | 'badge' | 'outline' | 'text'

export interface StateInfo {
  label: string
  tone: Tone
  icon?: IconSvgElement
  presentation: Presentation
  hint: string
  /** false quando o estado fica fora do cálculo de conforto (loja fechada). */
  countsInComfort?: boolean
}

export { COMFORT_CRITICAL_PCT, COMFORT_TARGET_PCT, COVERAGE_MIN_PCT }

export const DEVICE_STATE: Record<DeviceStatus, StateInfo> = {
  online: {
    label: 'Online',
    tone: 'ok',
    presentation: 'silent',
    hint: 'Comunicou nos últimos 15 min com leitura válida.',
  },
  sensor_fault: {
    label: 'Falha no sensor',
    tone: 'alerta',
    icon: AlertDiamondIcon,
    presentation: 'badge',
    hint: 'Comunica, mas está sem leitura válida há mais de 15 min.',
  },
  offline: {
    label: 'Offline',
    tone: 'falha',
    icon: WifiDisconnected01Icon,
    presentation: 'badge',
    hint: 'Sem comunicação há mais de 15 min.',
  },
  no_data: {
    label: 'Sem dados',
    tone: 'neutro',
    icon: CircleDashedIcon,
    presentation: 'badge',
    hint: 'O dispositivo nunca enviou dados.',
  },
}

export const STORE_STATE: Record<StoreStatus, StateInfo> = {
  online: {
    label: 'Online',
    tone: 'ok',
    presentation: 'silent',
    hint: 'Todos os ambientes comunicaram nos últimos 15 min com leitura válida.',
  },
  degraded: {
    label: 'Parcial',
    tone: 'alerta',
    icon: Alert02Icon,
    presentation: 'badge',
    hint: 'Parte dos ambientes está offline, sem dados ou com falha no sensor.',
  },
  offline: {
    label: 'Offline',
    tone: 'falha',
    icon: WifiDisconnected01Icon,
    presentation: 'badge',
    hint: 'Nenhum ambiente da loja comunica há mais de 15 min.',
  },
  no_data: {
    label: 'Sem dados',
    tone: 'neutro',
    icon: CircleDashedIcon,
    presentation: 'badge',
    hint: 'Nenhum dispositivo da loja enviou dados.',
  },
}

/** Situação do ambiente agora. "Fechado" é do ambiente; para a loja, use STORE_CLOSED_LABEL. */
export const SITUATION_STATE: Record<Situation, StateInfo> = {
  within: {
    label: 'Na faixa',
    tone: 'neutro',
    presentation: 'text',
    hint: 'A última leitura válida está dentro da faixa de conforto.',
  },
  above: {
    label: 'Acima da faixa',
    tone: 'quente',
    icon: ArrowUp02Icon,
    presentation: 'badge',
    hint: 'A última leitura válida está acima da faixa de conforto.',
  },
  below: {
    label: 'Abaixo da faixa',
    tone: 'frio',
    icon: ArrowDown02Icon,
    presentation: 'badge',
    hint: 'A última leitura válida está abaixo da faixa de conforto.',
  },
  closed: {
    label: 'Fechado',
    tone: 'neutro',
    icon: Clock01Icon,
    presentation: 'outline',
    hint: 'Fora do horário de funcionamento: não entra no cálculo de conforto.',
    countsInComfort: false,
  },
  unknown: {
    label: 'Sem leitura',
    tone: 'neutro',
    icon: MinusSignIcon,
    presentation: 'badge',
    hint: 'Sem leitura válida recente para comparar com a faixa.',
  },
}

export const STORE_CLOSED_LABEL = 'Fechada'

export type Hatch = 'sem-dados' | 'descartada'

export interface GapInfo extends StateInfo {
  /** Nome do token do gráfico (--grafico-sem-dados, --grafico-descartada). */
  hatch: Hatch
  /** Utilitário CSS com a mesma hachura do gráfico, para swatch e badge. */
  hatchClass: 'hachura-sem-dados' | 'hachura-descartada'
}

export const NO_DATA_GAP: GapInfo = {
  label: 'Sem dados',
  tone: 'neutro',
  presentation: 'badge',
  hint: 'O dispositivo não enviou pacotes neste trecho.',
  hatch: 'sem-dados',
  hatchClass: 'hachura-sem-dados',
}

const discarded = (label: string, hint: string): GapInfo => ({
  label,
  hint,
  tone: 'alerta',
  presentation: 'badge',
  hatch: 'descartada',
  hatchClass: 'hachura-descartada',
})

export const DISCARD_REASON: Record<DiscardReason, GapInfo> = {
  stuck: discarded(
    'Sensor travado',
    'O valor ficou idêntico por 60 min ou mais e as leituras foram descartadas.',
  ),
  sensor_error: discarded('Erro do sensor', 'O sensor enviou códigos de erro (−127 ou 85).'),
  spike: discarded(
    'Picos descartados',
    'Leituras isoladas que saltaram 3 °C ou mais em relação às vizinhas.',
  ),
  out_of_range: discarded(
    'Fora da faixa física',
    'Leituras fora do intervalo plausível para um ambiente climatizado (−20 a 60 °C).',
  ),
}

const DISCARDED_WITHOUT_REASON = discarded(
  'Leitura descartada',
  'As leituras deste trecho foram descartadas.',
)

export function gapState(gap: Pick<Gap, 'kind' | 'reason'>): GapInfo {
  if (gap.kind === 'no_data') return NO_DATA_GAP
  return gap.reason ? DISCARD_REASON[gap.reason] : DISCARDED_WITHOUT_REASON
}

/** Tom da meta de conforto: ≥ 90 neutro, de 70 a 89,9 alerta, abaixo de 70 falha. */
export function comfortTone(pct: number | null | undefined): Tone {
  if (pct == null || pct >= COMFORT_TARGET_PCT) return 'neutro'
  return pct >= COMFORT_CRITICAL_PCT ? 'alerta' : 'falha'
}

/** Classes de cada tom. Ficam aqui, e não espalhadas, para o Tailwind achar os nomes completos. */
export const TONE_CLASS: Record<Tone, { solid: string; icon: string; text: string; soft: string }> = {
  ok: {
    solid: 'bg-ok',
    icon: 'text-ok',
    text: 'text-ok-texto',
    soft: 'bg-ok-fundo text-ok-texto ring-ok-borda',
  },
  alerta: {
    solid: 'bg-alerta',
    icon: 'text-alerta',
    text: 'text-alerta-texto',
    soft: 'bg-alerta-fundo text-alerta-texto ring-alerta-borda',
  },
  falha: {
    solid: 'bg-falha',
    icon: 'text-falha',
    text: 'text-falha-texto',
    soft: 'bg-falha-fundo text-falha-texto ring-falha-borda',
  },
  neutro: {
    solid: 'bg-neutro',
    icon: 'text-neutro',
    text: 'text-neutro-texto',
    soft: 'bg-neutro-fundo text-neutro-texto ring-neutro-borda',
  },
  quente: {
    solid: 'bg-quente',
    icon: 'text-quente',
    text: 'text-quente-texto',
    soft: 'bg-quente-fundo text-quente-texto ring-quente-borda',
  },
  frio: {
    solid: 'bg-frio',
    icon: 'text-frio',
    text: 'text-frio-texto',
    soft: 'bg-frio-fundo text-frio-texto ring-frio-borda',
  },
}

export const PERIOD_LABEL: Record<PeriodKey, string> = { '1d': '24 horas', '7d': '7 dias', '30d': '30 dias' }

/** Nome acessível do segmento de período. */
export const PERIOD_FULL_LABEL: Record<PeriodKey, string> = {
  '1d': 'Últimas 24 horas',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
}

export const SORT_LABEL: Record<StoreSort, string> = {
  status: 'Gravidade',
  comfort: 'Pior conforto',
  comfort_desc: 'Melhor conforto',
  out_of_range: 'Mais fora da faixa',
  worst_env: 'Pior ambiente',
  name: 'Nome (A–Z)',
}

export const ROLE_LABEL: Record<Role, string> = {
  admin_diel: 'Administrador Diel',
  gestor_cliente: 'Gestor do cliente',
  gerente_loja: 'Gerente de loja',
}

export interface Definition {
  term: string
  /** Primeira linha: a fórmula. As seguintes: exceções. */
  lines: string[]
}

/** Definições dos indicadores (seção 3.4), mostradas no popover de "Como é calculado". */
export const DEFINITIONS = {
  networkComfort: {
    term: 'Conforto da rede',
    lines: [
      'Parte do horário de funcionamento, somada em todos os ambientes, em que a leitura válida ficou dentro da faixa.',
      'Lacunas não entram na conta.',
    ],
  },
  belowTarget: {
    term: `Fora da meta de ${COMFORT_TARGET_PCT}%`,
    lines: [`Ambientes com conforto abaixo de ${COMFORT_TARGET_PCT}% no período escolhido.`],
  },
  outOfRangeNow: {
    term: 'Fora da faixa agora',
    lines: [
      'Ambientes abertos cuja última leitura válida está fora da faixa.',
      'Ambientes fechados não contam.',
    ],
  },
  telemetry: {
    term: 'Telemetria',
    lines: [
      'Online: comunicou nos últimos 15 min com leitura válida.',
      'Falha no sensor: comunica, mas sem leitura válida.',
      'Offline: sem comunicação há mais de 15 min.',
    ],
  },
  comfortInHours: {
    term: 'Conforto no horário',
    lines: ['Leituras válidas dentro da faixa ÷ leituras válidas com a loja aberta.'],
  },
  coverage: {
    term: 'Cobertura de dados',
    lines: ['Tempo de funcionamento com leitura válida ÷ tempo de funcionamento no período.'],
  },
  temperatureInHours: {
    term: 'Temperatura no horário',
    lines: ['Média das leituras válidas com a loja aberta.', 'A linha de baixo mostra as 24 h.'],
  },
  unavailabilityInHours: {
    term: 'Indisponibilidade no horário',
    lines: ['Trechos de 10 min ou mais sem leitura válida que caíram no horário de funcionamento.'],
  },
  comfortInPeriod: {
    term: 'Conforto no período',
    lines: [
      'Parte do horário de funcionamento com leitura válida dentro da faixa.',
      `O traço marca a meta de ${COMFORT_TARGET_PCT}%.`,
    ],
  },
} satisfies Record<string, Definition>
