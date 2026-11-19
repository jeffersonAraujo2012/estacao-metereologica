from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

PeriodoLeituras = Literal["24h", "7d"]
MetricaLeituras = Literal[
    "temperatura_dht22_c", "temperatura_bmp180_c", "umidade_pct", "pressao_hpa",
    "luminosidade_pct", "ldr_bruto", "chuva_detectada",
]


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
    chuva_detectada: Literal[0, 1] | None


class HistoricoLeituras(BaseModel):
    inicio: datetime
    fim: datetime
    intervalo_minutos: int
    pontos: list[IntervaloHistorico]


class FaixaHistograma(BaseModel):
    inicio: float
    fim: float
    quantidade: int


class FaixaLuminosidade(BaseModel):
    hora: int | datetime
    amostras: int = 0
    minimo: float | None = None
    mediana: float | None = None
    maximo: float | None = None


class EstatisticasLeituras(BaseModel):
    amostras: int = 0
    amostras_validas: int = 0
    recorte_percentual_por_cauda: float | None = None
    media: float | None = None
    mediana: float | None = None
    desvio_padrao_amostral: float | None = None
    histograma: list[FaixaHistograma]
    perfil_luminosidade: list[FaixaLuminosidade] | None = None


def normalizar_leitura(documento: dict) -> Leitura:
    # O ObjectId não é diretamente serializável em JSON.
    dados = {**documento, "id": str(documento["_id"])}
    dados.pop("_id", None)
    return Leitura.model_validate(dados)
