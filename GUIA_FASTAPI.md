# Como funciona a API da estação meteorológica

Este guia cobre os seis arquivos de [`backend/app`](backend/app). A API recebe pedidos de consulta via HTTP, busca medições no MongoDB e devolve os resultados em JSON. No fluxo descrito pelo [README](README.md), o ESP32 envia as medições ao RabbitMQ e um consumidor Python as grava no MongoDB. A API entra em cena quando alguém quer consultar o que foi gravado.

## De onde vieram esses arquivos?

O FastAPI fornece componentes como `FastAPI`, `APIRouter`, `Depends` e `Query`. Os nomes dos módulos, a divisão das responsabilidades e as rotas de meteorologia são escolhas deste projeto. Em um aplicativo pequeno, é possível começar com um único `main.py` e separar a configuração, o banco, os modelos e as rotas conforme o código cresce.

O histórico do Git estava indisponível nesta cópia. A ordem de leitura abaixo segue o funcionamento atual da API. A data, a autoria e a ordem de criação dos arquivos ficam sem confirmação.

## 1. [`__init__.py`](backend/app/__init__.py)

É um arquivo vazio que marca `app` como um pacote Python regular. Isso dá contexto a imports como `from app.config import get_settings`. A convenção vem do Python. Ao importar o pacote, o arquivo vazio não executa nenhuma inicialização própria.

## 2. [`main.py`](backend/app/main.py)

É o ponto de entrada. O comando `uvicorn app.main:app --reload` manda o Uvicorn, o servidor que recebe os pedidos HTTP, importar o módulo `app.main` e usar o objeto `app` definido após os dois-pontos. A opção `--reload` reinicia o processo quando o código muda durante o desenvolvimento.

- `FastAPI(...)` cria o aplicativo com título, descrição e versão. O FastAPI usa esses metadados, as rotas e os modelos para gerar a documentação interativa em `/docs`.
- `lifespan` define o ciclo de vida. Antes de `yield`, cria o cliente assíncrono do MongoDB e o guarda em `app.state.mongo_client`, onde as rotas podem reutilizá-lo. No encerramento normal, o código depois de `yield` fecha o cliente. A criação do cliente, por si só, não confirma que o banco está acessível.
- `CORSMiddleware` configura quais origens de navegador podem consultar a API por `GET`. Uma origem inclui protocolo, host e porta, como `http://localhost:5173`.
- `app.include_router(router)` registra as rotas de medições definidas em `routes.py`.

| Rota | O que faz |
| --- | --- |
| `GET /` | Devolve uma mensagem e o caminho da documentação. |
| `GET /health` | Confirma que o processo HTTP está respondendo. |
| `GET /ready` | Envia um `ping` ao MongoDB e devolve HTTP 503 se o driver reportar um erro. |

O decorador `@app.get("/health")`, por exemplo, associa o método HTTP `GET` e o caminho `/health` à função logo abaixo.

## 3. [`config.py`](backend/app/config.py)

Centraliza os valores que podem variar entre a máquina de desenvolvimento e o servidor. A classe `Settings` deriva de `BaseSettings`, do pacote `pydantic-settings`. A configuração considera as variáveis de ambiente, depois o arquivo `.env` no diretório de execução e, por fim, os valores padrão do código.

| Variável | Para que serve | Padrão |
| --- | --- | --- |
| `MONGODB_URI` | Endereço de conexão com o MongoDB. | `mongodb://127.0.0.1:27017` |
| `MONGODB_DATABASE` | Nome do banco de dados. | `estacao_meteorologica` |
| `MONGODB_COLLECTION` | Nome da coleção de medições dentro do banco. | `leituras` |
| `CORS_ORIGINS` | Origens de navegador permitidas, separadas por vírgula. | `http://localhost:5173` |

`extra="ignore"` permite que o `.env` tenha chaves adicionais. O decorador `@lru_cache` faz `get_settings()` reutilizar a mesma instância após a primeira chamada no processo. O [`.env.example`](backend/.env.example) mostra as chaves que podem ser configuradas. Execute a API a partir de `backend` para que ela procure o arquivo `backend/.env`.

## 4. [`db.py`](backend/app/db.py)

Faz a ponte entre as rotas e o MongoDB. O FastAPI entrega o objeto `Request` a `get_collection(request)`. A função acessa o cliente guardado em `request.app.state` e seleciona o banco e a coleção com `client[nome_do_banco][nome_da_colecao]`. A consulta aos documentos acontece quando a rota usa essa coleção.

Em `routes.py`, `colecao=Depends(get_collection)` diz ao FastAPI para executar `get_collection` e entregar seu retorno à função da rota. Esse mecanismo se chama **injeção de dependência**. Nos [testes](backend/tests/test_api.py), a mesma dependência é substituída por uma coleção em memória, o que permite testar as rotas de consulta sem um MongoDB em execução.

## 5. [`models.py`](backend/app/models.py)

Define o formato de saída. `Leitura` é um modelo Pydantic com um `id` obrigatório e campos opcionais para estação, horário, versão do schema e medições dos sensores. Os opcionais aceitam `None`, que aparece como `null` no JSON, e preservam a compatibilidade com documentos antigos que ainda não trazem todos os campos. `extra="ignore"` descarta campos do documento que não fazem parte desse formato.

`normalizar_leitura(documento)` copia o documento, converte o `_id` do MongoDB em texto, grava o resultado no campo `id` e remove `_id` da cópia. Essa adaptação é necessária porque o `ObjectId` do MongoDB não tem uma representação JSON direta. A função chama `Leitura.model_validate(...)` para validar os dados antes de devolvê-los à rota.

## 6. [`routes.py`](backend/app/routes.py)

Reúne as rotas de consulta em um `APIRouter` com prefixo `/api/v1`. O prefixo é somado ao caminho de cada decorador, e a tag `Leituras` agrupa essas rotas no Swagger, a interface interativa em `/docs`.

| Rota | Consulta e retorno |
| --- | --- |
| `GET /api/v1/leituras/ultima` | Busca um documento ordenado pelo horário de coleta mais recente e devolve um objeto `Leitura`. Retorna HTTP 404 quando não há leitura correspondente. |
| `GET /api/v1/leituras` | Busca o histórico do mais recente ao mais antigo e devolve uma lista. O limite padrão é 20, com valores permitidos de 1 a 100. Uma busca sem resultados devolve `[]`. |

As duas rotas aceitam `estacao_id` opcional de até 100 caracteres. Sem um identificador preenchido, a consulta considera todas as estações. `Query(...)` declara as regras dos parâmetros que aparecem após `?` na URL. Se alguém pedir `limite=101`, o FastAPI devolve HTTP 422 antes de executar a função da rota. Se a operação no banco lançar um `PyMongoError`, a rota devolve HTTP 503.

`response_model` informa ao FastAPI o formato esperado, usado na serialização e na documentação. Já `async def`, `await` e `async for` permitem que a aplicação avance com outros pedidos enquanto espera respostas do banco.

## Acompanhe um pedido de ponta a ponta

Experimente `GET /api/v1/leituras?limite=2&estacao_id=estacao-001` com a API e o MongoDB locais em execução.

1. O Uvicorn recebe o pedido e entrega ao aplicativo criado em `main.py`.
2. O FastAPI encontra `listar_leituras` em `routes.py` e interpreta os parâmetros `limite` e `estacao_id`.
3. `Depends(get_collection)` resolve a coleção em `db.py` com o cliente do aplicativo e os nomes configurados em `config.py`.
4. A rota filtra a estação, ordena por `coletado_em` em ordem decrescente e percorre até dois resultados.
5. `models.py` transforma cada documento em uma `Leitura`. O FastAPI envia a lista em JSON.

A ordenação usa o valor de `coletado_em` como está gravado no banco. Para que a ordem reflita a cronologia, mantenha um tipo e um formato consistentes, como datas BSON ou textos ISO 8601 em UTC com formato uniforme.

Para experimentar pelo navegador, siga a seção de execução local do [README](README.md), abra `http://127.0.0.1:8000/docs` e use **Try it out** na rota de histórico. O [script de dados de demonstração](backend/scripts/seed_demo.py) fornece leituras fictícias para a consulta local.
