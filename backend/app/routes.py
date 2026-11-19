from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pymongo import DESCENDING
from pymongo.errors import PyMongoError

from app.db import get_collection
from app.estatisticas import resumir_leituras
from app.models import (
    EstatisticasLeituras, HistoricoLeituras, Leitura, MetricaLeituras, PeriodoLeituras, normalizar_leitura,
)

router = APIRouter(prefix="/api/v1", tags=["Leituras"])


@router.get("/leituras/ultima", response_model=Leitura)
async def obter_ultima_leitura(
    estacao_id: Annotated[str | None, Query(max_length=100)] = None,
    colecao=Depends(get_collection),
):
    filtro = {"estacao_id": estacao_id} if estacao_id else {}
    try:
        documento = await colecao.find_one(filtro, sort=[("coletado_em", DESCENDING)])
    except PyMongoError as erro:
        raise HTTPException(status_code=503, detail="MongoDB indisponível") from erro
    if documento is None:
        raise HTTPException(status_code=404, detail="Nenhuma leitura encontrada")
    return normalizar_leitura(documento)


@router.get("/leituras", response_model=list[Leitura])
async def listar_leituras(
    limite: Annotated[int, Query(ge=1, le=100)] = 20,
    estacao_id: Annotated[str | None, Query(max_length=100)] = None,
    colecao=Depends(get_collection),
):
    filtro = {"estacao_id": estacao_id} if estacao_id else {}
    try:
        cursor = colecao.find(filtro).sort("coletado_em", DESCENDING).limit(limite)
        documentos = [normalizar_leitura(doc) async for doc in cursor]
    except PyMongoError as erro:
        raise HTTPException(status_code=503, detail="MongoDB indisponível") from erro
    return documentos


def filtrar_periodo(inicio: datetime, fim: datetime, estacao_id: str | None) -> list[dict]:
    # A faixa inicial usa o campo original para aproveitar o índice. Para textos
    # ISO-8601 UTC, inclui os segundos de borda e refina a faixa após a conversão.
    formato_segundo = "%Y-%m-%dT%H:%M:%S"
    filtro = {
        "$or": [
            {"coletado_em": {"$gte": inicio, "$lt": fim}},
            {"coletado_em": {
                "$gte": inicio.strftime(formato_segundo),
                "$lt": (fim + timedelta(seconds=1)).strftime(formato_segundo),
            }},
        ],
    }
    if estacao_id:
        filtro["estacao_id"] = estacao_id
    return [
        {"$match": filtro},
        {"$set": {"instante": {
            "$convert": {"input": "$coletado_em", "to": "date", "onError": None, "onNull": None},
        }}},
        {"$match": {"instante": {"$gte": inicio, "$lt": fim}}},
    ]


@router.get("/leituras/historico", response_model=HistoricoLeituras)
async def obter_historico(
    response: Response,
    periodo: PeriodoLeituras = "24h",
    estacao_id: Annotated[str | None, Query(max_length=100)] = None,
    colecao=Depends(get_collection),
):
    intervalo = 15 if periodo == "24h" else 60
    fim = datetime.now(timezone.utc)
    inicio = fim - timedelta(days=1 if periodo == "24h" else 7)
    campos = (
        "temperatura_dht22_c", "temperatura_bmp180_c", "umidade_pct",
        "pressao_hpa", "luminosidade_pct", "ldr_bruto",
    )
    pipeline = [
        *filtrar_periodo(inicio, fim, estacao_id),
        {"$set": {"chuva_valida": {"$eq": [{"$type": "$chuva_detectada"}, "bool"]}}},
        {"$group": {
            "_id": {"$dateTrunc": {"date": "$instante", "unit": "minute", "binSize": intervalo}},
            "amostras": {"$sum": 1},
            **{campo: {"$avg": f"${campo}"} for campo in campos},
            "chuva_detectada": {"$top": {
                "sortBy": {"chuva_valida": -1, "instante": -1, "_id": -1},
                "output": {"$cond": ["$chuva_valida", {"$toInt": "$chuva_detectada"}, None]},
            }},
        }},
        {"$sort": {"_id": 1}},
        {"$project": {
            "_id": 0,
            "inicio": "$_id",
            "amostras": 1,
            **dict.fromkeys(campos, 1),
            "chuva_detectada": 1,
        }},
    ]
    try:
        cursor = await colecao.aggregate(pipeline, maxTimeMS=5000)
        pontos = [ponto async for ponto in cursor]
    except PyMongoError as erro:
        raise HTTPException(status_code=503, detail="Histórico indisponível") from erro

    response.headers["Cache-Control"] = "public, max-age=60"
    return HistoricoLeituras(inicio=inicio, fim=fim, intervalo_minutos=intervalo, pontos=pontos)


@router.get("/leituras/estatisticas", response_model=EstatisticasLeituras)
async def obter_estatisticas(
    response: Response,
    metrica: MetricaLeituras,
    periodo: PeriodoLeituras = "24h",
    estacao_id: Annotated[str | None, Query(max_length=100)] = None,
    colecao=Depends(get_collection),
):
    fim = datetime.now(timezone.utc)
    inicio = fim - timedelta(days=1 if periodo == "24h" else 7)
    try:
        estatisticas = await resumir_leituras(
            colecao, filtrar_periodo(inicio, fim, estacao_id), metrica, periodo, inicio, fim,
        )
    except PyMongoError as erro:
        raise HTTPException(status_code=503, detail="Estatísticas indisponíveis") from erro

    response.headers["Cache-Control"] = "public, max-age=60"
    return estatisticas
