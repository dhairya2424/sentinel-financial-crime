import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import alerts, auth, entities, graph, ingest, ops, timeline, users
from app.db import SessionLocal, engine
from app.graph.service import graph_service
from app.pipeline import worker
from app.realtime import hub
from app.redis_client import redis

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("sentinel")

ERROR_CODES = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict", 422: "validation_error"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        async with SessionLocal() as db:
            for s in await graph_service.rebuild_all(db):
                log.info(
                    '{"span":"graph_rebuild_ms","tenant":"%s","ms":%s,"nodes":%d,"edges":%s}',
                    s.tenant_id,
                    s.ms,
                    s.nodes,
                    json.dumps(s.edges),
                )
    except Exception as exc:  # noqa: BLE001 - the API still serves; each tenant graph rebuilds lazily on first use
        log.error("graph rebuild at startup failed: %s", exc)
    worker.start()
    log.info("ready")
    yield
    await worker.stop()
    await redis.aclose()
    await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(title="Sentinel API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(HTTPException)
    async def _http_error(_: Request, exc: HTTPException) -> JSONResponse:
        body = {"detail": exc.detail, "code": ERROR_CODES.get(exc.status_code, "error")}
        return JSONResponse(body, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [{k: v for k, v in e.items() if k not in ("input", "ctx")} for e in exc.errors()]
        return JSONResponse({"detail": jsonable_encoder(errors), "code": "validation_error"}, status_code=422)

    for module in (auth, users, entities, ingest, timeline, graph, alerts, ops, hub):
        app.include_router(module.router, prefix="/v1")
    return app


app = create_app()
