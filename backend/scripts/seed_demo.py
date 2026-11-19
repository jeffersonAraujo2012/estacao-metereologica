"""Insere exemplos fictícios SOMENTE no MongoDB de desenvolvimento local."""
import os
from datetime import datetime, timedelta, timezone

from pymongo import MongoClient

uri = os.environ.get("MONGODB_URI", "mongodb://127.0.0.1:27017")
database = os.environ.get("MONGODB_DATABASE", "estacao_meteorologica")
collection = os.environ.get("MONGODB_COLLECTION", "leituras")
if uri != "mongodb://127.0.0.1:27017":
    raise RuntimeError("O seed de demonstração somente pode usar o MongoDB local padrão")

agora = datetime.now(timezone.utc)
docs = [
    {
        "versao_schema": 1,
        "estacao_id": "estacao-demo",
        "coletado_em": (agora - timedelta(minutes=5 * i)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "temperatura_dht22_c": 23.5 + i / 10,
        "umidade_pct": 80.0 + i,
        "temperatura_bmp180_c": 23.2 + i / 10,
        "pressao_hpa": 934.1 + i / 10,
        "ldr_bruto": 32 + i,
        "luminosidade_pct": 1.0,
        "chuva_detectada": False,
    }
    for i in range(5)
]
with MongoClient(uri) as client:
    result = client[database][collection].insert_many(docs)
    print(f"{len(result.inserted_ids)} documentos FICTÍCIOS inseridos em {database}.{collection}")
