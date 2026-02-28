"""
Pactum Wallet — FastAPI 微服务入口
"""
import asyncio
import logging
import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import PORT
from api.routes import router
from chain.scanner import scanner_loop, expired_payment_cleanup_loop

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("pactum-wallet")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Pactum Wallet service started")
    asyncio.create_task(scanner_loop())
    asyncio.create_task(expired_payment_cleanup_loop())
    yield
    logger.info("Pactum Wallet service shutting down")


app = FastAPI(
    title="Pactum Wallet",
    description="Hosted USDC wallet for AI agents — zero-friction payments",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "pactum-wallet"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
