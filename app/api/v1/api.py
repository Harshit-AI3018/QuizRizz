from fastapi import APIRouter

from app.api.health import router as health_router
from app.api.v1.endpoints.administration import router as administration_router
from app.api.v1.endpoints.auth import router as auth_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(administration_router)
