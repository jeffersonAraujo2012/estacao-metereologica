from datetime import datetime, timedelta

from pymongo.asynchronous.collection import AsyncCollection

from app.models import (
    EstatisticasLeituras, FaixaHistograma, FaixaLuminosidade, MetricaLeituras, PeriodoLeituras,
)

TOTAL_FAIXAS = 10
RECORTE_PERCENTUAL_POR_CAUDA = 2.5
JANELA_COMPLETA = {"documents": ["unbounded", "unbounded"]}


def selecionar_centro(posicao: str, amostras: str) -> dict:
    metade = {"$divide": [amostras, 2]}
    return {"$or": [
        {"$eq": [posicao, {"$ceil": metade}]},
        {"$eq": [posicao, {"$add": [{"$floor": metade}, 1]}]},
    ]}


CENTRO_GLOBAL = selecionar_centro("$posicao", "$amostras_validas")
CAMPOS_RESUMO_GLOBAL = {
    "soma_centrais": {"$sum": {"$cond": [CENTRO_GLOBAL, "$valor", 0]}},
    "quantidade_centrais": {"$sum": {"$cond": [CENTRO_GLOBAL, 1, 0]}},
    **{nome: {"$first": f"${nome}"} for nome in ("amostras_validas", "media", "desvio_padrao_amostral")},
}


def mediana_global(grupos: list[dict]) -> float:
    return sum(item["soma_centrais"] for item in grupos) / sum(item["quantidade_centrais"] for item in grupos)


async def resumir_perfil_luminosidade(
    colecao: AsyncCollection,
    etapas: list[dict],
    periodo: PeriodoLeituras,
    inicio: datetime,
    fim: datetime,
) -> EstatisticasLeituras:
    centro_hora = selecionar_centro("$posicao_hora", "$amostras_hora")
    cursor = await colecao.aggregate([
        *etapas,
        {"$setWindowFields": {
            "partitionBy": "$hora", "sortBy": {"valor": 1},
            "output": {
                "posicao_hora": {"$documentNumber": {}},
                "amostras_hora": {"$count": {}, "window": JANELA_COMPLETA},
            },
        }},
        {"$group": {
            "_id": "$hora",
            "amostras": {"$sum": 1},
            "minimo": {"$min": "$valor"},
            "mediana": {"$avg": {"$cond": [centro_hora, "$valor", None]}},
            "maximo": {"$max": "$valor"},
            **CAMPOS_RESUMO_GLOBAL,
        }},
    ], allowDiskUse=True, maxTimeMS=15000)
    grupos = {grupo["_id"]: grupo async for grupo in cursor}
    if not grupos:
        return EstatisticasLeituras(histograma=[], perfil_luminosidade=[])

    resumo = next(iter(grupos.values()))
    if periodo == "7d":
        horarios = list(range(24))
    else:
        primeira_hora = inicio.replace(minute=0, second=0, microsecond=0)
        horarios = [primeira_hora + timedelta(hours=i) for i in range(25)]
        horarios = [hora for hora in horarios if hora < fim]

    return EstatisticasLeituras(
        amostras=resumo["amostras_validas"],
        amostras_validas=resumo["amostras_validas"],
        media=resumo["media"],
        mediana=mediana_global(list(grupos.values())),
        desvio_padrao_amostral=resumo["desvio_padrao_amostral"],
        histograma=[],
        perfil_luminosidade=[FaixaLuminosidade(hora=hora, **grupos.get(hora, {})) for hora in horarios],
    )


async def resumir_leituras(
    colecao: AsyncCollection,
    filtro: list[dict],
    metrica: MetricaLeituras,
    periodo: PeriodoLeituras,
    inicio: datetime,
    fim: datetime,
) -> EstatisticasLeituras:
    if metrica == "chuva_detectada":
        cursor = await colecao.aggregate([
            *filtro,
            {"$match": {"$expr": {"$eq": [{"$type": "$chuva_detectada"}, "bool"]}}},
            {"$group": {"_id": {"$toInt": "$chuva_detectada"}, "quantidade": {"$sum": 1}}},
        ], maxTimeMS=15000)
        contagens = {item["_id"]: item["quantidade"] async for item in cursor}
        amostras = sum(contagens.values())
        return EstatisticasLeituras(
            amostras=amostras,
            amostras_validas=amostras,
            histograma=[
                FaixaHistograma(inicio=estado, fim=estado, quantidade=contagens.get(estado, 0))
                for estado in (0, 1)
            ],
        )

    campo = f"${metrica}"
    luminosidade = metrica in ("luminosidade_pct", "ldr_bruto")
    projecao = {
        "_id": 0,
        "valor": {"$cond": [{"$isNumber": campo}, {"$toDouble": campo}, None]},
    }
    if luminosidade:
        projecao["hora"] = (
            {"$hour": {"date": "$instante", "timezone": "America/Sao_Paulo"}}
            if periodo == "7d"
            else {"$dateTrunc": {"date": "$instante", "unit": "hour"}}
        )
    etapas_valor = [
        *filtro,
        {"$project": projecao},
        {"$match": {"valor": {"$gt": float("-inf"), "$lt": float("inf")}}},
    ]

    resumo_janela = {
        "media": {"$avg": "$valor", "window": JANELA_COMPLETA},
        "desvio_padrao_amostral": {"$stdDevSamp": "$valor", "window": JANELA_COMPLETA},
    }
    janela_ordenada = {
        "sortBy": {"valor": 1},
        "output": {
            "posicao": {"$documentNumber": {}},
            "amostras_validas": {"$count": {}, "window": JANELA_COMPLETA},
        },
    }
    if luminosidade:
        janela_ordenada["output"].update(resumo_janela)
        return await resumir_perfil_luminosidade(
            colecao, [*etapas_valor, {"$setWindowFields": janela_ordenada}], periodo, inicio, fim,
        )

    # As posições centrais originais continuam centrais após retirar o mesmo
    # número de leituras nas duas pontas.
    recorte = RECORTE_PERCENTUAL_POR_CAUDA
    cauda = {"$floor": {"$divide": ["$amostras_validas", 100 / recorte]}}
    amplitude = {"$subtract": ["$maximo", "$minimo"]}
    faixa = {"$cond": [
        {"$gt": ["$maximo", "$minimo"]},
        {"$min": [TOTAL_FAIXAS - 1, {"$floor": {"$multiply": [
            TOTAL_FAIXAS,
            {"$divide": [{"$subtract": ["$valor", "$minimo"]}, amplitude]},
        ]}}]},
        0,
    ]}

    cursor = await colecao.aggregate([
        *etapas_valor,
        {"$setWindowFields": janela_ordenada},
        {"$match": {"$expr": {"$and": [
            {"$gt": ["$posicao", cauda]},
            {"$lte": ["$posicao", {"$subtract": ["$amostras_validas", cauda]}]},
        ]}}},
        {"$setWindowFields": {"output": {
            **resumo_janela,
            "minimo": {"$min": "$valor", "window": JANELA_COMPLETA},
            "maximo": {"$max": "$valor", "window": JANELA_COMPLETA},
        }}},
        {"$group": {
            "_id": faixa,
            "quantidade": {"$sum": 1},
            "minimo": {"$first": "$minimo"},
            "maximo": {"$first": "$maximo"},
            **CAMPOS_RESUMO_GLOBAL,
        }},
    ], allowDiskUse=True, maxTimeMS=15000)
    faixas = {int(item["_id"]): item async for item in cursor}
    if not faixas:
        return EstatisticasLeituras(recorte_percentual_por_cauda=recorte, histograma=[])

    resumo = next(iter(faixas.values()))
    minimo, maximo = resumo["minimo"], resumo["maximo"]
    total = 1 if minimo == maximo else TOTAL_FAIXAS
    largura = (maximo - minimo) / total
    histograma = [
        FaixaHistograma(
            inicio=minimo + indice * largura,
            fim=maximo if indice == total - 1 else minimo + (indice + 1) * largura,
            quantidade=faixas[indice]["quantidade"] if indice in faixas else 0,
        )
        for indice in range(total)
    ]
    return EstatisticasLeituras(
        amostras=sum(item["quantidade"] for item in faixas.values()),
        amostras_validas=resumo["amostras_validas"],
        recorte_percentual_por_cauda=recorte,
        media=resumo["media"],
        mediana=mediana_global(list(faixas.values())),
        desvio_padrao_amostral=resumo["desvio_padrao_amostral"],
        histograma=histograma,
    )
