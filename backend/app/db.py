from fastapi import Request
from pymongo import AsyncMongoClient

from app.config import get_settings


def get_collection(request: Request):
    settings = get_settings()
    client: AsyncMongoClient = request.app.state.mongo_client
    return client[settings.mongodb_database][settings.mongodb_collection]
