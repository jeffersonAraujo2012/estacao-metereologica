from datetime import datetime

from pydantic import BaseModel, ConfigDict


class Leitura(BaseModel):
    # Campos opcionais preservam compatibilidade com leituras antigas.
    id: str
    estacao_id: str | None = None
    coletado_em: str | datetime | None = None
    versao_schema: int | None = None
    temperatura_dht22_c: float | None = None
    umidade_pct: float | None = None
    temperatura_bmp180_c: float | None = None
    pressao_hpa: float | None = None
    ldr_bruto: int | None = None
    luminosidade_pct: float | None = None
    chuva_detectada: bool | None = None

    model_config = ConfigDict(extra="ignore")


class IntervaloHistorico(BaseModel):
    inicio: datetime
    amostras: int
    temperatura_dht22_c: float | None
    temperatura_bmp180_c: float | None
    umidade_pct: float | None
    pressao_hpa: float | None
    luminosidade_pct: float | None
    ldr_bruto: float | None
    chuva_detectada_pct: float | None


class HistoricoLeituras(BaseModel):
    inicio: datetime
    fim: datetime
    intervalo_minutos: int
    pontos: list[IntervaloHistorico]


def normalizar_leitura(documento: dict) -> Leitura:
    # O ObjectId não é diretamente serializável em JSON.
    dados = {**documento, "id": str(documento["_id"])}
    dados.pop("_id", None)
    return Leitura.model_validate(dados)
