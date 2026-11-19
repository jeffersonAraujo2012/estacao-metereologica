import { useEffect, useMemo, useRef, useState } from 'react'
import { dia, hora, numero, type CampoHistorico, type Historico, type Periodo } from './weather'

type Props = {
  historico: Historico
  campo: CampoHistorico
  unidade: string
  nome: string
  periodo: Periodo
  demo: boolean
}

export function HistoryChart({ historico, campo, unidade, nome, periodo, demo }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [selecionado, selecionar] = useState<number | null>(null)
  const [largura, atualizarLargura] = useState(0)
  const margem = { esquerda: 48, direita: 14, topo: 15, base: 35 }
  const altura = 253
  const serie = useMemo(() => {
    const passo = historico.intervalo_minutos * 60_000
    const inicio = Math.floor(Date.parse(historico.inicio) / passo) * passo
    const fim = Date.parse(historico.fim)
    const porInstante = new Map(historico.pontos.map(ponto => [Date.parse(ponto.inicio), ponto]))
    const pontos = []
    for (let instante = inicio; instante < fim; instante += passo) {
      const ponto = porInstante.get(instante)
      pontos.push({ instante, valor: ponto?.[campo] ?? null, amostras: ponto?.amostras })
    }
    return pontos
  }, [historico, campo])
  const valores = serie.flatMap(({ valor }) => valor === null ? [] : [valor])
  const area = largura - margem.esquerda - margem.direita
  const pontoAtivo = selecionado === null ? undefined : serie[selecionado]
  const temValores = valores.length > 0
  const chuva = campo === 'chuva_detectada'
  const rotuloPonto = (instante: number) => `${dia(instante)} às ${hora(instante)}`

  function formatarValor(valor: number | null, incluirUnidade = false) {
    if (valor === null) return 'Sem leitura'
    if (chuva) return valor === 1 ? '1 (Chovendo)' : '0 (Sem chuva)'
    return incluirUnidade && unidade ? `${numero(valor)} ${unidade}` : numero(valor)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observer = new ResizeObserver(() => atualizarLargura(canvas.clientWidth))
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [temValores])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || area <= 0 || !temValores) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const escala = window.devicePixelRatio || 1
    canvas.width = largura * escala
    canvas.height = altura * escala
    ctx.scale(escala, escala)

    const minimo = Math.min(...valores)
    const maximo = Math.max(...valores)
    const amplitude = Math.max(maximo - minimo, Math.abs(maximo) * 0.015, 1)
    const bruto = amplitude * 1.25 / 4
    const magnitude = 10 ** Math.floor(Math.log10(bruto))
    const passo = chuva ? 1 : ([1, 2, 2.5, 5, 10].find(valor => valor >= bruto / magnitude) ?? 10) * magnitude
    const piso = chuva ? 0 : Math.floor((minimo - amplitude * 0.07) / passo) * passo
    const teto = chuva ? 1 : Math.ceil((maximo + amplitude * 0.07) / passo) * passo
    const base = altura - margem.base
    const x = (indice: number) => margem.esquerda + (serie.length === 1 ? area / 2 : indice * area / (serie.length - 1))
    const y = (valor: number) => base - (valor - piso) * (base - margem.topo) / (teto - piso)

    ctx.font = '12px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    for (let valor = piso; valor <= teto + passo * 0.001; valor += passo) {
      const linha = y(valor)
      ctx.beginPath()
      ctx.strokeStyle = '#e7edea'
      ctx.moveTo(margem.esquerda, linha)
      ctx.lineTo(largura - margem.direita, linha)
      ctx.stroke()
      ctx.fillStyle = '#526566'
      ctx.fillText(numero(Number(valor.toFixed(3))), margem.esquerda - 9, linha)
    }

    ctx.textAlign = 'center'
    const totalMarcas = largura < 480 ? 4 : 7
    const indices = new Set(Array.from({ length: totalMarcas }, (_, indice) =>
      Math.round(indice * (serie.length - 1) / (totalMarcas - 1))))
    for (const indice of indices) {
      const instante = serie[indice].instante
      ctx.textAlign = indice === 0 ? 'left' : indice === serie.length - 1 ? 'right' : 'center'
      ctx.fillText(periodo === '24h' ? hora(instante) : dia(instante), x(indice), base + 20)
    }

    const preenchimento = ctx.createLinearGradient(0, margem.topo, 0, base)
    preenchimento.addColorStop(0, 'rgba(15, 134, 105, 0.22)')
    preenchimento.addColorStop(1, 'rgba(15, 134, 105, 0.015)')
    let trecho: [number, number][] = []
    function desenharTrecho(contexto: CanvasRenderingContext2D) {
      if (!trecho.length) return
      const [primeiroX, primeiroY] = trecho[0]
      contexto.beginPath()
      contexto.moveTo(primeiroX, primeiroY)
      let anteriorY = primeiroY
      for (const [px, py] of trecho.slice(1)) {
        if (chuva) contexto.lineTo(px, anteriorY)
        contexto.lineTo(px, py)
        anteriorY = py
      }
      contexto.strokeStyle = '#087f68'
      contexto.lineWidth = 2
      contexto.lineJoin = 'round'
      contexto.stroke()
      if (trecho.length === 1) {
        contexto.beginPath()
        contexto.fillStyle = '#087f68'
        contexto.arc(primeiroX, primeiroY, 3, 0, Math.PI * 2)
        contexto.fill()
      } else {
        contexto.lineTo(trecho[trecho.length - 1][0], base)
        contexto.lineTo(primeiroX, base)
        contexto.closePath()
        contexto.fillStyle = preenchimento
        contexto.fill()
      }
      trecho = []
    }
    serie.forEach(({ valor }, indice) => {
      if (valor === null) desenharTrecho(ctx)
      else trecho.push([x(indice), y(valor)])
    })
    desenharTrecho(ctx)

    if (selecionado !== null && pontoAtivo) {
      const linhaX = x(selecionado)
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = '#55716c'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(linhaX, margem.topo)
      ctx.lineTo(linhaX, base)
      ctx.stroke()
      ctx.setLineDash([])
      if (pontoAtivo.valor !== null) {
        ctx.fillStyle = '#087f68'
        ctx.beginPath()
        ctx.arc(linhaX, y(pontoAtivo.valor), 4, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  })

  if (!temValores) {
    return <p className="chart-empty">Sem valores de {nome.toLocaleLowerCase('pt-BR')} neste período.</p>
  }

  return (
    <>
      <div className="plot">
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          onPointerMove={event => {
            if (area <= 0) return
            const x = event.clientX - event.currentTarget.getBoundingClientRect().left - margem.esquerda
            selecionar(Math.max(0, Math.min(serie.length - 1, Math.round(x / area * (serie.length - 1)))))
          }}
          onPointerLeave={() => selecionar(null)}
        />
      </div>
      <div className="chart-control">
        <label htmlFor="ponto-historico">Explorar horário</label>
        <input
          id="ponto-historico" type="range" min={0} max={serie.length - 1}
          value={selecionado ?? serie.length - 1}
          aria-valuetext={pontoAtivo
            ? `${rotuloPonto(pontoAtivo.instante)}, ${formatarValor(pontoAtivo.valor, true)}`
            : rotuloPonto(serie[serie.length - 1].instante)}
          onChange={event => selecionar(Number(event.target.value))}
        />
        <output htmlFor="ponto-historico">
          {pontoAtivo
            ? `${rotuloPonto(pontoAtivo.instante)} · ${formatarValor(pontoAtivo.valor, true)}`
            : chuva ? '0 = Sem chuva · 1 = Chovendo' : 'Horário de São Paulo'}
        </output>
      </div>
      <details className="dados">
        <summary>Ver dados em tabela</summary>
        <table>
          <caption>{nome} por intervalo de {historico.intervalo_minutos} minutos</caption>
          <thead><tr><th scope="col">Início</th><th scope="col">Valor {unidade && `(${unidade})`}</th>{!demo && <th scope="col">Amostras</th>}</tr></thead>
          <tbody>
            {serie.filter(ponto => ponto.amostras !== undefined).map(({ instante, valor, amostras }) => (
              <tr key={instante}>
                <th scope="row">{rotuloPonto(instante)}</th>
                <td>{formatarValor(valor)}</td>
                {!demo && <td>{amostras}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  )
}
