import { describe, expect, test } from 'bun:test'
import type { QualityReport } from '@celsius/contracts'
import { anomalies, discardsByReason, environmentHref, periodCovering, tableCsv } from './report'

// Os números do conjunto real (docs/qualidade-dos-dados.md)
const report: QualityReport = {
  generatedAt: '2026-11-04T01:11:13.353Z',
  source: 'telemetrias.jsonl',
  packets: {
    total: 180_951,
    invalid: 0,
    exactDuplicates: 1_099,
    savedData: 247,
    late: { packets: 239, withSavedData: 239, maxMinutes: 343, thresholdMinutes: 15 },
    futureTimestamp: { packets: 0, toleranceMinutes: 10, devices: [] },
  },
  devices: {
    registered: 25,
    reporting: 26,
    reboots: 47,
    unknown: [{ deviceId: 'IOT099', packets: 481, from: '2026-02-01T03:05:46Z', to: '2026-02-03T02:59:46Z' }],
  },
  samples: {
    total: 2_152_464,
    valid: 2_149_519,
    sensorError: 332,
    outOfRange: 0,
    spike: 0,
    stuck: 2_613,
    rawErrorCodes: { minus127: 286, plus85: 47 },
  },
  stuckEpisodes: [
    {
      deviceId: 'IOT009',
      environmentId: 'AMB-009',
      from: '2026-01-21T19:15:51Z',
      to: '2026-01-22T06:09:51Z',
      minutes: 654,
      value: 23.2,
      samples: 1_309,
    },
  ],
  gaps: [
    {
      deviceId: 'IOT014',
      environmentId: 'AMB-014',
      from: '2026-01-26T04:45:00Z',
      to: '2026-01-26T10:30:00Z',
      minutes: 345,
    },
    {
      deviceId: 'IOT004',
      environmentId: 'AMB-004',
      from: '2026-02-04T11:05:00Z',
      to: '2026-02-04T13:20:00Z',
      minutes: 135,
    },
  ],
}

describe('anomalias com evidência', () => {
  test('as que ocorreram vêm primeiro, com a evidência tirada do relatório', () => {
    const rows = anomalies(report)
    expect(rows.slice(0, 7).map((row) => row.id)).toEqual([
      'duplicate',
      'late',
      'minus127',
      'plus85',
      'stuck',
      'unknown-device',
      'gap',
    ])
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]))
    expect(byId.duplicate?.evidence).toStartWith('0,6% dos pacotes')
    expect(byId.late?.evidence).toBe(
      'Chegaram de 15 min a 5 h 43 min depois; todos com saved_data, guardado pelo dispositivo sem conexão.',
    )
    expect(byId.stuck?.evidence).toBe('1 episódio: IOT009 em 23,2 °C por 10 h 54 min.')
    expect(byId.gap?.evidence).toStartWith('De 2 h 15 min a 5 h 45 min sem pacote, em IOT004 e IOT014')
    expect(byId['unknown-device']?.unit).toBe('dispositivo')
  })

  test('regras defensivas que não dispararam ficam no fim, com zero', () => {
    const tail = anomalies(report).slice(-4)
    expect(tail.map((row) => [row.id, row.count])).toEqual([
      ['future', 0],
      ['invalid', 0],
      ['spike', 0],
      ['out-of-range', 0],
    ])
    expect(tail[0]?.evidence).toBe('Nenhum pacote mais de 10 min à frente do "agora".')
  })
})

describe('descartes por motivo', () => {
  test('soma os motivos e ordena do maior para o menor', () => {
    const { total, reasons } = discardsByReason(report)
    expect(total).toBe(2_945)
    expect(reasons.map((share) => share.reason)).toEqual(['stuck', 'sensor_error', 'spike', 'out_of_range'])
    expect(reasons[0]?.pct).toBeCloseTo(88.73, 1)
  })
})

describe('link para o detalhe no período certo', () => {
  const now = '2026-02-11T02:59:56Z'
  test('o menor período que mostra o trecho inteiro', () => {
    expect(periodCovering('2026-02-10T12:00:00Z', now)).toBe('1d')
    expect(periodCovering('2026-02-04T11:05:00Z', now)).toBe('7d')
    expect(periodCovering('2026-01-21T19:15:51Z', now)).toBe('30d')
  })

  test('sem o "agora", 30 dias', () => {
    expect(environmentHref('AMB-004', '2026-02-04T11:05:00Z', null)).toBe('/ambientes/AMB-004?periodo=30d')
  })
})

describe('CSV', () => {
  test('ponto e vírgula, decimal com vírgula e aspas só quando precisa', () => {
    const csv = tableCsv(
      [
        { header: 'Dispositivo', value: (row: { id: string; value: number; note: string | null }) => row.id },
        { header: 'Valor (°C)', value: (row) => row.value },
        { header: 'Nota', value: (row) => row.note },
      ],
      [
        { id: 'IOT009', value: 23.2, note: 'travado; "sensor"' },
        { id: 'IOT014', value: 22, note: null },
      ],
    )
    expect(csv).toBe('﻿Dispositivo;Valor (°C);Nota\r\nIOT009;23,2;"travado; ""sensor"""\r\nIOT014;22;\r\n')
  })

  test('dev_id fora do cadastro que começa com "=" não vira fórmula na planilha', () => {
    const csv = tableCsv(
      [{ header: 'Dispositivo', value: (row: { id: string }) => row.id }],
      [{ id: '=HYPERLINK("https://exemplo.invalido";"IOT099")' }],
    )
    expect(csv.split('\r\n')[1]).toBe(`"'=HYPERLINK(""https://exemplo.invalido"";""IOT099"")"`)
  })
})
