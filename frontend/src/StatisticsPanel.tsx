import { useState } from 'react'
import { LightProfile } from './LightProfile'
import { type Estatisticas, type FaixaHistograma, type Periodo } from './weather'

type Props = {
  dados: Estatisticas | null | undefined
  erro: boolean
  nome: string
  unidade: string
  periodo: Periodo
  chuva: boolean
}

const medicao = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })
const limite = new Intl.NumberFormat('pt-BR', { maximumSignificantDigits: 9 })
const contagem = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })

export function StatisticsPanel({ dados, erro, nome, unidade, periodo, chuva }: Props) {
  const [indice, setIndice] = useState(0)
  const faixaAtiva = dados?.histograma[indice] ?? dados?.histograma[0]
  const alturaMaxima = Math.max(1, ...(dados?.histograma.map(faixa => faixa.quantidade) ?? []))
  const tituloDistribuicao = chuva ? 'Frequência por estado' : 'Histograma'
  const recorte = dados?.recorte_percentual_por_cauda
  const aplicouRecorte = dados && dados.amostras < dados.amostras_validas

  const resumos = dados && [
    { rotulo: 'Média', valor: dados.media },
    { rotulo: 'Mediana', valor: dados.mediana },
    { rotulo: 'Desvio padrão amostral', valor: dados.desvio_padrao_amostral },
  ]

  function rotulo(faixa: FaixaHistograma) {
    if (chuva) return faixa.inicio === 0 ? 'Sem chuva (0)' : 'Chovendo (1)'
    const inicio = limite.format(faixa.inicio)
    const fim = limite.format(faixa.fim)
    return [faixa.inicio === faixa.fim ? inicio : `${inicio} a ${fim}`, unidade].filter(Boolean).join(' ')
  }

  return (
    <section id="estatisticas" className="painel painel-estatisticas" aria-labelledby="titulo-estatisticas">
      <header className="painel-topo">
        <div>
          <h2 id="titulo-estatisticas">Estatísticas do período</h2>
          <p>{nome} · {periodo === '24h' ? 'Últimas 24 horas' : 'Últimos 7 dias'}</p>
        </div>
        {dados && dados.amostras > 0 &&
          <p className="estatisticas-amostras">
            {aplicouRecorte
              ? `${contagem.format(dados.amostras)} de ${contagem.format(dados.amostras_validas)} leituras válidas`
              : `${contagem.format(dados.amostras)} ${dados.amostras === 1 ? 'leitura válida' : 'leituras válidas'}`}
          </p>}
      </header>

      {erro && (
        <p className="historico-erro" role="status">
          {dados ? 'Atualização indisponível. Mantendo as estatísticas já carregadas.' : 'Estatísticas temporariamente indisponíveis.'}
        </p>
      )}

      {dados && dados.amostras > 0 ? (
        <>
          {recorte != null && (
            <p className="estatisticas-recorte">
              {aplicouRecorte
                ? `Recorte central de ${medicao.format(100 - 2 * recorte)}% · ${contagem.format((dados.amostras_validas - dados.amostras) / 2)} por extremo`
                : `O recorte de ${medicao.format(recorte)}% por extremo começa com ${Math.ceil(100 / recorte)} leituras válidas.`}
            </p>
          )}
          {!chuva && resumos && (
            <dl className="estatisticas-resumo">
              {resumos.map(({ rotulo, valor }) => (
                <div key={rotulo}>
                  <dt>{rotulo}</dt>
                  <dd>{valor === null ? <span className="estatisticas-insuficiente">Amostra insuficiente</span>
                    : <>{medicao.format(valor)}{unidade && <> <small>{unidade}</small></>}</>}</dd>
                </div>
              ))}
            </dl>
          )}

          {dados.perfil_luminosidade ? (
            <LightProfile pontos={dados.perfil_luminosidade} periodo={periodo} unidade={unidade} />
          ) : (
            <>
              <figure className="distribuicao">
                <figcaption>
                  <h3>{tituloDistribuicao}</h3>
                  <p>{chuva ? 'Leituras registradas em cada estado do sensor' : 'Quantidade de leituras por faixa de valores'}</p>
                </figcaption>
                <div className="distribuicao-grafico">
                  <div className="distribuicao-escala" aria-hidden="true">
                    <span>{contagem.format(alturaMaxima)}</span><span>0</span>
                  </div>
                  <div className={`distribuicao-barras ${chuva ? 'distribuicao-chuva' : ''}`} role="group" aria-label={tituloDistribuicao}>
                    {dados.histograma.map((faixa, i) => (
                      <button
                        key={i}
                        type="button"
                        className="distribuicao-barra"
                        aria-pressed={i === indice}
                        aria-label={`${rotulo(faixa)} · ${contagem.format(faixa.quantidade)} leituras`}
                        onPointerEnter={() => setIndice(i)}
                        onFocus={() => setIndice(i)}
                        onClick={() => setIndice(i)}
                      >
                        <span aria-hidden="true" style={{ height: `${faixa.quantidade / alturaMaxima * 100}%` }} />
                      </button>
                    ))}
                  </div>
                  <div className="distribuicao-limites" aria-hidden="true">
                    {chuva ? <><span>Sem chuva</span><span>Chovendo</span></>
                      : <><span>{limite.format(dados.histograma[0].inicio)} {unidade}</span>
                        <span>{limite.format(dados.histograma[dados.histograma.length - 1].fim)} {unidade}</span></>}
                  </div>
                </div>
                {faixaAtiva && <p className="distribuicao-selecao">
                  <strong>{rotulo(faixaAtiva)}</strong>
                  <span>{contagem.format(faixaAtiva.quantidade)} {faixaAtiva.quantidade === 1 ? 'leitura' : 'leituras'}</span>
                </p>}
              </figure>
              <details className="dados">
                <summary>{chuva ? 'Ver contagens em tabela' : 'Ver faixas em tabela'}</summary>
                <table>
                  <caption>{tituloDistribuicao} · {nome}</caption>
                  <thead><tr><th scope="col">{chuva ? 'Estado' : 'Faixa de valores'}</th><th scope="col">Leituras</th></tr></thead>
                  <tbody>{dados.histograma.map((faixa, i) => (
                    <tr key={i}><th scope="row">{rotulo(faixa)}</th><td>{contagem.format(faixa.quantidade)}</td></tr>
                  ))}</tbody>
                </table>
              </details>
            </>
          )}
        </>
      ) : !erro && (
        <p className="chart-empty" role="status">{dados ? 'Nenhuma leitura válida neste período.' : 'Carregando estatísticas…'}</p>
      )}
    </section>
  )
}
