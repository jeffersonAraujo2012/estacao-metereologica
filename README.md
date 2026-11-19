# Estação meteorológica — PD-II UNIP

Projeto integrador com a API FastAPI, o dashboard meteorológico e os arquivos Docker para desenvolvimento local e implantação da API na EC2. O firmware, o consumidor Python, o RabbitMQ e o MongoDB em produção executam em sua infraestrutura existente.

## Arquitetura

`ESP32 → RabbitMQ (MQTT/TLS) → consumidor Python (validação) → MongoDB → FastAPI → dashboard`

- FastAPI: API de consulta (leitura) ao MongoDB. O consumidor permanece como único responsável pela ingestão MQTT.
- PyMongo Async: driver assíncrono oficial.
- React, TypeScript e Vite: [dashboard meteorológico](#dashboard-local).
- GitHub Actions: testes, build da imagem e publicação GHCR; deploy EC2 ativado por variável de repositório.

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

O painel consulta a leitura mais recente a cada 5 segundos e mostra um aviso quando algum campo de sensor está ausente. O histórico agrupa as últimas 24 horas em intervalos de 15 minutos e os últimos 7 dias em intervalos de uma hora. O navegador recebe no máximo 97 ou 169 pontos, respectivamente, contando intervalos parciais. Nas séries numéricas, o valor do ponto é a média das medições válidas. Na série de chuva, é a porcentagem de leituras válidas que detectaram chuva.

No perfil `dashboard`, o Nginx serve a interface e encaminha `/api/` ao FastAPI pela rede do Docker. Por exemplo, o histórico agregado também pode ser consultado em `http://127.0.0.1:8080/api/v1/leituras/historico?periodo=24h`.

O mapa interativo usa o OpenStreetMap e indica uma posição aproximada no centro de São Paulo. Para coleções grandes, crie um índice em `coletado_em` com um usuário administrativo. Se a consulta usar o filtro de estação com frequência, o índice composto `{estacao_id: 1, coletado_em: 1}` também pode atender esse filtro. Datas em texto devem seguir ISO 8601 em UTC com prefixo `AAAA-MM-DDTHH:mm:ss`.

## 2. Conectar ao MongoDB real da EC2

A API local pode usar um túnel SSH com o banco remoto, **se** o MongoDB estiver acessível via porta de loopback no host EC2. Não publique a porta 27017 na Internet. Se o MongoDB estiver acessível apenas por rede Docker, será necessário ajustar o túnel ou usar ambiente local até o deploy.

Em produção, a API será conectada à **mesma rede Docker do MongoDB**, consultando-o por hostname interno. Não altere RabbitMQ, banco ou consumidor.

## 3. Git / GitHub

```bash
git init
git add .
git commit -m "feat: adiciona API meteorologica com testes e pipeline"
git branch -M main
# Crie um repositório vazio no GitHub e use a URL exibida lá:
git remote add origin <URL_REAL_DO_REPOSITORIO>
git push -u origin main
```

Os arquivos `.env` estão no `.gitignore` e não devem entrar no Git. Não inclua credenciais MQTT, Mongo, AWS ou chaves privadas em commits.

## 4. CI / CD

O workflow `.github/workflows/api.yml`:

1. Em PR: instala dependências e executa testes com `pytest`.
2. Em push para `main`: testa, constrói imagem Docker e publica em `ghcr.io/<owner>/<repo>:api-latest`.
3. **Somente quando** a variável de repositório `ENABLE_EC2_DEPLOY` for `true`: atualiza na EC2 **apenas** o serviço `estacao-api`.

**Configuração necessária antes do deploy:**

- Criar `/opt/estacao-api` na EC2 com permissão de escrita para o usuário SSH.
- Copiar `infra/ec2.env.example` para `/opt/estacao-api/.env` **no servidor** e ajustar MongoDB (host, banco, coleção) e `EXTERNAL_DOCKER_NETWORK` para valores existentes. Não usar esse arquivo do exemplo sem ajustes.
- Garantir que o contêiner MongoDB existente esteja conectado à rede Docker indicada.
- Verificar que Docker Compose está instalado na EC2 e o usuário SSH pode executar `docker`.
- Configurar segredos GitHub Actions: `EC2_HOST`, `EC2_USER`, `EC2_SSH_PRIVATE_KEY` e `EC2_SSH_KNOWN_HOSTS` (obtido após verificação independente da chave pública do servidor).
- Caso o pacote GHCR seja privado, autenticar o Docker **na EC2** com token de leitura de pacote, ou tornar o pacote público se adequado.
- Autorizar SSH do runner GitHub à EC2 conforme política de firewall; não abra desnecessariamente portas MongoDB/RabbitMQ na Internet.
- Finalmente configurar a variável GitHub Actions `ENABLE_EC2_DEPLOY=true`.

A API será publicada em `127.0.0.1:8000` **no host EC2**, e não diretamente na Internet. Para o dashboard público, acrescentar posteriormente um reverse proxy com HTTPS, autenticação/configuração de acesso conforme necessidade e CORS configurado para o domínio real.

## 5. Próximas melhorias

- Conferir o schema exato do MongoDB real, nomes da coleção e índices (`estacao_id`, `coletado_em`).
- Publicar o dashboard com HTTPS e integrar sua origem à API de produção.
- Evoluir segurança da esteira com políticas e permissões mínimas.

_Dados do seed são simulados e não representam leituras reais._
