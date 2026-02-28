"""
REST API 端点 — 前端 + 外部集成
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Request, HTTPException, Depends, Query, UploadFile, File, Form
from fastapi.responses import JSONResponse, PlainTextResponse, RedirectResponse, HTMLResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from config import PROTOCOL_VERSION, PUBLIC_URL, ESCROW_CONTRACT_ADDRESS, USDC_CONTRACT_ADDRESS, PAYMASTER_URL
from market import auth
from market.models import AuthVerifyRequest, RegisterRequest, RegisterSellerRequest, BuyRequest, ListItemRequest, UpdateAddressRequest
from tg.notify import send_notification as _tg_notify

router = APIRouter()
security = HTTPBearer(auto_error=False)

_market = None
_manager = None


def init(market, manager=None):
    global _market, _manager
    _market = market
    _manager = manager


def _err(status_code: int, error: str, **extra) -> JSONResponse:
    body = {"protocol_version": PROTOCOL_VERSION, "error": error, **extra}
    return JSONResponse(status_code=status_code, content=body)


async def get_current_wallet(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> str:
    if not credentials:
        raise HTTPException(
            status_code=401,
            detail=json.dumps({
                "protocol_version": PROTOCOL_VERSION,
                "error": "AUTH_REQUIRED",
                "message": "Bearer token required.",
            }),
        )
    try:
        return auth.get_wallet_from_token(credentials.credentials)
    except ValueError as e:
        raise HTTPException(
            status_code=401,
            detail=json.dumps({
                "protocol_version": PROTOCOL_VERSION,
                "error": "AUTH_FAILED",
                "message": str(e),
            }),
        )


def _check_registered(wallet: str):
    agent = (
        _market.supabase.table("agents")
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
                "url": f"{PUBLIC_URL}/market/register",
                "required": ["wallet"],
            },
        }))


# ========== GET /market — 协议文档 ==========

@router.get("/market")
async def get_protocol():
    return _md("protocol.md")


# ========== Markdown docs ==========

def _md(filename: str) -> PlainTextResponse:
    path = Path(__file__).resolve().parent.parent / filename
    with open(path) as f:
        return PlainTextResponse(f.read(), media_type="text/markdown")

@router.get("/market/wallet-setup.md")
async def get_wallet_setup():
    return _md("wallet-setup.md")

@router.get("/market/buyer-setup.md")
async def get_buyer_setup():
    return _md("buyer-setup.md")

@router.get("/market/buyer-manual.md")
async def get_buyer_manual():
    return _md("buyer-manual.md")

@router.get("/market/seller-setup.md")
async def get_seller_setup():
    return _md("seller-setup.md")

@router.get("/market/seller-manual.md")
async def get_seller_manual():
    return _md("seller-manual.md")

# Legacy redirects
@router.get("/market/buyer-skill.md")
async def get_buyer_skill():
    return _md("buyer-setup.md")

@router.get("/market/seller-skill.md")
async def get_seller_skill():
    return _md("seller-setup.md")


# ========== POST /market/auth/wallet — Wallet API key 认证 ==========

@router.post("/market/auth/wallet")
async def auth_wallet(request: Request):
    body = await request.json()
    api_key = body.get("api_key", "")
    if not api_key:
        return _err(400, "MISSING_API_KEY", message="api_key required")
    try:
        result = await auth.authenticate_wallet_user(api_key, contract=_market.contract if _market else None)
        wallet = result["wallet"]

        return {
            "protocol_version": PROTOCOL_VERSION,
            "token": result["token"],
            "wallet": wallet,
            "registered": result.get("registered", False),
        }
    except ValueError as e:
        return _err(401, "AUTH_FAILED", message=str(e))


# ========== POST /market/auth/verify-token ==========

@router.post("/market/auth/verify-token")
async def verify_token(request: Request):
    body = await request.json()
    token = body.get("token", "")
    if not token:
        return _err(400, "MISSING_TOKEN", message="Token required")
    try:
        payload = auth.decode_token(token)
        return {"valid": True, "wallet": payload["wallet"], "registered": payload.get("token_id") is not None}
    except ValueError as e:
        return _err(401, "INVALID_TOKEN", message=str(e))


# ========== POST /market/auth/challenge ==========

@router.post("/market/auth/challenge")
async def auth_challenge():
    result = auth.create_challenge(_market.supabase)
    return {"protocol_version": PROTOCOL_VERSION, **result}


# ========== POST /market/auth/verify ==========

@router.post("/market/auth/verify")
async def auth_verify(req: AuthVerifyRequest):
    try:
        token = auth.verify_challenge(
            supabase=_market.supabase,
            contract=_market.contract,
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


# ========== POST /market/register ==========

@router.post("/market/register")
async def register(req: RegisterRequest):
    try:
        result = await _market.register_agent(
            wallet=req.wallet,
            description=req.description,
            telegram_group_id=req.telegram_group_id,
        )
        return {
            "protocol_version": PROTOCOL_VERSION,
            "status": "registered",
            "wallet": result["wallet"],
        }
    except PermissionError:
        return _err(403, "NOT_REGISTERED_ONCHAIN",
                     message="Wallet not registered on-chain (no PactumAgent NFT)")
    except FileExistsError:
        return JSONResponse(
            status_code=409,
            content={"protocol_version": PROTOCOL_VERSION, "status": "already_registered"},
        )
    except ValueError as e:
        return _err(400, "INVALID_REQUEST", message=str(e))


# ========== POST /market/register/seller — 人类前端卖家注册 ==========

@router.post("/market/register/seller")
async def register_seller(req: RegisterSellerRequest, request: Request,
                          credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if not credentials:
        return _err(401, "AUTH_REQUIRED", message="Bearer token required.")
    try:
        jwt_payload = auth.decode_token(credentials.credentials)
    except ValueError as e:
        return _err(401, "AUTH_FAILED", message=str(e))

    wallet = jwt_payload["wallet"]
    api_key = jwt_payload.get("api_key")  # 从 JWT 里取 api_key，用于 mint NFT

    try:
        result = await _market.register_seller(
            wallet=wallet,
            endpoint=req.endpoint,
            description=req.description,
            email=req.email,
            api_key=api_key,
        )

        # 注册成功后重新签发含 token_id 的 JWT
        token_id = auth._get_token_id(_market.contract, wallet)
        new_token = auth._build_token(wallet, token_id=token_id, api_key=api_key)

        return {
            "protocol_version": PROTOCOL_VERSION,
            "status": "registered",
            "wallet": result["wallet"],
            "endpoint": result.get("endpoint"),
            "token": new_token,
        }
    except ValueError as e:
        return _err(400, "INVALID_REQUEST", message=str(e))
    except Exception as e:
        return _err(500, "INTERNAL_ERROR", message=str(e))


# ========== GET /market/events — 拉取未读事件 ==========

@router.get("/market/events")
async def get_events(wallet: str = Depends(get_current_wallet)):
    events = await _market.get_events(wallet)
    return {"events": events, "count": len(events)}


# ========== GET /market/agents — 公开卖家列表 ==========

@router.get("/market/agents")
async def list_agents():
    agents = await _market.list_agents()
    return {"agents": agents, "count": len(agents)}


# ========== GET /market/items — 搜索商品 ==========

@router.get("/market/items")
async def search_items(q: str = "", max_price: Optional[float] = None):
    items = await _market.search_items(query=q, max_price=max_price)
    return {"items": items, "count": len(items)}


# ========== GET /market/items/{item_id} — 商品详情 ==========

@router.get("/market/items/{item_id}")
async def get_item(item_id: str):
    result = (
        _market.supabase.table("items")
        .select("*, agents!inner(wallet, description, avg_rating, total_reviews)")
        .eq("item_id", item_id)
        .execute()
    )
    if not result.data:
        return _err(404, "NOT_FOUND", message=f"Item {item_id} not found")
    return result.data[0]


# ========== POST /market/items — 上架商品 ==========

@router.post("/market/items")
async def list_item(req: ListItemRequest, wallet: str = Depends(get_current_wallet)):
    _check_registered(wallet)
    try:
        item = await _market.list_item(
            wallet=wallet,
            name=req.name,
            description=req.description,
            price=req.price,
            item_type=req.type,
            endpoint=req.endpoint,
            requires_shipping=req.requires_shipping,
        )
        return item
    except (PermissionError, ValueError) as e:
        return _err(400, "INVALID_REQUEST", message=str(e))


# ========== PATCH /market/items/{item_id} — 更新商品 ==========

@router.patch("/market/items/{item_id}")
async def update_item(item_id: str, request: Request, wallet: str = Depends(get_current_wallet)):
    _check_registered(wallet)
    body = await request.json()
    try:
        item = await _market.update_item(
            item_id=item_id,
            wallet=wallet,
            name=body.get("name"),
            description=body.get("description"),
            price=float(body["price"]) if "price" in body else None,
            status=body.get("status"),
            endpoint=body.get("endpoint"),
            requires_shipping=body.get("requires_shipping"),
        )
        return item
    except FileNotFoundError as e:
        return _err(404, "NOT_FOUND", message=str(e))
    except PermissionError as e:
        return _err(403, "FORBIDDEN", message=str(e))
    except ValueError as e:
        return _err(400, "INVALID_REQUEST", message=str(e))


# ========== PUT /market/address — 保存/更新买家默认地址 ==========

@router.put("/market/address")
async def update_address(req: UpdateAddressRequest, wallet: str = Depends(get_current_wallet)):
    _check_registered(wallet)
    try:
        address = await _market.update_shipping_address(wallet, req.address.model_dump())
        return {"address": address}
    except ValueError as e:
        return _err(400, "INVALID_ADDRESS", message=str(e))


# ========== GET /market/address — 获取自己的地址 ==========

@router.get("/market/address")
async def get_address(wallet: str = Depends(get_current_wallet)):
    address = await _market.get_shipping_address(wallet)
    return {"address": address}


# ========== POST /market/buy/{item_id} — 下单（402 flow） ==========

@router.post("/market/buy/{item_id}")
async def buy(item_id: str, req: BuyRequest, request: Request, wallet: str = Depends(get_current_wallet)):
    _check_registered(wallet)

    payment_proof = request.headers.get("X-Payment-Proof")

    if not payment_proof:
        try:
            result = await _market.create_order(
                item_id=item_id,
                buyer_wallet=wallet,
                shipping_address=req.shipping_address,
                buyer_query=req.query,
            )
            amount_decimal = float(result["payment"]["amount"])
            amount_units = int(amount_decimal * 1_000_000)
            expires = (datetime.now(timezone.utc) + timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")

            # 通过 WS 通知卖家
            if _manager:
                order = result["order"]
                from ws import protocol as P
                await _manager.send_to(order["seller_wallet"], {
                    "type": P.ORDER_NEW,
                    "order_id": order["order_id"],
                    "item_id": order["item_id"],
                    "buyer_wallet": order["buyer_wallet"],
                    "amount": str(order["amount"]),
                    "buyer_query": order.get("buyer_query"),
                })

            # Telegram 通知双方
            order = result["order"]
            item_row = (
                _market.supabase.table("items")
                .select("name")
                .eq("item_id", order["item_id"])
                .execute()
            )
            item_name = item_row.data[0]["name"] if item_row.data else "?"
            tg_data = {
                "order_id": order["order_id"],
                "amount": str(order["amount"]),
                "buyer_wallet": order["buyer_wallet"],
                "item_name": item_name,
                "buyer_query": order.get("buyer_query"),
            }
            await _tg_notify(order["seller_wallet"], "order_new", {**tg_data, "role": "seller"})
            await _tg_notify(order["buyer_wallet"], "order_new", {**tg_data, "role": "buyer"})

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
                    "escrow": result["payment"]["escrow"],
                },
            )
        except FileNotFoundError as e:
            return _err(404, "NOT_FOUND", message=str(e))
        except ValueError as e:
            msg = str(e)
            if "shipping address required" in msg.lower() or "shipping_address" in msg.lower():
                return _err(400, "SHIPPING_REQUIRED",
                             message=msg,
                             required_fields=["name", "street", "city", "state", "postal_code", "country"],
                             set_address_url=f"{PUBLIC_URL}/market/address")
            return _err(400, "INVALID_REQUEST", message=msg)
    else:
        order_id = request.headers.get("X-Order-Id")
        if not order_id:
            return _err(400, "MISSING_FIELDS", missing=["X-Order-Id header"])
        try:
            result = await _market.confirm_payment(
                order_id=order_id,
                tx_hash=payment_proof,
            )

            # 通过 WS 通知卖家付款确认
            if _manager:
                order_data = (
                    _market.supabase.table("orders")
                    .select("*")
                    .eq("order_id", order_id)
                    .execute()
                )
                if order_data.data:
                    from ws import protocol as P
                    o = order_data.data[0]
                    await _manager.send_to(o["seller_wallet"], {
                        "type": P.PAYMENT_CONFIRMED,
                        "order_id": o["order_id"],
                        "buyer_wallet": o["buyer_wallet"],
                        "tx_hash": payment_proof,
                        "amount": str(o["amount"]),
                    })

            # Telegram 通知双方
            order_data2 = (
                _market.supabase.table("orders")
                .select("*")
                .eq("order_id", order_id)
                .execute()
            )
            if order_data2.data:
                o2 = order_data2.data[0]
                tg_pay = {
                    "order_id": o2["order_id"],
                    "amount": str(o2["amount"]),
                    "buyer_wallet": o2["buyer_wallet"],
                    "tx_hash": payment_proof,
                }
                await _tg_notify(o2["seller_wallet"], "payment_confirmed", {**tg_pay, "role": "seller"})
                await _tg_notify(o2["buyer_wallet"], "payment_confirmed", {**tg_pay, "role": "buyer"})

            # 如果超时降级为 processing，额外通知买家
            if result.get("status") == "processing" and order_data2.data:
                o2 = order_data2.data[0]
                await _tg_notify(o2["buyer_wallet"], "processing", {
                    "order_id": o2["order_id"], "role": "buyer",
                })

            return {**result, "protocol_version": PROTOCOL_VERSION}
        except FileNotFoundError as e:
            return _err(404, "NOT_FOUND", message=str(e))
        except ValueError as e:
            return _err(400, "INVALID_REQUEST", message=str(e))


# ========== GET /market/orders — 我的订单 ==========

@router.get("/market/orders")
async def my_orders(wallet: str = Depends(get_current_wallet)):
    orders = await _market.get_wallet_orders(wallet)
    return {"orders": orders, "count": len(orders)}


# ========== GET /market/orders/{order_id} — 订单详情 ==========

@router.get("/market/orders/{order_id}")
async def get_order(order_id: str, wallet: str = Depends(get_current_wallet)):
    try:
        order = await _market.get_order(order_id, wallet)
        if not order:
            return _err(404, "NOT_FOUND", message=f"Order {order_id} not found")
        return order
    except PermissionError as e:
        return _err(403, "FORBIDDEN", message=str(e))


# ========== GET /market/orders/{order_id}/messages — 订单消息历史 ==========

@router.get("/market/orders/{order_id}/messages")
async def get_order_messages(order_id: str, wallet: str = Depends(get_current_wallet)):
    try:
        messages = await _market.get_order_messages(order_id, wallet)
        return {"messages": messages, "count": len(messages)}
    except FileNotFoundError as e:
        return _err(404, "NOT_FOUND", message=str(e))
    except PermissionError as e:
        return _err(403, "FORBIDDEN", message=str(e))


# ========== POST /market/orders/{order_id}/messages — 发消息 ==========

@router.post("/market/orders/{order_id}/messages")
async def send_message(order_id: str, request: Request, wallet: str = Depends(get_current_wallet)):
    body = await request.json()
    content = body.get("content", "").strip()
    if not content:
        return _err(400, "MISSING_FIELDS", missing=["content"])

    try:
        order = await _market.get_order(order_id, wallet)
        if not order:
            return _err(404, "NOT_FOUND", message=f"Order {order_id} not found")

        if wallet == order["buyer_wallet"]:
            to_wallet  = order["seller_wallet"]
            direction  = "buyer_to_seller"
        else:
            to_wallet  = order["buyer_wallet"]
            direction  = "seller_to_buyer"

        result = await _market.relay_message(
            from_wallet=wallet,
            to_wallet=to_wallet,
            order_id=order_id,
            content=content,
            direction=direction,
        )

        # WS push（如果对方在线）
        if _manager:
            from ws import protocol as P
            await _manager.send_to(to_wallet, {
                "type": P.MESSAGE_RECEIVED,
                "order_id": order_id,
                "from_wallet": wallet,
                "content": content,
            })

        # Telegram 通知
        from tg.notify import send_notification as _tg
        await _tg(to_wallet, "message_received", {
            "order_id": order_id,
            "from_wallet": wallet,
            "content": content,
        })

        return {"message_id": result["message_id"], "to_wallet": to_wallet}

    except PermissionError as e:
        return _err(403, "FORBIDDEN", message=str(e))
    except FileNotFoundError as e:
        return _err(404, "NOT_FOUND", message=str(e))


# ========== POST /market/orders/{order_id}/deliver — 交付订单 ==========

@router.post("/market/orders/{order_id}/deliver")
async def deliver_order(order_id: str, request: Request, wallet: str = Depends(get_current_wallet)):
    body = await request.json()
    content  = body.get("content")
    tracking = body.get("tracking")
    file_url = body.get("file_url")

    if not content and not tracking and not file_url:
        return _err(400, "MISSING_FIELDS", missing=["content, tracking, or file_url"])

    try:
        result = await _market.deliver_order(
            order_id=order_id,
            wallet=wallet,
            content=content,
            tracking=tracking,
            file_url=file_url,
        )

        # WS push（如果买家在线）
        if _manager:
            from ws import protocol as P
            await _manager.send_to(result["buyer_wallet"], {
                "type": P.DELIVERY,
                "order_id": result["order_id"],
                "seller_wallet": result["seller_wallet"],
                "content": content,
                "tracking": tracking,
                "file_url": file_url,
            })

        # Telegram 通知双方
        from tg.notify import send_notification as _tg
        tg_data = {"order_id": result["order_id"], "item_name": result.get("item_name"), "content": content, "tracking": tracking, "file_url": file_url}
        await _tg(result["buyer_wallet"],  "delivery", {**tg_data, "role": "buyer"})
        await _tg(result["seller_wallet"], "delivery", {**tg_data, "role": "seller"})

        return result

    except PermissionError as e:
        return _err(403, "FORBIDDEN", message=str(e))
    except FileNotFoundError as e:
        return _err(404, "NOT_FOUND", message=str(e))
    except ValueError as e:
        return _err(400, "INVALID_REQUEST", message=str(e))


# ========== GET /market/activity — 公开活动 feed ==========

@router.get("/market/activity")
async def get_activity(limit: int = Query(default=10, ge=1, le=50)):
    result = (
        _market.supabase.table("orders")
        .select("order_id, buyer_wallet, seller_wallet, amount, status, created_at, updated_at, items!inner(name, type)")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    events = []
    for row in (result.data or []):
        bw = row.get("buyer_wallet", "")
        sw = row.get("seller_wallet", "")
        events.append({
            "order_id": row["order_id"][:8],
            "buyer": f"{bw[:6]}...{bw[-4:]}" if len(bw) > 10 else bw,
            "seller": f"{sw[:6]}...{sw[-4:]}" if len(sw) > 10 else sw,
            "item_name": row.get("items", {}).get("name", "?"),
            "item_type": row.get("items", {}).get("type", "digital"),
            "amount": str(row["amount"]),
            "status": row["status"],
            "created_at": row["created_at"],
            "updated_at": row.get("updated_at"),
        })
    return {"events": events, "count": len(events)}


# ========== Health + Stats ==========

@router.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "pactum-gateway",
        "protocol_version": PROTOCOL_VERSION,
        "ws_connections": len(_manager.active) if _manager else 0,
    }


@router.get("/market/stats")
async def stats():
    result = await _market.get_stats()
    return {**result, "protocol_version": PROTOCOL_VERSION}


# ========== POST /market/upload — 文件上传 ==========

@router.post("/market/upload")
async def upload_file(file: UploadFile = File(...), wallet: str = Depends(get_current_wallet)):
    _check_registered(wallet)
    from market.storage import upload_file as _upload, MAX_SIZE, ALLOWED_MIMES

    content_type = file.content_type or "application/octet-stream"
    if content_type not in ALLOWED_MIMES:
        return _err(400, "UNSUPPORTED_FILE_TYPE", message=f"Unsupported: {content_type}")

    content = await file.read()
    if len(content) > MAX_SIZE:
        return _err(400, "FILE_TOO_LARGE", message=f"Max size: {MAX_SIZE // (1024*1024)}MB")

    try:
        result = await _upload(_market.supabase, wallet, file.filename or "file", content, content_type)
        return {"file": result}
    except ValueError as e:
        return _err(400, "UPLOAD_FAILED", message=str(e))


# ========== POST /market/orders/{order_id}/deliver-file — 文件交付 ==========

@router.post("/market/orders/{order_id}/deliver-file")
async def deliver_file(
    order_id: str,
    file: UploadFile = File(...),
    content: Optional[str] = Form(None),
    wallet: str = Depends(get_current_wallet),
):
    from market.storage import upload_file as _upload, make_download_token

    file_content = await file.read()
    content_type = file.content_type or "application/octet-stream"

    try:
        uploaded = await _upload(
            _market.supabase, wallet, file.filename or "file",
            file_content, content_type, subfolder="deliveries",
            order_id=order_id,
        )
    except ValueError as e:
        return _err(400, "UPLOAD_FAILED", message=str(e))

    # 生成永久下载页 URL
    dl_token = make_download_token(order_id)
    download_url = f"{PUBLIC_URL}/market/orders/{order_id}/download?token={dl_token}"

    try:
        result = await _market.deliver_order(
            order_id=order_id,
            wallet=wallet,
            content=content,
            file_url=download_url,
            file_path=uploaded["path"],
            file_size=uploaded["size"],
        )

        # WS push
        if _manager:
            from ws import protocol as P
            await _manager.send_to(result["buyer_wallet"], {
                "type": P.DELIVERY,
                "order_id": result["order_id"],
                "seller_wallet": result["seller_wallet"],
                "content": content,
                "file_url": download_url,
            })

        # Telegram 通知
        tg_data = {
            "order_id": result["order_id"],
            "item_name": result.get("item_name"),
            "content": content,
            "file_url": download_url,
            "role": "buyer",
        }
        await _tg_notify(result["buyer_wallet"], "delivery", tg_data)
        await _tg_notify(result["seller_wallet"], "delivery", {**tg_data, "role": "seller"})

        return {**result, "file": uploaded, "download_url": download_url}

    except PermissionError as e:
        return _err(403, "FORBIDDEN", message=str(e))
    except FileNotFoundError as e:
        return _err(404, "NOT_FOUND", message=str(e))
    except ValueError as e:
        return _err(400, "INVALID_REQUEST", message=str(e))


# ========== GET /market/orders/{order_id}/download — 公开下载页 ==========

_DOWNLOAD_PAGE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Download — Pactum</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0a; color: #e0e0e0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
  .card { background: #1a1a2e; border: 1px solid #333; border-radius: 16px; padding: 32px; max-width: 480px; width: 90%%; text-align: center; }
  .logo { font-size: 28px; font-weight: 700; color: #7c3aed; margin-bottom: 4px; }
  .subtitle { color: #888; font-size: 13px; margin-bottom: 24px; }
  .info { text-align: left; margin-bottom: 24px; }
  .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #222; font-size: 14px; }
  .info-label { color: #888; }
  .info-value { color: #e0e0e0; font-family: monospace; }
  .btn { display: inline-block; background: #7c3aed; color: white; border: none; padding: 12px 32px; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 16px; text-decoration: none; }
  .btn:hover { background: #6d28d9; }
  .note { color: #666; font-size: 12px; margin-top: 16px; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">Pactum</div>
  <div class="subtitle">Order Delivery</div>
  <div class="info">
    <div class="info-row"><span class="info-label">Order</span><span class="info-value">%(order_short)s</span></div>
    <div class="info-row"><span class="info-label">Item</span><span class="info-value">%(item_name)s</span></div>
    <div class="info-row"><span class="info-label">File</span><span class="info-value">%(filename)s</span></div>
    <div class="info-row"><span class="info-label">Size</span><span class="info-value">%(filesize)s</span></div>
  </div>
  %(message_html)s
  <a class="btn" href="%(file_url)s">Download</a>
  <p class="note">Download link expires in 1 hour. Revisit this page to get a new link.</p>
</div>
</body>
</html>"""


@router.get("/market/orders/{order_id}/download")
async def download_page(order_id: str, token: str = Query(...)):
    from market.storage import verify_download_token, get_signed_url

    if not verify_download_token(order_id, token):
        return _err(403, "INVALID_TOKEN", message="Invalid download link")

    # 查订单（不做权限检查，token 就是凭证）
    order_result = (
        _market.supabase.table("orders")
        .select("*, items(name)")
        .eq("order_id", order_id)
        .execute()
    )
    if not order_result.data:
        return _err(404, "NOT_FOUND", message="Order not found")

    order = order_result.data[0]
    result = order.get("result")
    if not result or not isinstance(result, dict):
        return _err(404, "NO_FILE", message="No file attached to this order")

    file_path = result.get("file_path")
    if not file_path:
        return _err(404, "NO_FILE", message="No file attached to this order")

    # 每次访问生成新签名 URL
    file_url = get_signed_url(_market.supabase, file_path)
    if not file_url:
        return _err(500, "SIGNED_URL_FAILED", message="Could not generate download URL")

    # 从 path 提取文件名
    filename = file_path.rsplit("/", 1)[-1] if "/" in file_path else file_path
    item_name = order.get("items", {}).get("name", "—") if isinstance(order.get("items"), dict) else "—"
    content_msg = result.get("content", "")
    message_html = f'<p style="color:#aaa;font-size:14px;margin-bottom:20px;">{content_msg}</p>' if content_msg else ""

    html = _DOWNLOAD_PAGE % {
        "order_short": order_id[:8] + "...",
        "item_name": item_name,
        "filename": filename,
        "filesize": _fmt_size(result.get("size", 0) if isinstance(result, dict) else 0),
        "message_html": message_html,
        "file_url": file_url,
    }
    return HTMLResponse(html)


def _fmt_size(size: int) -> str:
    if not size:
        return "—"
    if size < 1024:
        return f"{size} B"
    if size < 1024 * 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size / (1024 * 1024):.1f} MB"


# ========== GET /market/orders/{order_id}/file — API 文件下载 (JWT) ==========

@router.get("/market/orders/{order_id}/file")
async def get_order_file(order_id: str, wallet: str = Depends(get_current_wallet)):
    try:
        order = await _market.get_order(order_id, wallet)
        if not order:
            return _err(404, "NOT_FOUND", message="Order not found")

        result = order.get("result")
        if not result or not isinstance(result, dict):
            return _err(404, "NO_FILE", message="No file attached to this order")

        file_path = result.get("file_path")
        if not file_path:
            return _err(404, "NO_FILE", message="No file attached to this order")

        from market.storage import get_signed_url
        url = get_signed_url(_market.supabase, file_path)
        if not url:
            return _err(500, "SIGNED_URL_FAILED", message="Could not generate download URL")
        return RedirectResponse(url=url, status_code=302)

    except PermissionError as e:
        return _err(403, "FORBIDDEN", message=str(e))


# ========== GET /market/my-items — 我的商品 ==========

@router.get("/market/my-items")
async def get_my_items(wallet: str = Depends(get_current_wallet)):
    items = await _market.get_my_items(wallet)
    return {"items": items, "count": len(items)}
