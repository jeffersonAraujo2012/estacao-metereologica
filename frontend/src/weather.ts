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
export type FaixaHistograma = { inicio: number; fim: number; quantidade: number }
export type FaixaLuminosidade = {
  hora: string | number
  amostras: number
  minimo: number | null
  mediana: number | null
  maximo: number | null
}
export type Estatisticas = {
  amostras: number
  amostras_validas: number
  recorte_percentual_por_cauda: number | null
  media: number | null
  mediana: number | null
  desvio_padrao_amostral: number | null
  histograma: FaixaHistograma[]
  perfil_luminosidade?: FaixaLuminosidade[] | null
}

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

function medianaOrdenada(valores: number[]) {
  const n = valores.length
  return (valores[Math.floor((n - 1) / 2)] + valores[Math.floor(n / 2)]) / 2
}

export function estatisticasDemo(pontos: Ponto[], campo: CampoHistorico, periodo: Periodo): Estatisticas {
  const validos = pontos.map(ponto => ponto[campo]).filter(valor => valor !== null).sort((a, b) => a - b)
  const luminosidade = campo === 'luminosidade_pct' || campo === 'ldr_bruto'
  const recorte = campo === 'chuva_detectada' || luminosidade ? null : 2.5
  const cauda = Math.floor(validos.length * (recorte ?? 0) / 100)
  const valores = validos.slice(cauda, validos.length - cauda)
  const amostras = valores.length
  const base = { amostras, amostras_validas: validos.length, recorte_percentual_por_cauda: recorte }
  if (campo === 'chuva_detectada') return {
    ...base, media: null, mediana: null, desvio_padrao_amostral: null,
    histograma: [0, 1].map(estado => ({
      inicio: estado, fim: estado, quantidade: valores.filter(valor => valor === estado).length,
    })),
  }
  if (amostras === 0) return {
    ...base, media: null, mediana: null, desvio_padrao_amostral: null, histograma: [],
  }

  const media = valores.reduce((soma, valor) => soma + valor, 0) / amostras
  const desvios = valores.reduce((soma, valor) => soma + (valor - media) ** 2, 0)
  const resumo = {
    ...base, media, mediana: medianaOrdenada(valores),
    desvio_padrao_amostral: amostras > 1 ? Math.sqrt(desvios / (amostras - 1)) : null,
  }
  if (luminosidade) {
    const grupos = new Map<string | number, number[]>()
    if (periodo === '7d') for (let h = 0; h < 24; h++) grupos.set(h, [])
    for (const ponto of pontos) {
      const instante = Date.parse(ponto.inicio)
      const chave = periodo === '7d' ? Number(hora(instante).slice(0, 2))
        : new Date(Math.floor(instante / 3_600_000) * 3_600_000).toISOString()
      const grupo = grupos.get(chave) ?? []
      if (ponto[campo] !== null) grupo.push(ponto[campo])
      grupos.set(chave, grupo)
    }
    return {
      ...resumo, histograma: [],
      perfil_luminosidade: Array.from(grupos, ([horario, grupo]) => {
        grupo.sort((a, b) => a - b)
        return {
          hora: horario, amostras: grupo.length,
          minimo: grupo[0] ?? null, mediana: grupo.length ? medianaOrdenada(grupo) : null,
          maximo: grupo[grupo.length - 1] ?? null,
        }
      }),
    }
  }

  const minimo = valores[0]
  const maximo = valores[amostras - 1]
  const total = minimo === maximo ? 1 : 10
  const largura = (maximo - minimo) / total
  const histograma = Array.from({ length: total }, (_, indice) => ({
    inicio: minimo + indice * largura,
    fim: indice === total - 1 ? maximo : minimo + (indice + 1) * largura,
    quantidade: 0,
  }))
  for (const valor of valores) {
    const indice = largura ? Math.min(total - 1, Math.floor((valor - minimo) / largura)) : 0
    histograma[indice].quantidade += 1
  }
  return { ...resumo, histograma }
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
