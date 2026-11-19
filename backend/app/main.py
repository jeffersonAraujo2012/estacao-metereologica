from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pymongo import AsyncMongoClient
from pymongo.errors import PyMongoError

from app.config import get_settings
from app.routes import router


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    app.state.mongo_client = AsyncMongoClient(
        settings.mongodb_uri,
        serverSelectionTimeoutMS=5000,
        tz_aware=True,
    )
    yield
    await app.state.mongo_client.close()


app = FastAPI(
    title="Estação Meteorológica - API",
    description="Consulta de medições ambientais coletadas pelo ESP32.",
    version="0.1.0",
    lifespan=lifespan,
)
origins = [url.strip() for url in get_settings().cors_origins.split(",") if url.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/", tags=["Sistema"])
def inicio():
    return {"mensagem": "API da estação meteorológica", "documentacao": "/docs"}


@app.get("/health", tags=["Sistema"])
def health():
    return {"status": "ok"}


@app.get("/ready", tags=["Sistema"])
async def ready(request: Request):
    try:
        await request.app.state.mongo_client.admin.command("ping")
    except PyMongoError as erro:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="MongoDB indisponível") from erro
    return {"status": "ready", "mongodb": "ok"}
