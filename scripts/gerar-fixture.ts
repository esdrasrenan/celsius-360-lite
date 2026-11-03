/**
 * Gera os dados de teste (test/fixtures): um cadastro sintético e dois dias de telemetria com as
 * mesmas anomalias encontradas nos dados do desafio, além do resultado esperado de cada uma.
 * Determinístico: rodar de novo produz os mesmos arquivos.
 *
 *   bun run scripts/gerar-fixture.ts
 */
import { resolve } from 'node:path'

const OUT = resolve(import.meta.dir, '../test/fixtures')
const STEP_S = 30
const PER_PACKET = 12
const PACKET_S = STEP_S * PER_PACKET
const GMT = -3

// Gerador pseudoaleatório com semente fixa (mulberry32)
let seed = 42
function random() {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const allWeek = (from: string, to: string) =>
  Object.fromEntries(['seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom'].map((day) => [day, [from, to]]))

const registry = {
  clientes: [
    { id: 'CLI-T1', nome: 'Rede Teste', segmento: 'varejo' },
    { id: 'CLI-T2', nome: 'Outro Cliente', segmento: 'bancário' },
  ],
  lojas: [
    {
      id: 'LOJA-T-SP',
      cliente_id: 'CLI-T1',
      nome: 'Loja Centro',
      tipo: 'loja de rua',
      cidade: 'São Paulo',
      uf: 'SP',
      latitude: -23.55,
      longitude: -46.63,
      fuso_horario: 'America/Sao_Paulo',
      horario_funcionamento: { ...allWeek('09:00', '18:00'), dom: null },
    },
    {
      id: 'LOJA-T-PE',
      cliente_id: 'CLI-T2',
      nome: 'Agência Recife',
      tipo: 'agência bancária',
      cidade: 'Recife',
      uf: 'PE',
      latitude: -8.05,
      longitude: -34.9,
      fuso_horario: 'America/Recife',
      horario_funcionamento: allWeek('08:00', '20:00'),
    },
  ],
  ambientes: [
    {
      id: 'AMB-T1',
      loja_id: 'LOJA-T-SP',
      nome: 'Salão',
      faixa_conforto_c: { min: 21, max: 25 },
      horario_funcionamento: { ...allWeek('09:00', '18:00'), dom: null },
      dev_id: 'DEV-A',
    },
    {
      id: 'AMB-T2',
      loja_id: 'LOJA-T-SP',
      nome: 'Sala técnica',
      faixa_conforto_c: { min: 18, max: 24 },
      horario_funcionamento: allWeek('00:00', '24:00'),
      dev_id: 'DEV-B',
    },
    {
      id: 'AMB-T3',
      loja_id: 'LOJA-T-PE',
      nome: 'Atendimento',
      faixa_conforto_c: { min: 21, max: 24 },
      horario_funcionamento: allWeek('08:00', '20:00'),
      dev_id: 'DEV-C',
    },
  ],
  usuarios: [
    {
      id: 'USR-T1',
      nome: 'Admin Teste',
      email: 'admin@teste.example',
      perfil: 'admin_diel',
      cliente_id: null,
      lojas: null,
    },
    {
      id: 'USR-T2',
      nome: 'Gestor Teste',
      email: 'gestor@teste.example',
      perfil: 'gestor_cliente',
      cliente_id: 'CLI-T1',
      lojas: null,
    },
    {
      id: 'USR-T3',
      nome: 'Gerente Teste',
      email: 'gerente@teste.example',
      perfil: 'gerente_loja',
      cliente_id: 'CLI-T2',
      lojas: ['LOJA-T-PE'],
    },
  ],
}

// Dois dias: segunda 02/03/2026 00:00 a quarta 04/03/2026 00:00, horário local (UTC-3)
const START = Date.parse('2026-03-02T03:00:00Z') + PACKET_S * 1000
const END = Date.parse('2026-03-04T03:00:00Z')

const localIso = (utcMs: number) => new Date(utcMs + GMT * 3_600_000).toISOString().slice(0, 19)
const at = (local: string) => Date.parse(`${local}Z`) - GMT * 3_600_000

interface Packet {
  sendAt: number
  arriveAt: number
  body: Record<string, unknown>
}

const packets: Packet[] = []
const expected = {
  devices: {} as Record<string, number>,
  sensorErrorSamples: 0,
  stuckSamples: 0,
  savedDataPackets: 0,
  exactDuplicates: 0,
  invalidLines: 0,
  unknownDevicePackets: 0,
  offlineAtEnd: [] as string[],
}

function temperature(deviceId: string, utcMs: number): number {
  const hour = new Date(utcMs + GMT * 3_600_000).getUTCHours()
  const base = deviceId === 'DEV-B' ? 20.5 : deviceId === 'DEV-C' ? 22.5 : 23
  const daily = (deviceId === 'DEV-B' ? 0.6 : 1.8) * Math.sin(((hour - 9) / 24) * 2 * Math.PI)
  return Math.round((base + daily + (random() - 0.5) * 0.3) * 10) / 10
}

function emit(deviceId: string, lastSampleMs: number, arriveAt: number, values: number[], savedData = false) {
  packets.push({
    sendAt: lastSampleMs,
    arriveAt,
    body: {
      dev_id: deviceId,
      timestamp: localIso(lastSampleMs),
      GMT,
      samplingTime: STEP_S,
      Temperature: values,
      ...(savedData ? { saved_data: true } : {}),
    },
  })
}

for (const deviceId of ['DEV-A', 'DEV-B', 'DEV-C']) {
  let unique = 0
  for (let last = START + (deviceId === 'DEV-B' ? 7_000 : 0); last <= END; last += PACKET_S * 1000) {
    const local = localIso(last)
    // DEV-B: sem comunicação das 12:00 às 14:00 de terça e desligado a partir das 22:00 de terça
    if (deviceId === 'DEV-B' && last >= at('2026-03-03T12:00:00') && last < at('2026-03-03T14:00:00'))
      continue
    if (deviceId === 'DEV-B' && last >= at('2026-03-03T22:00:00')) continue

    let values = Array.from({ length: PER_PACKET }, (_, index) =>
      temperature(deviceId, last - (PER_PACKET - 1 - index) * STEP_S * 1000),
    )
    // DEV-A: sensor travado em 22,4 °C das 22:00 às 23:30 de segunda (90 min)
    const runStart = at('2026-03-02T22:00:00')
    const runEnd = at('2026-03-02T23:30:00')
    if (deviceId === 'DEV-A') {
      values = values.map((value, index) => {
        const ts = last - (PER_PACKET - 1 - index) * STEP_S * 1000
        if (ts >= runStart && ts < runEnd) {
          expected.stuckSamples++
          return 22.4
        }
        return value
      })
    }
    // DEV-A: uma leitura -127 (sensor desconectado) às 10:00 de segunda
    if (deviceId === 'DEV-A' && local === '2026-03-02T10:00:00') {
      values[5] = -127
      expected.sensorErrorSamples++
    }
    // DEV-B: reinício às 05:00 de terça; a primeira amostra é o 85 do power-on
    if (deviceId === 'DEV-B' && local.startsWith('2026-03-03T05:0')) {
      values[0] = 85
      expected.sensorErrorSamples++
    }

    // DEV-C: das 08:00 às 09:00 de terça os pacotes ficam no dispositivo e chegam às 10:03 com saved_data
    const held = deviceId === 'DEV-C' && last >= at('2026-03-03T08:00:00') && last < at('2026-03-03T09:00:00')
    if (held) expected.savedDataPackets++
    emit(deviceId, last, held ? at('2026-03-03T10:03:00') + (last % 1000) : last, values, held)
    unique++

    // DEV-C: um pacote reenviado em duplicata exata, 20 s depois
    if (deviceId === 'DEV-C' && local.startsWith('2026-03-02T15:0')) {
      emit(deviceId, last, last + 20_000, values)
      expected.exactDuplicates++
    }
  }
  expected.devices[deviceId] = unique
}
expected.offlineAtEnd = ['DEV-B']

// Dispositivo fora do cadastro: 10 pacotes na segunda à tarde
for (let index = 0; index < 10; index++) {
  const last = at('2026-03-02T14:00:00') + index * PACKET_S * 1000
  emit(
    'DEV-X',
    last,
    last,
    Array.from({ length: PER_PACKET }, () => 24),
  )
  expected.unknownDevicePackets++
}

packets.sort((a, b) => a.arriveAt - b.arriveAt || a.sendAt - b.sendAt)
const lines = packets.map((packet) => JSON.stringify(packet.body))
// Uma linha corrompida no meio do fluxo
lines.splice(Math.floor(lines.length / 3), 0, '{"dev_id":"DEV-A","timestamp":"2026-03-02T1')
expected.invalidLines = 1

const now = Math.max(...packets.map((packet) => packet.sendAt))
await Bun.write(resolve(OUT, 'cadastro.json'), `${JSON.stringify(registry, null, 2)}\n`)
await Bun.write(resolve(OUT, 'telemetria-fixture.jsonl'), `${lines.join('\n')}\n`)
await Bun.write(
  resolve(OUT, 'esperado.json'),
  `${JSON.stringify({ ...expected, lines: lines.length, now: new Date(now).toISOString() }, null, 2)}\n`,
)
console.info(`fixture gerada em ${OUT}: ${lines.length} linhas, agora = ${new Date(now).toISOString()}`)
