import { useEffect, useRef, useState } from 'react'
import { dia, hora, type FaixaLuminosidade, type Periodo } from './weather'

type Props = { pontos: FaixaLuminosidade[]; periodo: Periodo; unidade: string }

const numero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const margem = { esquerda: 53, direita: 15, topo: 12, base: 26 }
const altura = 172
const corMediana = '#087f68'
const corFaixa = '#b9e0d5'

function rotuloHora(horario: FaixaLuminosidade['hora'], incluirDia = false) {
  if (typeof horario === 'number') return `${String(horario).padStart(2, '0')}:00`
  const instante = Date.parse(horario)
  return incluirDia ? `${dia(instante)} às ${hora(instante)}` : hora(instante)
}

export function LightProfile({ pontos, periodo, unidade }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [largura, setLargura] = useState(0)
  const [selecionado, selecionar] = useState<number | null>(null)
  const indice = Math.min(selecionado ?? pontos.length - 1, pontos.length - 1)
  const ativo = pontos[indice]
  const temPontos = pontos.length > 0
  const area = largura - margem.esquerda - margem.direita
  const formatar = (valor: number | null) => valor === null ? '—' : [numero.format(valor), unidade].filter(Boolean).join(' ')
  const detalhes = !ativo || ativo.amostras === 0 ? 'Sem leituras' :
    `Mín. ${formatar(ativo.minimo)} · Mediana ${formatar(ativo.mediana)} · Máx. ${formatar(ativo.maximo)}`

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const observador = new ResizeObserver(() => setLargura(canvas.clientWidth))
    observador.observe(canvas)
    return () => observador.disconnect()
  }, [temPontos])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || area <= 0 || !pontos.length) return
    const minimos = pontos.flatMap(ponto => ponto.minimo === null ? [] : [ponto.minimo])
    const maximos = pontos.flatMap(ponto => ponto.maximo === null ? [] : [ponto.maximo])
    if (!minimos.length || !maximos.length) return

    const escala = window.devicePixelRatio || 1
    canvas.width = largura * escala
    canvas.height = altura * escala
    ctx.scale(escala, escala)
    const minimo = Math.min(...minimos)
    const maximo = Math.max(...maximos)
    const teto = maximo === minimo ? maximo + Math.max(1, Math.abs(maximo) * .02) : maximo
    const fundo = altura - margem.base
    const x = (i: number) => margem.esquerda + (pontos.length === 1 ? area / 2 : area * i / (pontos.length - 1))
    const y = (valor: number) => fundo - (valor - minimo) * (fundo - margem.topo) / (teto - minimo)

    ctx.font = '11px system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#526566'
    ctx.strokeStyle = '#e7edea'
    ctx.textAlign = 'right'
    for (let i = 0; i < 4; i++) {
      const valor = minimo + (teto - minimo) * i / 3
      const py = y(valor)
      ctx.beginPath()
      ctx.moveTo(margem.esquerda, py)
      ctx.lineTo(largura - margem.direita, py)
      ctx.stroke()
      ctx.fillText(numero.format(valor), margem.esquerda - 7, py)
    }

    const ticks = largura < 400 ? 4 : 6
    const indices = new Set(Array.from({ length: ticks }, (_, i) => Math.round(i * (pontos.length - 1) / (ticks - 1))))
    for (const i of indices) {
      ctx.textAlign = i === 0 ? 'left' : i === pontos.length - 1 ? 'right' : 'center'
      ctx.fillText(rotuloHora(pontos[i].hora), x(i), fundo + 16)
    }

    type PontoTela = { x: number; min: number; centro: number; max: number }
    let trecho: PontoTela[] = []
    function desenharTrecho(contexto: CanvasRenderingContext2D) {
      if (!trecho.length) return
      const primeiro = trecho[0]
      contexto.fillStyle = corFaixa
      contexto.beginPath()
      contexto.moveTo(primeiro.x, primeiro.max)
      for (const ponto of trecho.slice(1)) contexto.lineTo(ponto.x, ponto.max)
      for (const ponto of [...trecho].reverse()) contexto.lineTo(ponto.x, ponto.min)
      contexto.closePath()
      contexto.fill()
      if (trecho.length === 1) contexto.fillRect(primeiro.x - 2, primeiro.max, 4, primeiro.min - primeiro.max)

      contexto.beginPath()
      contexto.strokeStyle = corMediana
      contexto.fillStyle = corMediana
      contexto.lineWidth = 2
      contexto.moveTo(primeiro.x, primeiro.centro)
      for (const ponto of trecho.slice(1)) contexto.lineTo(ponto.x, ponto.centro)
      contexto.stroke()
      if (trecho.length === 1) {
        contexto.beginPath()
        contexto.arc(primeiro.x, primeiro.centro, 3, 0, 2 * Math.PI)
        contexto.fill()
      }
      trecho = []
    }
    pontos.forEach((ponto, i) => {
      if (ponto.minimo === null || ponto.mediana === null || ponto.maximo === null) desenharTrecho(ctx)
      else trecho.push({ x: x(i), min: y(ponto.minimo), centro: y(ponto.mediana), max: y(ponto.maximo) })
    })
    desenharTrecho(ctx)

    if (selecionado !== null && ativo) {
      ctx.beginPath()
      ctx.setLineDash([3, 3])
      ctx.lineWidth = 1
      ctx.strokeStyle = '#53676b'
      ctx.moveTo(x(indice), margem.topo)
      ctx.lineTo(x(indice), fundo)
      ctx.stroke()
      ctx.setLineDash([])
      if (ativo.mediana !== null) {
        ctx.beginPath()
        ctx.fillStyle = corMediana
        ctx.arc(x(indice), y(ativo.mediana), 4, 0, 2 * Math.PI)
        ctx.fill()
      }
    }
  }, [area, largura, pontos, indice, selecionado, ativo])

  if (!ativo) return <p className="chart-empty">Nenhuma leitura de luminosidade neste período.</p>

  return (
    <>
      <figure className="distribuicao">
        <figcaption>
          <h3>Perfil horário de luminosidade</h3>
          <p>{periodo === '7d' ? 'Leituras dos 7 dias agrupadas pela mesma hora do dia' : 'Leituras agrupadas por hora das últimas 24 horas'}</p>
        </figcaption>
        <div className="perfil-legenda">
          <span className="perfil-legenda-mediana">Mediana</span>
          <span className="perfil-legenda-faixa">Mínimo a máximo</span>
        </div>
        <canvas
          ref={canvasRef}
          className="perfil-grafico"
          aria-hidden="true"
          onPointerMove={evento => {
            if (area <= 0) return
            const x = evento.clientX - evento.currentTarget.getBoundingClientRect().left - margem.esquerda
            selecionar(Math.max(0, Math.min(pontos.length - 1, Math.round(x / area * (pontos.length - 1)))))
          }}
        />
        <div className="chart-control">
          <label htmlFor="hora-luminosidade">Explorar hora</label>
          <input id="hora-luminosidade" type="range" min={0} max={pontos.length - 1} value={indice}
            aria-valuetext={`${rotuloHora(ativo.hora, true)}, ${detalhes}`}
            onChange={evento => selecionar(Number(evento.target.value))}
          />
        </div>
        <p className="distribuicao-selecao">
          <strong>{rotuloHora(ativo.hora, true)}</strong><span>{detalhes}</span>
        </p>
      </figure>
      <details className="dados">
        <summary>Ver perfil em tabela</summary>
        <div className="perfil-tabela">
          <table>
            <caption>Perfil horário · horário de São Paulo</caption>
            <thead><tr><th scope="col">Hora</th><th scope="col">Mín.</th><th scope="col">Mediana</th><th scope="col">Máx.</th><th scope="col">Leituras</th></tr></thead>
            <tbody>{pontos.map(ponto => (
              <tr key={ponto.hora}>
                <th scope="row">{rotuloHora(ponto.hora, true)}</th>
                <td>{formatar(ponto.minimo)}</td><td>{formatar(ponto.mediana)}</td><td>{formatar(ponto.maximo)}</td>
                <td>{ponto.amostras}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </>
  )
}
