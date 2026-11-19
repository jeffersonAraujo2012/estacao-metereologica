from pymongo.asynchronous.collection import AsyncCollection

from app.models import EstatisticasLeituras, FaixaHistograma, MetricaLeituras

TOTAL_FAIXAS = 10


async def resumir_leituras(
    colecao: AsyncCollection,
    filtro: list[dict],
    metrica: MetricaLeituras,
) -> EstatisticasLeituras:
    if metrica == "chuva_detectada":
        cursor = await colecao.aggregate([
            *filtro,
            {"$match": {"$expr": {"$eq": [{"$type": "$chuva_detectada"}, "bool"]}}},
            {"$group": {"_id": {"$toInt": "$chuva_detectada"}, "quantidade": {"$sum": 1}}},
        ], maxTimeMS=15000)
        contagens = {item["_id"]: item["quantidade"] async for item in cursor}
        return EstatisticasLeituras(
            amostras=sum(contagens.values()),
            histograma=[
                FaixaHistograma(inicio=estado, fim=estado, quantidade=contagens.get(estado, 0))
                for estado in (0, 1)
            ],
        )

    campo = f"${metrica}"
    janela = {"documents": ["unbounded", "unbounded"]}
    # Em posição de base 1, as observações centrais coincidem quando n é ímpar.
    metades = {"$divide": ["$amostras", 2]}
    posicao_central = {"$or": [
        {"$eq": ["$posicao", {"$ceil": metades}]},
        {"$eq": ["$posicao", {"$add": [{"$floor": metades}, 1]}]},
    ]}
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
        *filtro,
        {"$project": {"_id": 0, "valor": {"$cond": [
            {"$isNumber": campo}, {"$toDouble": campo}, None,
        ]}}},
        {"$match": {"valor": {"$gt": float("-inf"), "$lt": float("inf")}}},
        {"$setWindowFields": {
            "sortBy": {"valor": 1},
            "output": {
                "posicao": {"$documentNumber": {}},
                "amostras": {"$count": {}, "window": janela},
                "media": {"$avg": "$valor", "window": janela},
                "desvio_padrao_amostral": {"$stdDevSamp": "$valor", "window": janela},
                "minimo": {"$min": "$valor", "window": janela},
                "maximo": {"$max": "$valor", "window": janela},
            },
        }},
        {"$group": {
            "_id": faixa,
            "quantidade": {"$sum": 1},
            "soma_centrais": {"$sum": {"$cond": [posicao_central, "$valor", 0]}},
            "quantidade_centrais": {"$sum": {"$cond": [posicao_central, 1, 0]}},
            **{nome: {"$first": f"${nome}"} for nome in (
                "amostras", "media", "desvio_padrao_amostral", "minimo", "maximo",
            )},
        }},
    ], allowDiskUse=True, maxTimeMS=15000)
    faixas = {int(item["_id"]): item async for item in cursor}
    if not faixas:
        return EstatisticasLeituras(histograma=[])

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
    soma_centrais = sum(item["soma_centrais"] for item in faixas.values())
    quantidade_centrais = sum(item["quantidade_centrais"] for item in faixas.values())
    return EstatisticasLeituras(
        amostras=resumo["amostras"],
        media=resumo["media"],
        mediana=soma_centrais / quantidade_centrais,
        desvio_padrao_amostral=resumo["desvio_padrao_amostral"],
        histograma=histograma,
    )
