# Estação meteorológica — PD-II UNIP

Projeto integrador com a API FastAPI, o dashboard meteorológico e os arquivos Docker para desenvolvimento local e implantação na EC2. O firmware, o consumidor Python, o RabbitMQ e o MongoDB em produção executam em sua infraestrutura existente.

## Arquitetura

`ESP32 → RabbitMQ (MQTT/TLS) → consumidor Python (validação) → MongoDB → FastAPI → dashboard`

- FastAPI: API de consulta (leitura) ao MongoDB. O consumidor permanece como único responsável pela ingestão MQTT.
- PyMongo Async: driver assíncrono oficial.
- React, TypeScript e Vite: [dashboard meteorológico](#dashboard-local).
- Docker Compose: MongoDB local para desenvolvimento e configuração para implantar a API e o dashboard na EC2.
- GitHub Actions: testes automatizados, publicação de imagens no GHCR e deploy opcional na EC2. [Configurar o CI/CD](#4-cicd-e-implantação-na-ec2)

## 1. Executar localmente no Ubuntu / VS Code

**Pré-requisitos:** Python 3.12+, Docker Engine com Compose, VS Code.

```bash
# Na raiz do projeto:
docker compose -f infra/compose.local.yaml up -d
cd backend
cp .env.example .env
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
python -m pytest -q
python scripts/seed_demo.py  # opcional: insere 3 leituras fictícias no Mongo local
uvicorn app.main:app --reload
```

Abrir `http://127.0.0.1:8000/docs` (Swagger). Rotas:

| Método | Caminho | Uso |
| --- | --- | --- |
| GET | `/health` | Processo HTTP ativo (não valida Mongo) |
| GET | `/ready` | Verifica a conexão com MongoDB |
| GET | `/api/v1/leituras/ultima` | Medição mais recente |
| GET | `/api/v1/leituras?limite=20` | Histórico, até 100 leituras |
| GET | `/api/v1/leituras/ultima?estacao_id=estacao-001` | Filtra por estação |
| GET | `/api/v1/leituras/historico?periodo=24h` | Histórico agregado. Também aceita `periodo=7d` e o filtro opcional `estacao_id`. |

**Atenção:** `MONGODB_DATABASE` e `MONGODB_COLLECTION` são valores de EXEMPLO; ajuste para os nomes reais usados pelo consumidor Python. A ordenação supõe que `coletado_em` seja persistido de forma coerente, em ISO-8601 UTC ou `datetime` BSON, sem formatos misturados.

### Teste da API

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/ready
curl 'http://127.0.0.1:8000/api/v1/leituras/ultima'
curl 'http://127.0.0.1:8000/api/v1/leituras?limite=10'
```

### Dashboard local

Na raiz do repositório, com o Docker Compose em execução:

```bash
docker compose -f infra/compose.local.yaml --profile dashboard up -d --build
```

Se você já subiu o MongoDB local com `-p estacao-local`, use o mesmo `-p estacao-local` nesse comando para reaproveitar o contêiner e o volume.

Abra `http://127.0.0.1:8080`. Para ver o layout com dados fictícios, abra `http://127.0.0.1:8080/?demo=1`. Para testar o fluxo completo com o MongoDB local, insira três leituras fictícias pelo seed:

```bash
docker run --rm -i --network container:estacao-mongo-local \
  --entrypoint python estacao-api:local - < backend/scripts/seed_demo.py
```

O painel consulta a leitura mais recente a cada 5 segundos e mostra um aviso quando algum campo de sensor está ausente. O histórico agrupa as últimas 24 horas em intervalos de 15 minutos e os últimos 7 dias em intervalos de uma hora. O navegador recebe no máximo 97 ou 169 pontos, respectivamente, contando intervalos parciais. Temperatura, umidade, pressão e luminosidade usam a média das medições válidas. Na série de chuva, `chuva_detectada` indica o último estado válido do intervalo. O valor é `0` (sem chuva), `1` (chovendo) ou `null` (sem leitura válida).

No perfil `dashboard`, o Nginx serve a interface e encaminha `/api/` ao FastAPI pela rede do Docker. Por exemplo, o histórico agregado também pode ser consultado em `http://127.0.0.1:8080/api/v1/leituras/historico?periodo=24h`.

O mapa interativo usa o OpenStreetMap e indica uma posição aproximada no centro de São Paulo. Para coleções grandes, crie um índice em `coletado_em` com um usuário administrativo. Se a consulta usar o filtro de estação com frequência, o índice composto `{estacao_id: 1, coletado_em: 1}` também pode atender esse filtro. Datas em texto devem seguir ISO 8601 em UTC com prefixo `AAAA-MM-DDTHH:mm:ss`.

## 2. Conectar ao MongoDB real da EC2

A API local pode usar um túnel SSH com o banco remoto, **se** o MongoDB estiver acessível via porta de loopback no host EC2. Não publique a porta 27017 na Internet. Se o MongoDB estiver acessível apenas por rede Docker, será necessário ajustar o túnel ou usar ambiente local até o deploy.

Em produção, a API será conectada à **mesma rede Docker do MongoDB**, consultando-o por hostname interno. Não altere RabbitMQ, banco ou consumidor.

## 3. Git / GitHub

```bash
git init
git add .
git commit -m "feat: adiciona API meteorologica com testes"
git branch -M main
# Crie um repositório vazio no GitHub e use a URL exibida lá:
git remote add origin <URL_REAL_DO_REPOSITORIO>
git push -u origin main
```

Os arquivos `.env` estão no `.gitignore` e não devem entrar no Git. Não inclua credenciais MQTT, Mongo, AWS ou chaves privadas em commits.

## 4. CI/CD e implantação na EC2

O [guia detalhado de CI/CD](GUIA_CI_CD.md) mostra onde obter cada credencial, como preparar a EC2 e como validar ou reverter um deploy.

O workflow **API e Dashboard** tem três etapas. [Arquivo do GitHub Actions](.github/workflows/api.yml)

| Etapa | Quando roda | Resultado |
| --- | --- | --- |
| Validação | Pull requests, pushes para `main` e execuções manuais | Executa o `pytest` no backend e verifica os tipos e o build do frontend. |
| Publicação | Pushes e execuções manuais em `main`, após as duas validações | Publica as imagens Linux AMD64 da API e do dashboard em dois pacotes no GHCR, cada uma com uma tag do commit e uma tag móvel. |
| Deploy | Após a publicação, se `ENABLE_EC2_DEPLOY=true` | Atualiza `api` e `frontend` na EC2, verifica `/ready`, abre o dashboard e testa uma consulta pelo proxy do frontend. |

Para ativar o deploy automático:

1. Na EC2, prepare `/opt/estacao-api` com permissão de escrita para o usuário SSH e crie `/opt/estacao-api/.env` como no exemplo abaixo. Use a rede Docker existente do MongoDB e uma URI com as credenciais da aplicação. O usuário SSH precisa executar Docker via `sudo -n` e o servidor precisa ter Docker Compose e `curl`.
2. No GitHub, em **Settings → Secrets and variables → Actions**, cadastre `EC2_HOST`, `EC2_USER`, `EC2_SSH_PRIVATE_KEY` e `EC2_SSH_KNOWN_HOSTS`. Se a chave privada estiver cifrada, cadastre também `EC2_SSH_KEY_PASSPHRASE`. Use a entrada `known_hosts` da EC2 conferida por um canal confiável.
3. Se houver pacotes GHCR privados, autentique o Docker da EC2 via `sudo docker login ghcr.io` com uma conta e um token com acesso de leitura aos pacotes. Confirme que o runner do GitHub pode conectar via SSH à EC2.
4. Defina `ENABLE_EC2_DEPLOY=true` e execute o workflow em `main` para baixar e implantar o par de imagens do mesmo commit.

Após o deploy, acesse o dashboard em `http://IP_PUBLICO_DA_EC2`. No Security Group da instância, adicione uma regra de entrada **TCP 80** com a origem desejada. A API escuta em `127.0.0.1:8000` e o dashboard encaminha `/api/` pela rede Docker. O guia também descreve como usar um túnel SSH e como implantar manualmente. [Guia de CI/CD](GUIA_CI_CD.md)

## 5. Próximas melhorias

- Conferir o schema exato do MongoDB real, nomes da coleção e índices (`estacao_id`, `coletado_em`).
- Configurar domínio e HTTPS para o dashboard.
- Evoluir segurança da esteira com políticas e permissões mínimas.

_Dados do seed são simulados e não representam leituras reais._
