from datetime import datetime, timedelta, timezone

import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from pymongo.errors import PyMongoError

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


@pytest.mark.parametrize(("periodo", "dias", "intervalo"), [("24h", 1, 15), ("7d", 7, 60)])
def test_historico_retorna_medias_e_preserva_nulos(periodo, dias, intervalo):
    class ColecaoHistorico:
        async def aggregate(self, pipeline, *, maxTimeMS):
            filtro = pipeline[0]["$match"]
            assert filtro["estacao_id"] == "estacao-001"
            faixa = filtro["$or"][0]["coletado_em"]
            assert (faixa["$lt"] - faixa["$gte"]).days == dias
            assert pipeline[4]["$group"]["_id"]["$dateTrunc"]["binSize"] == intervalo
            assert pipeline[3]["$set"]["chuva_valida"] == {"$eq": [{"$type": "$chuva_detectada"}, "bool"]}
            assert pipeline[4]["$group"]["chuva_detectada"]["$top"]["sortBy"] == {
                "chuva_valida": -1, "instante": -1, "_id": -1,
            }
            assert maxTimeMS == 5000
            inicio = datetime.now(timezone.utc)
            return CursorFake([{
                "inicio": inicio + timedelta(minutes=indice * intervalo),
                "amostras": 2,
                "temperatura_dht22_c": 23.8,
                "temperatura_bmp180_c": None,
                "umidade_pct": 81.8,
                "pressao_hpa": None,
                "luminosidade_pct": None,
                "ldr_bruto": None,
                "chuva_detectada": chuva,
            } for indice, chuva in enumerate((1, 0, None))])

    app.dependency_overrides[get_collection] = lambda: ColecaoHistorico()
    with TestClient(app) as client:
        resposta = client.get("/api/v1/leituras/historico", params={
            "periodo": periodo, "estacao_id": "estacao-001",
        })
    assert resposta.status_code == 200
    assert resposta.headers["Cache-Control"] == "public, max-age=60"
    dados = resposta.json()
    assert dados["intervalo_minutos"] == intervalo
    assert dados["pontos"][0]["temperatura_dht22_c"] == 23.8
    assert dados["pontos"][0]["pressao_hpa"] is None
    assert [ponto["chuva_detectada"] for ponto in dados["pontos"]] == [1, 0, None]


def test_historico_periodo_invalido():
    with criar_cliente([]) as client:
        resposta = client.get("/api/v1/leituras/historico?periodo=30d")
    assert resposta.status_code == 422


def test_historico_indisponivel():
    class ColecaoIndisponivel:
        async def aggregate(self, *args, **kwargs):
            raise PyMongoError("sem conexão")

    app.dependency_overrides[get_collection] = lambda: ColecaoIndisponivel()
    with TestClient(app) as client:
        resposta = client.get("/api/v1/leituras/historico")
    assert resposta.status_code == 503


def test_estatisticas_de_medicao_numerica():
    class ColecaoEstatisticas:
        async def aggregate(self, pipeline, *, allowDiskUse, maxTimeMS):
            assert allowDiskUse and maxTimeMS == 15000
            filtro = pipeline[0]["$match"]
            assert filtro["estacao_id"] == "estacao-001"
            faixa = filtro["$or"][0]["coletado_em"]
            assert (faixa["$lt"] - faixa["$gte"]).days == 7
            janela = pipeline[5]["$setWindowFields"]["output"]
            assert janela["posicao"] == {"$documentNumber": {}}
            recorte = pipeline[6]["$match"]["$expr"]["$and"]
            cauda = {"$floor": {"$divide": ["$amostras_validas", 40]}}
            assert recorte == [
                {"$gt": ["$posicao", cauda]},
                {"$lte": ["$posicao", {"$subtract": ["$amostras_validas", cauda]}]},
            ]
            resumo = pipeline[7]["$setWindowFields"]["output"]
            assert resumo["desvio_padrao_amostral"]["$stdDevSamp"] == "$valor"
            comum = {
                "amostras_validas": 4, "media": 3, "desvio_padrao_amostral": (20 / 3) ** 0.5,
                "minimo": 0, "maximo": 6, "quantidade": 1,
            }
            return CursorFake([
                {**comum, "_id": 0, "soma_centrais": 0, "quantidade_centrais": 0},
                {**comum, "_id": 3, "soma_centrais": 2, "quantidade_centrais": 1},
                {**comum, "_id": 6, "soma_centrais": 4, "quantidade_centrais": 1},
                {**comum, "_id": 9, "soma_centrais": 0, "quantidade_centrais": 0},
            ])

    app.dependency_overrides[get_collection] = lambda: ColecaoEstatisticas()
    with TestClient(app) as client:
        resposta = client.get("/api/v1/leituras/estatisticas", params={
            "metrica": "temperatura_dht22_c", "periodo": "7d", "estacao_id": "estacao-001",
        })
    assert resposta.status_code == 200
    dados = resposta.json()
    assert dados["amostras"] == 4
    assert dados["amostras_validas"] == 4
    assert dados["recorte_percentual_por_cauda"] == 2.5
    assert dados["media"] == 3
    assert dados["mediana"] == 3
    assert dados["desvio_padrao_amostral"] == pytest.approx((20 / 3) ** 0.5)
    assert [faixa["quantidade"] for faixa in dados["histograma"]] == [1, 0, 0, 1, 0, 0, 1, 0, 0, 1]
    assert dados["histograma"][-1]["fim"] == 6


@pytest.mark.parametrize(("metrica", "periodo"), [("luminosidade_pct", "24h"), ("ldr_bruto", "7d")])
def test_perfil_de_luminosidade_preserva_extremos_e_lacunas(metrica, periodo):
    class ColecaoLuminosidade:
        async def aggregate(self, pipeline, *, allowDiskUse, maxTimeMS):
            assert allowDiskUse and maxTimeMS == 15000
            projecao = pipeline[3]["$project"]
            assert projecao["valor"]["$cond"][1] == {"$toDouble": f"${metrica}"}
            if periodo == "7d":
                assert projecao["hora"] == {"$hour": {"date": "$instante", "timezone": "America/Sao_Paulo"}}
                self.hora = 4
            else:
                assert projecao["hora"] == {"$dateTrunc": {"date": "$instante", "unit": "hour"}}
                inicio = pipeline[0]["$match"]["$or"][0]["coletado_em"]["$gte"]
                self.hora = inicio.replace(minute=0, second=0, microsecond=0) + timedelta(hours=4)
            janela = pipeline[5]["$setWindowFields"]["output"]
            assert janela["posicao"] == {"$documentNumber": {}}
            assert pipeline[6]["$setWindowFields"]["partitionBy"] == "$hora"
            assert pipeline[7]["$group"]["minimo"] == {"$min": "$valor"}
            assert pipeline[7]["$group"]["maximo"] == {"$max": "$valor"}
            comum = {
                "amostras_validas": 80, "media": 50, "desvio_padrao_amostral": 50.3,
                "amostras": 80, "minimo": 0, "mediana": 50, "maximo": 100,
            }
            return CursorFake([
                {**comum, "_id": self.hora, "soma_centrais": 100, "quantidade_centrais": 2},
            ])

    app.dependency_overrides[get_collection] = lambda: ColecaoLuminosidade()
    with TestClient(app) as client:
        resposta = client.get("/api/v1/leituras/estatisticas", params={"metrica": metrica, "periodo": periodo})
    assert resposta.status_code == 200
    dados = resposta.json()
    assert dados["amostras"] == dados["amostras_validas"] == 80
    assert dados["recorte_percentual_por_cauda"] is None
    assert dados["histograma"] == []
    perfil = dados["perfil_luminosidade"]
    assert len(perfil) in ((24,) if periodo == "7d" else (24, 25))
    assert perfil[0]["amostras"] == 0 and perfil[0]["minimo"] is None
    assert perfil[4]["minimo"] == 0 and perfil[4]["maximo"] == 100
    assert perfil[4]["mediana"] == 50 and perfil[4]["amostras"] == 80
    assert isinstance(perfil[4]["hora"], int if periodo == "7d" else str)


def test_estatisticas_de_chuva_contam_estados():
    class ColecaoChuva:
        async def aggregate(self, pipeline, *, maxTimeMS):
            assert pipeline[3]["$match"] == {"$expr": {"$eq": [{"$type": "$chuva_detectada"}, "bool"]}}
            return CursorFake([{"_id": 0, "quantidade": 8}])

    app.dependency_overrides[get_collection] = lambda: ColecaoChuva()
    with TestClient(app) as client:
        resposta = client.get("/api/v1/leituras/estatisticas", params={"metrica": "chuva_detectada"})
    assert resposta.status_code == 200
    dados = resposta.json()
    assert dados["amostras"] == 8
    assert dados["amostras_validas"] == 8
    assert dados["recorte_percentual_por_cauda"] is None
    assert dados["media"] is None
    assert dados["histograma"] == [
        {"inicio": 0, "fim": 0, "quantidade": 8},
        {"inicio": 1, "fim": 1, "quantidade": 0},
    ]


def test_estatisticas_metrica_invalida():
    with criar_cliente([]) as client:
        resposta = client.get("/api/v1/leituras/estatisticas", params={"metrica": "campo_inexistente"})
    assert resposta.status_code == 422
