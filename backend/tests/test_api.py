from bson import ObjectId
from fastapi.testclient import TestClient

from app.db import get_collection
from app.main import app


DOCUMENTOS = [
    {
        "_id": ObjectId("691000000000000000000001"),
        "estacao_id": "estacao-001",
        "coletado_em": "2026-11-12T12:00:00Z",
        "temperatura_dht22_c": 23.7,
        "umidade_pct": 82.5,
        "chuva_detectada": False,
    },
    {
        "_id": ObjectId("691000000000000000000002"),
        "estacao_id": "estacao-001",
        "coletado_em": "2026-11-12T12:05:00Z",
        "temperatura_dht22_c": 23.9,
        "umidade_pct": 81.1,
        "chuva_detectada": True,
    },
]


class CursorFake:
    def __init__(self, documentos):
        self.documentos = documentos
        self.indice = 0

    def sort(self, campo, sentido):
        self.documentos.sort(key=lambda d: d.get(campo, ""), reverse=sentido == -1)
        return self

    def limit(self, n):
        self.documentos = self.documentos[:n]
        return self

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.indice >= len(self.documentos):
            raise StopAsyncIteration
        valor = self.documentos[self.indice]
        self.indice += 1
        return valor


class ColecaoFake:
    def __init__(self, documentos):
        self.documentos = documentos

    def find(self, filtro):
        return CursorFake([
            doc.copy() for doc in self.documentos
            if all(doc.get(k) == v for k, v in filtro.items())
        ])

    async def find_one(self, filtro, sort):
        docs = self.find(filtro).sort(sort[0][0], sort[0][1]).limit(1).documentos
        return docs[0] if docs else None


def criar_cliente(documentos):
    app.dependency_overrides[get_collection] = lambda: ColecaoFake(documentos)
    return TestClient(app)


def teardown_function():
    app.dependency_overrides.clear()


def test_health():
    with criar_cliente(DOCUMENTOS) as client:
        resposta = client.get("/health")
    assert resposta.status_code == 200
    assert resposta.json() == {"status": "ok"}


def test_ultima_leitura():
    with criar_cliente(DOCUMENTOS) as client:
        resposta = client.get("/api/v1/leituras/ultima")
    assert resposta.status_code == 200
    assert resposta.json()["temperatura_dht22_c"] == 23.9
    assert resposta.json()["id"] == "691000000000000000000002"


def test_listagem_limite():
    with criar_cliente(DOCUMENTOS) as client:
        resposta = client.get("/api/v1/leituras?limite=1")
    assert resposta.status_code == 200
    assert len(resposta.json()) == 1
    assert resposta.json()[0]["chuva_detectada"] is True


def test_estacao_inexistente():
    with criar_cliente(DOCUMENTOS) as client:
        resposta = client.get("/api/v1/leituras/ultima?estacao_id=nao-existe")
    assert resposta.status_code == 404


def test_limite_invalido():
    with criar_cliente(DOCUMENTOS) as client:
        resposta = client.get("/api/v1/leituras?limite=101")
    assert resposta.status_code == 422
