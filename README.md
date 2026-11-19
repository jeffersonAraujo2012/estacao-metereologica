# Estação meteorológica — PD-II UNIP

Projeto integrador em evolução. **Este pacote contém somente o backend FastAPI e a infraestrutura para CI/CD**; não substitui o firmware, o consumidor Python, o RabbitMQ nem o MongoDB já existentes na EC2.

## Arquitetura

`ESP32 → RabbitMQ (MQTT/TLS) → consumidor Python (validação) → MongoDB → FastAPI → dashboard (futuro)`

- FastAPI: API de consulta (leitura) ao MongoDB. O consumidor permanece como único responsável pela ingestão MQTT.
- PyMongo Async: driver assíncrono oficial.
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

**Atenção:** `MONGODB_DATABASE` e `MONGODB_COLLECTION` são valores de EXEMPLO; ajuste para os nomes reais usados pelo consumidor Python. A ordenação supõe que `coletado_em` seja persistido de forma coerente, em ISO-8601 UTC ou `datetime` BSON, sem formatos misturados.

### Teste da API

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/ready
curl 'http://127.0.0.1:8000/api/v1/leituras/ultima'
curl 'http://127.0.0.1:8000/api/v1/leituras?limite=10'
```

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
- Criar endpoints agregados para gráficos de temperatura, umidade e pressão.
- Criar dashboard React + TypeScript + Vite, com histórico, indicadores e mapa.
- Evoluir segurança da esteira com políticas e permissões mínimas.

_Dados do seed são simulados e não representam leituras reais._
