from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pymongo import DESCENDING
from pymongo.errors import PyMongoError

from app.db import get_collection
from app.models import Leitura, normalizar_leitura

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
