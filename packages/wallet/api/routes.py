"""
Pactum Wallet — REST API 端点
"""
import logging
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from auth.rate_limit import register_limiter, verify_limiter, get_client_ip
from api.models import (
    RegisterRequest, VerifyRequest,
    PayRequest, WithdrawRequest,
    EscrowDepositRequest,
    UpdateSettingsRequest,
    ContractCallRequest,
)
from api.deps import get_current_user
from services.registration import register, verify
from services.payment import pay, confirm_payment, cancel_payment, withdraw, escrow_deposit, contract_call
from services.settings import get_settings, update_settings
from services.events import get_events
from chain.usdc import get_balance
from auth.api_key import generate_api_key
from db.client import get_supabase

logger = logging.getLogger("wallet.api")
router = APIRouter(prefix="/v1")


# ===== Registration (no auth) =====

@router.post("/register")
async def register_endpoint(req: RegisterRequest, request: Request):
    register_limiter.check(get_client_ip(request))
    try:
        return await register(req.email)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/verify")
async def verify_endpoint(req: VerifyRequest, request: Request):
    verify_limiter.check(get_client_ip(request))
    try:
        return await verify(req.email, req.code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ===== Balance =====

@router.get("/balance")
async def balance_endpoint(user: dict = Depends(get_current_user)):
    sa = user.get("smart_account_address") or user["wallet_address"]
    balance = get_balance(sa)
    return {
        "wallet_address": sa,
        "balance": str(balance),
        "currency": "USDC",
        "network": "testnet",
    }


# ===== Payment =====

@router.post("/pay")
async def pay_endpoint(req: PayRequest, user: dict = Depends(get_current_user)):
    try:
        result = await pay(user, req.to, float(req.amount), req.memo)
        if result.get("status") == "pending_confirmation":
            return {"status": "pending_confirmation", "payment_id": result["payment_id"],
                    "message": f"Amount {req.amount} USDC exceeds confirmation threshold. Confirm or cancel within 10 minutes.",
                    "expires_at": result["expires_at"]}
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/pay/{payment_id}/confirm")
async def confirm_payment_endpoint(payment_id: str, user: dict = Depends(get_current_user)):
    try:
        return await confirm_payment(user, payment_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/pay/{payment_id}/cancel")
async def cancel_payment_endpoint(payment_id: str, user: dict = Depends(get_current_user)):
    try:
        return await cancel_payment(user, payment_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ===== Escrow Deposit =====

@router.post("/escrow-deposit")
async def escrow_deposit_endpoint(req: EscrowDepositRequest, user: dict = Depends(get_current_user)):
    try:
        result = await escrow_deposit(
            user=user,
            escrow_contract=req.escrow_contract,
            usdc_contract=req.usdc_contract,
            order_id_bytes32=req.order_id_bytes32,
            seller=req.seller,
            amount=float(req.amount),
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ===== Contract Call =====

@router.post("/contract-call")
async def contract_call_endpoint(req: ContractCallRequest, user: dict = Depends(get_current_user)):
    try:
        result = await contract_call(user, req.contract_address, req.calldata)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ===== Withdraw =====

@router.post("/withdraw")
async def withdraw_endpoint(req: WithdrawRequest, user: dict = Depends(get_current_user)):
    try:
        return await withdraw(user, req.to, float(req.amount), req.memo)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ===== Transactions =====

@router.get("/transactions")
async def transactions_endpoint(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: dict = Depends(get_current_user),
):
    db = get_supabase()
    result = (
        db.table("wallet_transactions")
        .select("*")
        .eq("user_id", user["id"])
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return {"transactions": result.data or []}


# ===== Events =====

@router.get("/events")
async def events_endpoint(
    since: str = Query(None, description="ISO timestamp to fetch events after"),
    limit: int = Query(50, ge=1, le=200),
    user: dict = Depends(get_current_user),
):
    return await get_events(user["id"], since, limit)


# ===== Settings =====

@router.get("/settings")
async def settings_get_endpoint(user: dict = Depends(get_current_user)):
    return get_settings(user)


@router.patch("/settings")
async def settings_update_endpoint(
    req: UpdateSettingsRequest,
    user: dict = Depends(get_current_user),
):
    try:
        return update_settings(user, req)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


# ===== API Key Regenerate =====

@router.post("/api-key/regenerate")
async def regenerate_api_key_endpoint(user: dict = Depends(get_current_user)):
    plain_key, key_hash = generate_api_key()
    db = get_supabase()
    db.table("wallet_users").update({"api_key_hash": key_hash}).eq("id", user["id"]).execute()
    return {"api_key": plain_key, "message": "New API key generated. Old key is now invalid."}
