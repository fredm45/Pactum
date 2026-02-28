"""
Pactum Gateway — FastAPI + WebSocket
Agent 通过 WS 连接，人类通过 REST API 查看
"""
import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

import os

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from config import PORT, PROTOCOL_VERSION, ESCROW_CONTRACT_ADDRESS, BASE_RPC_URL
from market.service import MarketService
from ws.connection import ConnectionManager
from ws.handler import WSHandler
from api.routes import router, init as init_routes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("pactum-gateway")

# ========== 初始化 ==========

market = MarketService()
manager = ConnectionManager(market.supabase)
ws_handler = WSHandler(market, manager)

init_routes(market, manager)

# ========== Telegram Bot ==========

_tg_bot = None
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

if TELEGRAM_BOT_TOKEN:
    from tg.bot import PactumBot
    from tg import notify as tg_notify
    _tg_bot = PactumBot(TELEGRAM_BOT_TOKEN, market.supabase)
    tg_notify.init(_tg_bot.bot, market.supabase)
    logger.info("Telegram bot initialized")
else:
    logger.warning("TELEGRAM_BOT_TOKEN not set — Telegram bot disabled")


# ========== AutoConfirm Cron ==========

ESCROW_ABI = [
    {
        "inputs": [{"name": "orderId", "type": "bytes32"}],
        "name": "autoConfirm",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function",
    },
    {
        "inputs": [{"name": "orderId", "type": "bytes32"}],
        "name": "isConfirmable",
        "outputs": [{"name": "", "type": "bool"}],
        "stateMutability": "view",
        "type": "function",
    },
]

DEPLOYER_PRIVATE_KEY = None  # 从环境变量读


async def auto_confirm_loop():
    """每小时扫描 paid 订单，超过1天调 autoConfirm"""
    import os
    from web3 import Web3

    pk = os.getenv("DEPLOYER_PRIVATE_KEY")
    if not pk or not BASE_RPC_URL or not ESCROW_CONTRACT_ADDRESS:
        logger.warning("[cron] AutoConfirm disabled — missing DEPLOYER_PRIVATE_KEY or RPC/escrow config")
        return

    w3 = Web3(Web3.HTTPProvider(BASE_RPC_URL))
    escrow = w3.eth.contract(
        address=Web3.to_checksum_address(ESCROW_CONTRACT_ADDRESS),
        abi=ESCROW_ABI,
    )
    account = w3.eth.account.from_key(pk)

    while True:
        try:
            # 查 paid 状态且超过1天的订单
            cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
            result = (
                market.supabase.table("orders")
                .select("order_id, tx_hash")
                .eq("status", "paid")
                .lt("updated_at", cutoff)
                .execute()
            )
            orders = result.data or []
            if orders:
                logger.info(f"[cron] Found {len(orders)} orders eligible for autoConfirm")

            for order in orders:
                try:
                    order_id_bytes32 = Web3.keccak(text=order["order_id"])
                    confirmable = escrow.functions.isConfirmable(order_id_bytes32).call()
                    if not confirmable:
                        continue

                    tx = escrow.functions.autoConfirm(order_id_bytes32).build_transaction({
                        "from": account.address,
                        "nonce": w3.eth.get_transaction_count(account.address),
                        "gas": 100000,
                        "gasPrice": w3.eth.gas_price,
                    })
                    signed = account.sign_transaction(tx)
                    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
                    w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)

                    market.supabase.table("orders").update(
                        {"status": "completed"}
                    ).eq("order_id", order["order_id"]).execute()

                    logger.info(f"[cron] AutoConfirmed order {order['order_id']} tx={tx_hash.hex()}")
                except Exception as e:
                    logger.error(f"[cron] Failed to autoConfirm {order['order_id']}: {e}")

        except Exception as e:
            logger.error(f"[cron] AutoConfirm loop error: {e}")

        await asyncio.sleep(3600)  # 每小时跑一次


# ========== Lifespan ==========

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Pactum Gateway v{PROTOCOL_VERSION} started")
    asyncio.create_task(auto_confirm_loop())

    # 设置 Telegram webhook
    if _tg_bot:
        try:
            await _tg_bot.bot.initialize()  # 必须先初始化 bot（获取 username 等）
            await _tg_bot.app.initialize()
            from config import PUBLIC_URL
            webhook_url = f"{PUBLIC_URL}/telegram/webhook"
            await _tg_bot.bot.set_webhook(webhook_url)
            logger.info(f"Telegram webhook set: {webhook_url}")
        except Exception as e:
            logger.error(f"Telegram webhook setup failed: {e}")

    yield

    if _tg_bot:
        try:
            await _tg_bot.bot.delete_webhook()
            await _tg_bot.app.shutdown()
        except Exception:
            pass
    logger.info("Pactum Gateway shutting down")


# ========== FastAPI ==========

app = FastAPI(
    title="Pactum Gateway",
    description="WebSocket gateway for autonomous AI agent marketplace",
    version=PROTOCOL_VERSION,
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


# ========== Telegram Webhook ==========

@app.post("/telegram/webhook")
async def telegram_webhook(request: Request):
    if not _tg_bot:
        return {"ok": False, "error": "Bot not configured"}
    data = await request.json()
    await _tg_bot.process_update(data)
    return {"ok": True}


# ========== WebSocket Endpoint ==========

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    wallet = None

    try:
        while True:
            msg = await ws.receive_json()
            response = await ws_handler.handle(ws, msg)

            # 认证成功后记录 wallet
            if not wallet:
                wallet = getattr(ws.state, "wallet", None)

            if response:
                await ws.send_json(response)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WS error: {e}")
    finally:
        if wallet:
            manager.disconnect(wallet)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
