export type Periodo = '24h' | '7d'

export const metricas = [
  { campo: 'temperatura_dht22_c', nome: 'Temperatura do ar', sensor: 'DHT22', unidade: '°C', simbolo: '°' },
  { campo: 'umidade_pct', nome: 'Umidade relativa', sensor: 'DHT22', unidade: '%', simbolo: '%' },
  { campo: 'pressao_hpa', nome: 'Pressão atmosférica', sensor: 'BMP180', unidade: 'hPa', simbolo: '↕' },
  { campo: 'luminosidade_pct', nome: 'Luminosidade', sensor: 'LDR', unidade: '%', simbolo: '☼' },
  { campo: 'temperatura_bmp180_c', nome: 'Temperatura do sensor', sensor: 'BMP180', unidade: '°C', simbolo: '°' },
  { campo: 'ldr_bruto', nome: 'Luminosidade bruta', sensor: 'LDR', unidade: '', simbolo: '◐' },
] as const

export type CampoNumerico = typeof metricas[number]['campo']
export type CampoHistorico = CampoNumerico | 'chuva_detectada'
export type Leitura = Record<CampoNumerico, number | null> & {
  id: string
  coletado_em: string | null
  chuva_detectada: boolean | null
}

export type Ponto = Record<CampoNumerico, number | null> & {
  inicio: string
  amostras: number
  chuva_detectada: 0 | 1 | null
}
export type Historico = { inicio: string; fim: string; intervalo_minutos: number; pontos: Ponto[] }

export const metricasDoGrafico = [
  ...metricas,
  { campo: 'chuva_detectada', nome: 'Detecção de chuva', unidade: '' },
] as const

const horaLocal = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
})
const dataLocal = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
})
const numeroLocal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })

export const hora = (instante: Date | number) => horaLocal.format(instante)
export const dia = (instante: Date | number) => dataLocal.format(instante)
export const numero = (valor: number) => numeroLocal.format(valor)

export async function consultar<T>(rota: string, signal: AbortSignal): Promise<T | null> {
  const resposta = await fetch(`/api/v1/leituras/${rota}`, { signal })
  if (resposta.status === 404 && rota === 'ultima') return null
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`)
  return resposta.json() as Promise<T>
}

export function demonstracao(periodo: Periodo): { leitura: Leitura; historico: Historico } {
  const intervalo = periodo === '24h' ? 15 : 60
  const duracao = intervalo * 60_000
  const fim = Date.now()
  const inicio = fim - (periodo === '24h' ? 1 : 7) * 86_400_000
  const pontos: Ponto[] = []
  for (let instante = Math.floor(inicio / duracao) * duracao; instante < fim; instante += duracao) {
    const fase = (instante / 86_400_000) * Math.PI * 2
    const sol = Math.sin(fase - 1.1)
    const oscilacao = Math.sin(fase * 9) * 0.6 + Math.sin(fase * 14.5) * 0.4
    pontos.push({
      inicio: new Date(instante).toISOString(),
      amostras: 0,
      temperatura_dht22_c: 23 + sol * 4.2 + oscilacao,
      temperatura_bmp180_c: 23.4 + sol * 4.2 + oscilacao,
      umidade_pct: 67 - sol * 13 + oscilacao * 2,
      pressao_hpa: 931.5 + Math.sin(fase / 2) * 2.4 + oscilacao / 2,
      luminosidade_pct: Math.max(0, sol * 78 + oscilacao * 7),
      ldr_bruto: Math.max(0, sol * 2600 + oscilacao * 180),
      chuva_detectada: sol < -0.8 && Math.sin(fase / 4) > 0 ? 1 : 0,
    })
  }
  const ultimo = pontos[pontos.length - 1]
  return {
    leitura: {
      ...ultimo,
      id: 'demonstracao',
      coletado_em: new Date(fim).toISOString(),
      temperatura_dht22_c: 24.7,
      umidade_pct: 68.4,
      pressao_hpa: 932.1,
      luminosidade_pct: 73,
      chuva_detectada: false,
    },
    historico: {
      inicio: new Date(inicio).toISOString(),
      fim: new Date(fim).toISOString(),
      intervalo_minutos: intervalo,
      pontos,
    },
  }
}
