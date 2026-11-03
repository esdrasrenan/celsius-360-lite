import type { PeriodKey, Role, StoreSort } from '@celsius/contracts'

export type Tone = 'ok' | 'alerta' | 'falha' | 'neutro' | 'quente' | 'frio'

export const DEVICE_STATUS: Record<string, { label: string; tone: Tone; hint: string }> = {
  online: { label: 'Online', tone: 'ok', hint: 'Comunicou nos últimos 15 min com leitura válida' },
  sensor_fault: {
    label: 'Falha no sensor',
    tone: 'alerta',
    hint: 'Comunica, mas sem leitura válida nos últimos 15 min (erro do sensor ou valor travado)',
  },
  offline: { label: 'Offline', tone: 'falha', hint: 'Sem comunicação há mais de 15 min' },
  no_data: { label: 'Sem dados', tone: 'neutro', hint: 'O dispositivo nunca enviou dados' },
}

export const STORE_STATUS: Record<string, { label: string; tone: Tone }> = {
  online: { label: 'Online', tone: 'ok' },
  degraded: { label: 'Parcial', tone: 'alerta' },
  offline: { label: 'Offline', tone: 'falha' },
  no_data: { label: 'Sem dados', tone: 'neutro' },
}

export const SITUATION: Record<string, { label: string; tone: Tone }> = {
  within: { label: 'Na faixa', tone: 'ok' },
  above: { label: 'Acima da faixa', tone: 'quente' },
  below: { label: 'Abaixo da faixa', tone: 'frio' },
  closed: { label: 'Fora do horário', tone: 'neutro' },
  unknown: { label: 'Sem leitura', tone: 'neutro' },
}

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  '1d': 'Último dia',
  '7d': 'Última semana',
  '30d': '30 dias',
}

export const SORT_LABEL: Record<StoreSort, string> = {
  status: 'Gravidade',
  comfort: 'Pior conforto',
  comfort_desc: 'Melhor conforto',
  out_of_range: 'Mais fora da faixa',
  name: 'Nome',
}

export const ROLE_LABEL: Record<Role, string> = {
  admin_diel: 'Administrador Diel',
  gestor_cliente: 'Gestor do cliente',
  gerente_loja: 'Gerente de loja',
}

export const GAP_REASON: Record<string, string> = {
  sensor_error: 'Erro do sensor',
  out_of_range: 'Fora da faixa física',
  spike: 'Picos descartados',
  stuck: 'Sensor travado',
}

export const COMFORT_TARGET = 90
