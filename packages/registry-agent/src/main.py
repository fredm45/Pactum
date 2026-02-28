"""
Pactum Marketplace - 中心化交易市场 API
"""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from typing import Optional, Dict, Any
from dotenv import load_dotenv

from .marketplace import MarketplaceService

load_dotenv()

PROTOCOL_VERSION = "0.2.0"

app = FastAPI(
    title="Pactum Marketplace",
    description="Autonomous marketplace for AI agents",
    version=PROTOCOL_VERSION,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

marketplace = MarketplaceService(
    supabase_url=os.getenv("SUPABASE_URL"),
    supabase_key=os.getenv("SUPABASE_KEY"),
    contract_address=os.getenv("PACTUM_AGENT_CONTRACT_ADDRESS"),
    rpc_url=os.getenv("BASE_RPC_URL"),
)

# Load protocol doc from JSON file
_protocol_path = Path(__file__).resolve().parent.parent / "protocol.json"
with open(_protocol_path) as f:
    PROTOCOL_DOC = json.load(f)


# ========== Auth ==========

security = HTTPBearer(auto_error=False)


async def get_current_wallet(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> str:
    """Extract wallet from Bearer token. Raises 401 on failure."""
    if not credentials:
        raise HTTPException(
            status_code=401,
            detail=json.dumps({
                "protocol_version": PROTOCOL_VERSION,
                "error": "AUTH_REQUIRED",
                "message": "Bearer token required. Use /market/auth/challenge + /market/auth/verify to obtain one.",
            }),
        )
    try:
        wallet = MarketplaceService.decode_token(credentials.credentials)
        return wallet
    except ValueError as e:
        raise HTTPException(
            status_code=401,
            detail=json.dumps({
                "protocol_version": PROTOCOL_VERSION,
                "error": "AUTH_FAILED",
                "message": str(e),
            }),
        )


# ========== Helpers ==========


def _err(status_code: int, error: str, **extra) -> JSONResponse:
    """Build a standard error response with protocol_version."""
    body = {"protocol_version": PROTOCOL_VERSION, "error": error, **extra}
    return JSONResponse(status_code=status_code, content=body)


def _check_registered(wallet: str):
    """Check if wallet is registered. Raises 403 if not."""
    agent = (
        marketplace.supabase.table("agents")
        .select("wallet")
        .eq("wallet", wallet.lower())
        .execute()
    )
    if not agent.data:
        raise HTTPException(status_code=403, detail=json.dumps({
            "protocol_version": PROTOCOL_VERSION,
            "error": "NOT_REGISTERED",
            "next_step": {
                "method": "POST",
                "url": f"{os.getenv('PUBLIC_URL', 'https://api.pactum.cc')}/market/register",
                "required": ["wallet", "description"],
            },
        }))


# ========== Request Models ==========


class RegisterRequest(BaseModel):
    wallet: str
    description: str


class AuthVerifyRequest(BaseModel):
    wallet: str
    signature: str
    challenge: str
    timestamp: int


class EnterRequest(BaseModel):
    action: str  # "buy" or "sell"
    # buy fields
    query: Optional[str] = None
    max_price: Optional[float] = None
    context_id: Optional[str] = None
    # sell fields
    name: Optional[str] = None
    description: Optional[str] = None
    price: Optional[float] = None
    type: Optional[str] = None
    endpoint: Optional[str] = None


class BuyRequest(BaseModel):
    query: Optional[str] = None
    shipping_address: Optional[Dict[str, Any]] = None


# ========== Auth Endpoints ==========


@app.post("/market/auth/challenge")
async def auth_challenge():
    """Generate a challenge for EIP-712 authentication"""
    result = marketplace.create_challenge()
    return {"protocol_version": PROTOCOL_VERSION, **result}


@app.post("/market/auth/verify")
async def auth_verify(req: AuthVerifyRequest):
    """Verify EIP-712 signature and issue JWT"""
    try:
        token = marketplace.verify_challenge(
            wallet=req.wallet,
            challenge=req.challenge,
            timestamp=req.timestamp,
            signature=req.signature,
        )
        return {
            "protocol_version": PROTOCOL_VERSION,
            "token": token,
            "wallet": req.wallet.lower(),
        }
    except ValueError as e:
        return _err(401, "AUTH_FAILED", message=str(e))


# ========== Public Endpoints ==========


@app.get("/market")
async def get_protocol():
    """返回协议文档"""
    return PROTOCOL_DOC


@app.get("/health")
async def health():
    """健康检查"""
    return {
        "status": "healthy",
        "service": "pactum-marketplace",
        "protocol_version": PROTOCOL_VERSION,
    }


@app.get("/market/stats")
async def stats():
    """市场统计"""
    result = await marketplace.get_stats()
    return {**result, "protocol_version": PROTOCOL_VERSION}


# ========== Registration (no auth needed) ==========


@app.post("/market/register")
async def register(req: RegisterRequest):
    """注册 agent 身份（无需签名）"""
    try:
        result = await marketplace.register_agent(
            wallet=req.wallet,
            description=req.description,
        )
        return {
            "protocol_version": PROTOCOL_VERSION,
            "status": "registered",
            "token_id": result.get("token_id"),
            "wallet": result["wallet"],
        }
    except PermissionError:
        return _err(403, "NOT_REGISTERED",
                     next_step={
                         "method": "POST",
                         "url": f"{os.getenv('PUBLIC_URL', 'https://api.pactum.cc')}/market/register",
                         "required": ["wallet", "description"],
                     })
    except FileExistsError:
        return JSONResponse(
            status_code=409,
            content={"protocol_version": PROTOCOL_VERSION, "status": "already_registered"},
        )
    except ValueError as e:
        return _err(400, "INVALID_REQUEST", message=str(e))


# ========== Authenticated Endpoints ==========


@app.post("/market/enter")
async def enter(req: EnterRequest, wallet: str = Depends(get_current_wallet)):
    """进入市场（买或卖）"""
    _check_registered(wallet)

    if req.action == "buy":
        results = await marketplace.enter_buy(
            query=req.query or "",
            max_price=req.max_price,
        )
        return results

    elif req.action == "sell":
        missing = []
        if not req.description:
            missing.append("description")
        if req.price is None:
            missing.append("price")
        if not req.type:
            missing.append("type")
        if missing:
            return _err(400, "MISSING_FIELDS", missing=missing)

        try:
            item = await marketplace.enter_sell(
                wallet=wallet,
                description=req.description,
                price=req.price,
                item_type=req.type,
                endpoint=req.endpoint,
                name=req.name,
            )
            return {**item, "protocol_version": PROTOCOL_VERSION}
        except PermissionError:
            return _err(403, "NOT_REGISTERED",
                         next_step={
                             "method": "POST",
                             "url": f"{os.getenv('PUBLIC_URL', 'https://api.pactum.cc')}/market/register",
                             "required": ["wallet", "description"],
                         })
        except ValueError as e:
            return _err(400, "INVALID_REQUEST", message=str(e))

    else:
        return _err(400, "INVALID_REQUEST", message="action must be 'buy' or 'sell'")


@app.post("/market/buy/{item_id}")
async def buy(item_id: str, req: BuyRequest, request: Request, wallet: str = Depends(get_current_wallet)):
    """购买流程（402 → 付款 → X-Payment-Proof 重试）"""
    _check_registered(wallet)

    payment_proof = request.headers.get("X-Payment-Proof")

    if not payment_proof:
        try:
            result = await marketplace.create_order(
                item_id=item_id,
                buyer_wallet=wallet,
                shipping_address=req.shipping_address,
                buyer_query=req.query,
            )
            amount_decimal = float(result["payment"]["amount"])
            amount_units = int(amount_decimal * 1_000_000)
            expires = (datetime.now(timezone.utc) + timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")

            return JSONResponse(
                status_code=402,
                content={
                    "protocol_version": PROTOCOL_VERSION,
                    "error": "PAYMENT_REQUIRED",
                    "order_id": result["order"]["order_id"],
                    "amount_units": amount_units,
                    "currency": "USDC",
                    "recipient": result["payment"]["recipient"],
                    "network": "testnet",
                    "expires": expires,
                },
            )
        except FileNotFoundError as e:
            return _err(404, "NOT_FOUND", message=str(e))
        except ValueError as e:
            msg = str(e)
            if "shipping_address" in msg.lower():
                return _err(400, "SHIPPING_REQUIRED",
                             required_fields=["name", "street", "city", "state", "zip", "country"])
            return _err(400, "INVALID_REQUEST", message=msg)
    else:
        order_id = request.headers.get("X-Order-Id")
        if not order_id:
            return _err(400, "MISSING_FIELDS", missing=["X-Order-Id header"])
        try:
            result = await marketplace.confirm_payment(
                order_id=order_id,
                tx_hash=payment_proof,
            )
            return {**result, "protocol_version": PROTOCOL_VERSION}
        except FileNotFoundError as e:
            return _err(404, "NOT_FOUND", message=str(e))
        except ValueError as e:
            return _err(400, "INVALID_REQUEST", message=str(e))


@app.get("/market/order/{order_id}")
async def get_order(order_id: str, wallet: str = Depends(get_current_wallet)):
    """查询订单（Bearer token 认证）"""
    try:
        order = await marketplace.get_order(order_id, wallet)
        if not order:
            return _err(404, "NOT_FOUND", message="Order not found")
        return {**order, "protocol_version": PROTOCOL_VERSION}
    except PermissionError as e:
        return _err(403, "FORBIDDEN", message=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 8000)),
        reload=True,
    )
