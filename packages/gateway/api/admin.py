"""
Admin API — 认证 + 全局数据查看
"""
import random
import time
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
import resend
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from config import (
    JWT_SECRET, JWT_ALGORITHM, RESEND_API_KEY, ADMIN_FROM_EMAIL,
    SUPABASE_URL, SUPABASE_KEY,
)

logger = logging.getLogger("pactum-admin")

admin_router = APIRouter(prefix="/admin", tags=["admin"])
security = HTTPBearer(auto_error=False)

# ========== Supabase client (lazy init) ==========

_supabase = None


def _sb():
    global _supabase
    if _supabase is None:
        from supabase import create_client
        _supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    return _supabase


# ========== Verification codes (in-memory, 5min TTL) ==========

_codes: dict[str, tuple[str, float]] = {}  # email -> (code, expires_ts)

ADMIN_JWT_TTL_HOURS = 24


# ========== Admin JWT ==========

def _create_admin_token(email: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "email": email,
        "admin": True,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=ADMIN_JWT_TTL_HOURS)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _verify_admin_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if not payload.get("admin"):
            raise ValueError("Not an admin token")
        return payload
    except jwt.ExpiredSignatureError:
        raise ValueError("Token expired")
    except jwt.InvalidTokenError as e:
        raise ValueError(f"Invalid token: {e}")


async def require_admin(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Admin token required")
    try:
        return _verify_admin_token(credentials.credentials)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))


# ========== Auth endpoints ==========

@admin_router.post("/auth/send-code")
async def send_code(request: Request):
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="email required")

    # Check admin exists
    result = _sb().table("admin_users").select("id").eq("email", email).execute()
    if not result.data:
        raise HTTPException(status_code=403, detail="Not an admin")

    code = f"{random.randint(0, 999999):06d}"
    _codes[email] = (code, time.time() + 300)  # 5 min

    if RESEND_API_KEY:
        resend.api_key = RESEND_API_KEY
        try:
            resend.Emails.send({
                "from": ADMIN_FROM_EMAIL,
                "to": [email],
                "subject": "Pactum Admin Login Code",
                "html": f"<p>Your login code: <strong>{code}</strong></p><p>Expires in 5 minutes.</p>",
            })
            logger.info(f"[admin] Code sent to {email}")
        except Exception as e:
            logger.warning(f"[admin] Resend failed ({e}) — code for {email}: {code}")
    else:
        logger.warning(f"[admin] RESEND_API_KEY not set — code for {email}: {code}")

    return {"ok": True, "message": "Code sent"}


@admin_router.post("/auth/login")
async def admin_login(request: Request):
    body = await request.json()
    email = (body.get("email") or "").strip().lower()
    code = (body.get("code") or "").strip()
    password = body.get("password") or ""

    if not email or not code or not password:
        raise HTTPException(status_code=400, detail="email, code, password required")

    # Verify code
    stored = _codes.get(email)
    if not stored:
        raise HTTPException(status_code=401, detail="No code sent or expired")
    stored_code, expires = stored
    if time.time() > expires:
        _codes.pop(email, None)
        raise HTTPException(status_code=401, detail="Code expired")
    if stored_code != code:
        raise HTTPException(status_code=401, detail="Invalid code")

    # Verify password
    result = _sb().table("admin_users").select("password_hash").eq("email", email).execute()
    if not result.data:
        raise HTTPException(status_code=403, detail="Not an admin")

    pw_hash = result.data[0]["password_hash"]
    if not bcrypt.checkpw(password.encode(), pw_hash.encode()):
        raise HTTPException(status_code=401, detail="Wrong password")

    # Success — remove code and issue token
    _codes.pop(email, None)
    token = _create_admin_token(email)
    return {"ok": True, "token": token, "email": email}


# ========== Data endpoints ==========

@admin_router.get("/overview")
async def overview(admin: dict = Depends(require_admin)):
    sb = _sb()

    agents = sb.table("agents").select("wallet", count="exact").execute()
    items = sb.table("items").select("item_id", count="exact").execute()
    orders = sb.table("orders").select("order_id, status, amount", count="exact").execute()

    # Status counts + total volume
    status_counts: dict[str, int] = {}
    total_volume = 0.0
    for o in (orders.data or []):
        s = o.get("status", "unknown")
        status_counts[s] = status_counts.get(s, 0) + 1
        if s in ("paid", "processing", "delivered", "completed"):
            total_volume += float(o.get("amount", 0))

    # Recent 5 orders
    recent = (
        sb.table("orders")
        .select("order_id, item_id, buyer_wallet, seller_wallet, amount, status, created_at, items(name)")
        .order("created_at", desc=True)
        .limit(5)
        .execute()
    )

    return {
        "agents": agents.count or 0,
        "items": items.count or 0,
        "orders": orders.count or 0,
        "total_volume": round(total_volume, 2),
        "status_counts": status_counts,
        "recent_orders": recent.data or [],
    }


@admin_router.get("/agents")
async def list_agents(admin: dict = Depends(require_admin)):
    result = (
        _sb().table("agents")
        .select("wallet, description, avg_rating, total_reviews, telegram_user_id, registered_at")
        .order("registered_at", desc=True)
        .execute()
    )
    return {"agents": result.data or [], "count": len(result.data or [])}


@admin_router.get("/items")
async def list_items(status: Optional[str] = None, admin: dict = Depends(require_admin)):
    qb = (
        _sb().table("items")
        .select("*, agents(wallet, description)")
        .order("created_at", desc=True)
    )
    if status:
        qb = qb.eq("status", status)
    result = qb.execute()
    return {"items": result.data or [], "count": len(result.data or [])}


@admin_router.get("/orders")
async def list_orders(status: Optional[str] = None, admin: dict = Depends(require_admin)):
    qb = (
        _sb().table("orders")
        .select("*, items(name)")
        .order("created_at", desc=True)
    )
    if status:
        qb = qb.eq("status", status)
    result = qb.execute()
    return {"orders": result.data or [], "count": len(result.data or [])}


@admin_router.get("/orders/{order_id}")
async def get_order_detail(order_id: str, admin: dict = Depends(require_admin)):
    sb = _sb()
    order_result = (
        sb.table("orders")
        .select("*, items(name, type, endpoint, price)")
        .eq("order_id", order_id)
        .execute()
    )
    if not order_result.data:
        raise HTTPException(status_code=404, detail="Order not found")

    messages_result = (
        sb.table("messages")
        .select("*")
        .eq("order_id", order_id)
        .order("created_at", desc=False)
        .execute()
    )

    return {
        "order": order_result.data[0],
        "messages": messages_result.data or [],
    }
