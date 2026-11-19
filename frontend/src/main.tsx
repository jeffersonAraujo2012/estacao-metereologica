import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HistoryChart } from './HistoryChart'
import {
  consultar, demonstracao, dia, hora, metricas, metricasDoGrafico, numero,
  type CampoHistorico, type Historico, type Leitura, type Periodo,
} from './weather'
import './styles.css'

const intervaloLeitura = 5_000
const intervaloHistorico = 300_000
const mapa = 'https://www.openstreetmap.org/export/embed.html?bbox=-46.6508%2C-23.5588%2C-46.6158%2C-23.5422&layer=mapnik&marker=-23.5505%2C-46.6333'
const mapaExterno = 'https://www.openstreetmap.org/?mlat=-23.5505&mlon=-46.6333#map=15/-23.5505/-46.6333'

function ValorMedicao({ valor, unidade }: { valor?: number | null; unidade: string }) {
  if (valor == null) return <span className="sem-valor">Sem leitura</span>
  return <>{numero(valor)}{unidade && <> <span>{unidade}</span></>}</>
}

function useConsulta<T>(rota: string, intervalo: number, ativa: boolean, revisao: number) {
  const [estado, setEstado] = useState<{ rota: string; dados: T | null; erro: boolean } | null>(null)

  useEffect(() => {
    if (!ativa) return
    const controller = new AbortController()
    let temporizador: number | undefined

    async function carregar() {
      try {
        const dados = await consultar<T>(rota, controller.signal)
        if (!controller.signal.aborted) setEstado({ rota, dados, erro: false })
      } catch {
        if (!controller.signal.aborted) {
          setEstado(anterior => ({
            rota, dados: anterior?.rota === rota ? anterior.dados : null, erro: true,
          }))
        }
      } finally {
        if (!controller.signal.aborted) {
          temporizador = window.setTimeout(carregarQuandoVisivel, intervalo)
        }
      }
    }

    function carregarQuandoVisivel() {
      temporizador = undefined
      if (document.hidden) temporizador = window.setTimeout(carregarQuandoVisivel, intervalo)
      else void carregar()
    }

    function aoVoltar() {
      if (!document.hidden && temporizador !== undefined) {
        window.clearTimeout(temporizador)
        carregarQuandoVisivel()
      }
    }

    void carregar()
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      controller.abort()
      window.clearTimeout(temporizador)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [rota, intervalo, ativa, revisao])

  return estado?.rota === rota ? estado : null
}

function App() {
  const [periodo, setPeriodo] = useState<Periodo>('24h')
  const [campo, setCampo] = useState<CampoHistorico>('temperatura_dht22_c')
  const [demo, setDemo] = useState(new URLSearchParams(window.location.search).get('demo') === '1')
  const [revisao, setRevisao] = useState(0)
  const amostra = useMemo(() => demo ? demonstracao(periodo) : null, [demo, periodo])
  const resultadoAtual = useConsulta<Leitura>('ultima', intervaloLeitura, !demo, revisao)
  const resultadoHistorico = useConsulta<Historico>(`historico?periodo=${periodo}`, intervaloHistorico, !demo, revisao)
  const leitura = amostra?.leitura ?? resultadoAtual?.dados
  const historico = amostra?.historico ?? resultadoHistorico?.dados
  const instante = leitura?.coletado_em ? Date.parse(leitura.coletado_em) : NaN
  const atualizado = Number.isFinite(instante)
  const leituraAntiga = atualizado && Date.now() - instante > 60_000
  const ausentes: string[] = leitura ? metricas.filter(({ campo }) => leitura[campo] == null).map(({ nome }) => nome) : []
  if (leitura && leitura.chuva_detectada == null) ausentes.push('Detecção de chuva')
  const metrica = metricasDoGrafico.find(item => item.campo === campo) ?? metricasDoGrafico[0]
  const status = demo ? 'Demonstração' : resultadoAtual?.erro ? 'Sem conexão'
    : leituraAntiga ? 'Leitura desatualizada' : leitura ? 'Estação ativa'
    : resultadoAtual ? 'Aguardando medições' : 'Conectando'

  return (
    <>
      <a className="skip" href="#conteudo">Pular para o conteúdo</a>
      <header className="topo">
        <div className="container cabecalho">
          <a className="marca" href="#conteudo"><span className="marca-icone" aria-hidden="true"><i /></span>Estação <strong>SP</strong></a>
          <nav aria-label="Navegação principal">
            <a href="#leituras">Leituras</a>
            <a href="#historico">Histórico</a>
            <a href="#localizacao">Localização</a>
          </nav>
          <span className="topo-local"><span className="pin" aria-hidden="true" /> São Paulo, SP</span>
        </div>
      </header>

      <main id="conteudo" className="container">
        <section className="hero" aria-labelledby="titulo">
          <div className="hero-art" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <div className="hero-content">
            <p className="hero-local"><span className="pin" aria-hidden="true" /> Centro de São Paulo</p>
            <h1 id="titulo">Painel meteorológico</h1>
            <p>Condições observadas pela estação e histórico das medições.</p>
          </div>
          <div className="hero-status">
            <span className={`status ${demo || !leitura || resultadoAtual?.erro || leituraAntiga ? 'status-neutro' : ''}`} role="status">
              <span className="status-dot" aria-hidden="true" />{status}
            </span>
            <span className="ultima">
              {demo ? 'Dados fictícios' : atualizado ? <>Última leitura <time dateTime={leitura?.coletado_em ?? undefined}>{dia(instante)} às {hora(instante)}</time></> : 'Horário da leitura indisponível'}
            </span>
          </div>
        </section>

        <section id="leituras" aria-labelledby="titulo-leituras" className="secao">
          <header className="secao-topo">
            <div>
              <h2 id="titulo-leituras">Leituras atuais</h2>
              <p>{demo ? 'Amostras fictícias para explorar o painel' : 'Atualização automática a cada 5 segundos'}</p>
            </div>
            {demo
              ? <button className="botao" onClick={() => {
                  window.history.replaceState(null, '', window.location.pathname + window.location.hash)
                  setDemo(false)
                }}>Voltar aos dados reais</button>
              : <button className="botao" onClick={() => setRevisao(valor => valor + 1)}><span aria-hidden="true">↻</span> Atualizar agora</button>}
          </header>

          {!demo && resultadoAtual && !leitura && (
            <div className="aviso aviso-info">
              <div><strong>{resultadoAtual.erro ? 'API indisponível' : 'Nenhuma medição registrada'}</strong>
                <p>{resultadoAtual.erro ? 'Não foi possível consultar a estação. O painel tentará novamente.' : 'As leituras aparecerão assim que a estação registrar dados.'}</p></div>
              <button className="botao" onClick={() => setDemo(true)}>Ver demonstração</button>
            </div>
          )}
          {!demo && leitura && resultadoAtual?.erro && (
            <p className="aviso aviso-info" role="status">Conexão interrompida. O painel exibe a última leitura recebida.</p>
          )}
          {!demo && ausentes.length > 0 && (
            <div className="aviso aviso-atencao" role="status">
              <span className="aviso-icone" aria-hidden="true">!</span>
              <div><strong>Medição ausente</strong><p>A última leitura veio sem dados em {ausentes.join(', ')}.</p></div>
            </div>
          )}

          <div className="indicadores">
            {metricas.slice(0, 4).map(metrica => (
              <article className={`indicador indicador-${metrica.campo}`} key={metrica.campo}>
                <span className="indicador-icone" aria-hidden="true">{metrica.simbolo}</span>
                <h3>{metrica.nome}</h3>
                <p className="valor"><ValorMedicao valor={leitura?.[metrica.campo]} unidade={metrica.unidade} /></p>
                <p className="sensor">Sensor {metrica.sensor}</p>
              </article>
            ))}
            <article className="indicador indicador-chuva">
              <span className="indicador-icone" aria-hidden="true">☂</span>
              <h3>Detecção de chuva</h3>
              <p className="valor valor-chuva">{leitura?.chuva_detectada == null ? <span className="sem-valor">Sem leitura</span>
                : leitura.chuva_detectada ? 'Chovendo' : 'Sem chuva'}</p>
              <p className="sensor">Sensor de chuva</p>
            </article>
          </div>
          <details className="sensores">
            <summary>Outras medições</summary>
            <dl>{metricas.slice(4).map(metrica => (
              <div key={metrica.campo}>
                <dt>{metrica.nome} · {metrica.sensor}</dt>
                <dd><ValorMedicao valor={leitura?.[metrica.campo]} unidade={metrica.unidade} /></dd>
              </div>
            ))}</dl>
          </details>
        </section>

        <div className="paineis">
          <section id="historico" className="painel" aria-labelledby="titulo-historico">
            <header className="painel-topo">
              <div><h2 id="titulo-historico">Histórico de medições</h2>
              <p>{campo === 'chuva_detectada' ? 'Último estado válido' : 'Média das medições'} a cada {periodo === '24h' ? '15 minutos' : 'hora'}</p></div>
              <div className="periodos" role="group" aria-label="Período do histórico">
                <button type="button" aria-pressed={periodo === '24h'} onClick={() => setPeriodo('24h')}>24 horas</button>
                <button type="button" aria-pressed={periodo === '7d'} onClick={() => setPeriodo('7d')}>7 dias</button>
              </div>
            </header>
            <div className="metrica">
              <label htmlFor="metrica">Medição</label>
              <div className="select"><select id="metrica" value={campo} onChange={evento => setCampo(evento.target.value as CampoHistorico)}>
                {metricasDoGrafico.map(item => <option key={item.campo} value={item.campo}>{item.nome}{item.unidade && ` (${item.unidade})`}</option>)}
              </select></div>
            </div>
            {!demo && resultadoHistorico?.erro && <p className="historico-erro" role="status">
              {historico ? 'Atualização indisponível. Mantendo o histórico já carregado.' : 'O histórico está temporariamente indisponível.'}
            </p>}
            {historico?.pontos.length ? (
              <HistoryChart key={`${periodo}-${campo}`} historico={historico} campo={campo} unidade={metrica.unidade} nome={metrica.nome} periodo={periodo} demo={demo} />
            ) : !resultadoHistorico?.erro && (
              <p className="chart-empty" role="status">{historico ? 'Nenhuma medição neste período.' : 'Carregando histórico…'}</p>
            )}
          </section>

          <section id="localizacao" className="painel painel-mapa" aria-labelledby="titulo-mapa">
            <header className="painel-topo">
              <div><h2 id="titulo-mapa">Localização da estação</h2><p>Posição aproximada</p></div>
              <span className="mapa-icone" aria-hidden="true"><span className="pin" /></span>
            </header>
            <iframe src={mapa} title="Mapa do centro de São Paulo com a posição aproximada da estação" loading="lazy" />
            <div className="mapa-rodape">
              <div><strong>Centro · São Paulo, SP</strong><p>23,5505° S · 46,6333° O</p></div>
              <a href={mapaExterno} target="_blank" rel="noreferrer">Abrir mapa</a>
            </div>
          </section>
        </div>
      </main>

      <footer><div className="container rodape"><span>Estação SP · Projeto integrador UNIP</span><span>Todos os horários em São Paulo</span></div></footer>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
