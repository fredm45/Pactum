"""
支付核心 — pay / confirm / cancel / withdraw / escrow_deposit
ERC-4337: 所有链上操作走 UserOp → CDP Paymaster sponsor → Privy personal_sign → Bundler submit
"""
import logging
from datetime import datetime, timezone, timedelta

from db.client import get_supabase
from chain.usdc import get_balance, build_transfer_calldata, build_approve_calldata, build_deposit_calldata, USDC_DECIMALS
from privy.client import sign_message
from userop.builder import (
    build_execute_calldata,
    build_execute_batch_calldata,
    build_user_operation,
    compute_user_op_hash,
)
from userop.bundler import BundlerClient
from config import USDC_CONTRACT_ADDRESS, ENTRYPOINT_ADDRESS, CHAIN_ID

logger = logging.getLogger("wallet.payment")

PENDING_PAYMENT_TTL_MINUTES = 10


def _get_sender(user: dict) -> str:
    """获取用户的 smart account 地址"""
    sa = user.get("smart_account_address")
    if not sa:
        raise ValueError("Smart account not configured. Re-register to get a smart account.")
    return sa



def _check_limits(user: dict, amount: float) -> None:
    """检查单笔限额和日限额"""
    per_tx = float(user.get("per_transaction_limit", 10))
    daily = float(user.get("daily_limit", 50))

    if amount > per_tx:
        raise ValueError(f"Amount {amount} exceeds per-transaction limit of {per_tx} USDC")

    # 查今天已花金额
    db = get_supabase()
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    result = (
        db.table("wallet_transactions")
        .select("amount")
        .eq("user_id", user["id"])
        .in_("type", ["payment", "withdrawal"])
        .gte("created_at", today_start)
        .execute()
    )
    today_total = sum(float(tx["amount"]) for tx in (result.data or []))
    if today_total + amount > daily:
        raise ValueError(f"Amount would exceed daily limit of {daily} USDC (spent today: {today_total})")


async def _submit_user_op(user: dict, call_data: str) -> tuple[str, str]:
    """
    通用 UserOp 提交流程：
    1. 构造 UserOp
    2. CDP Paymaster sponsor（填 gas + paymaster 字段）
    3. Privy personal_sign（签 userOpHash）
    4. Bundler submit + wait receipt
    Returns: (user_op_hash, tx_hash)
    """
    sender = _get_sender(user)
    is_deployed = bool(user.get("smart_account_deployed", False))
    owner = user["wallet_address"]  # EOA

    # 1. 构造 UserOp（dummy signature）
    op = build_user_operation(
        sender=sender,
        call_data=call_data,
        is_deployed=is_deployed,
        owner=owner,
    )

    # 2. CDP Paymaster sponsor
    bundler = BundlerClient()
    op = await bundler.sponsor_user_op(op)

    # 3. 计算 userOpHash → Privy personal_sign
    op_hash = compute_user_op_hash(op, ENTRYPOINT_ADDRESS, CHAIN_ID)
    # HexBytes.hex() returns "0x..." prefixed, ensure we don't double-prefix
    raw_hex = op_hash.hex().replace("0x", "")
    op_hash_hex = "0x" + raw_hex

    logger.info(f"UserOp hash: {op_hash_hex}")
    logger.info(f"Signing with Privy wallet: {user['privy_wallet_id']} (EOA: {owner})")

    signature = await sign_message(
        wallet_id=user["privy_wallet_id"],
        message=op_hash_hex,
    )
    op["signature"] = signature

    # Verify: ecrecover to confirm signer matches owner
    try:
        from eth_account.messages import encode_defunct
        from web3 import Web3 as _W3
        _msg = encode_defunct(bytes.fromhex(op_hash_hex.replace("0x", "")))
        _recovered = _W3().eth.account.recover_message(_msg, signature=signature)
        logger.info(f"Signature verification: signer={_recovered} owner={owner} match={_recovered.lower() == owner.lower()}")
    except Exception as e:
        logger.warning(f"Signature verification failed: {e}")

    # 4. Submit + wait
    user_op_hash = await bundler.send_user_op(op)
    receipt = await bundler.wait_for_receipt(user_op_hash)
    tx_hash = receipt.get("receipt", {}).get("transactionHash", user_op_hash)

    # 首次交易：smart account 被部署，更新状态
    if not is_deployed:
        db = get_supabase()
        db.table("wallet_users").update({"smart_account_deployed": True}).eq("id", user["id"]).execute()
        user["smart_account_deployed"] = True
        logger.info(f"Smart account deployed: {sender}")

    return user_op_hash, tx_hash


async def pay(user: dict, to_address: str, amount: float, memo: str | None = None) -> dict:
    """
    发起支付。大额（超过 require_confirmation_above）返回 pending 状态。
    """
    sender = _get_sender(user)

    # 检查限额
    _check_limits(user, amount)

    # 检查余额（EOA + smart account）
    balance = get_balance(_get_sender(user))
    if balance < amount:
        raise ValueError(f"Insufficient balance: {balance} USDC (need {amount})")

    threshold = float(user.get("require_confirmation_above", 5))

    # 大额需确认
    if amount > threshold:
        db = get_supabase()
        expires_at = (datetime.now(timezone.utc) + timedelta(minutes=PENDING_PAYMENT_TTL_MINUTES)).isoformat()
        result = db.table("wallet_pending_payments").insert({
            "user_id": user["id"],
            "to_address": to_address,
            "amount": amount,
            "memo": memo,
            "expires_at": expires_at,
        }).execute()
        payment_id = result.data[0]["id"]

        # 写事件
        db.table("wallet_events").insert({
            "user_id": user["id"],
            "type": "payment_requires_confirmation",
            "data": {"payment_id": payment_id, "to": to_address, "amount": amount, "memo": memo},
        }).execute()

        return {"status": "pending_confirmation", "payment_id": payment_id, "expires_at": expires_at}

    # 小额直接发送
    return await _execute_payment(user, to_address, amount, memo)


async def _execute_payment(user: dict, to_address: str, amount: float, memo: str | None = None) -> dict:
    """执行实际的链上转账 — 通过 UserOp"""
    sender = _get_sender(user)

    # 构造 inner calldata: USDC.transfer(to, amount)
    inner_calldata = build_transfer_calldata(to_address, amount)
    # 包装成 SimpleAccount.execute(USDC, 0, transfer_calldata)
    call_data = build_execute_calldata(USDC_CONTRACT_ADDRESS, 0, inner_calldata)

    user_op_hash, tx_hash = await _submit_user_op(user, call_data)

    db = get_supabase()

    # 记录交易
    db.table("wallet_transactions").insert({
        "user_id": user["id"],
        "type": "payment",
        "amount": amount,
        "from_address": sender,
        "to_address": to_address,
        "memo": memo,
        "tx_hash": tx_hash,
        "user_op_hash": user_op_hash,
    }).execute()

    # 写事件
    db.table("wallet_events").insert({
        "user_id": user["id"],
        "type": "payment_sent",
        "data": {"to": to_address, "amount": amount, "tx_hash": tx_hash, "user_op_hash": user_op_hash, "memo": memo},
    }).execute()

    logger.info(f"Payment: {sender} → {to_address} {amount} USDC op={user_op_hash}")

    return {
        "status": "completed",
        "tx_hash": tx_hash,
        "user_op_hash": user_op_hash,
        "from": sender,
        "to": to_address,
        "amount": str(amount),
    }


async def confirm_payment(user: dict, payment_id: str) -> dict:
    """确认大额支付"""
    db = get_supabase()
    result = (
        db.table("wallet_pending_payments")
        .select("*")
        .eq("id", payment_id)
        .eq("user_id", user["id"])
        .eq("status", "pending")
        .execute()
    )

    if not result.data:
        raise ValueError("Payment not found or already processed")

    payment = result.data[0]

    # 检查过期
    expires_at = datetime.fromisoformat(payment["expires_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) > expires_at:
        db.table("wallet_pending_payments").update({"status": "expired"}).eq("id", payment_id).execute()
        raise ValueError("Payment has expired")

    # 执行转账
    result = await _execute_payment(user, payment["to_address"], float(payment["amount"]), payment.get("memo"))

    # 更新 pending payment 状态
    db.table("wallet_pending_payments").update({"status": "confirmed"}).eq("id", payment_id).execute()

    return result


async def cancel_payment(user: dict, payment_id: str) -> dict:
    """取消待确认支付"""
    db = get_supabase()
    result = (
        db.table("wallet_pending_payments")
        .select("*")
        .eq("id", payment_id)
        .eq("user_id", user["id"])
        .eq("status", "pending")
        .execute()
    )

    if not result.data:
        raise ValueError("Payment not found or already processed")

    db.table("wallet_pending_payments").update({"status": "cancelled"}).eq("id", payment_id).execute()

    # 写事件
    db.table("wallet_events").insert({
        "user_id": user["id"],
        "type": "payment_cancelled",
        "data": {"payment_id": payment_id},
    }).execute()

    return {"status": "cancelled", "payment_id": payment_id}


async def withdraw(user: dict, to_address: str, amount: float, memo: str | None = None) -> dict:
    """提现到外部地址 — 通过 UserOp"""
    sender = _get_sender(user)

    _check_limits(user, amount)

    balance = get_balance(_get_sender(user))
    if balance < amount:
        raise ValueError(f"Insufficient balance: {balance} USDC (need {amount})")

    # 构造 inner calldata: USDC.transfer(to, amount)
    inner_calldata = build_transfer_calldata(to_address, amount)
    call_data = build_execute_calldata(USDC_CONTRACT_ADDRESS, 0, inner_calldata)

    user_op_hash, tx_hash = await _submit_user_op(user, call_data)

    db = get_supabase()
    db.table("wallet_transactions").insert({
        "user_id": user["id"],
        "type": "withdrawal",
        "amount": amount,
        "from_address": sender,
        "to_address": to_address,
        "memo": memo,
        "tx_hash": tx_hash,
        "user_op_hash": user_op_hash,
    }).execute()

    db.table("wallet_events").insert({
        "user_id": user["id"],
        "type": "withdrawal_sent",
        "data": {"to": to_address, "amount": amount, "tx_hash": tx_hash, "user_op_hash": user_op_hash, "memo": memo},
    }).execute()

    logger.info(f"Withdrawal: {sender} → {to_address} {amount} USDC op={user_op_hash}")

    return {
        "status": "completed",
        "tx_hash": tx_hash,
        "user_op_hash": user_op_hash,
        "from": sender,
        "to": to_address,
        "amount": str(amount),
    }


async def contract_call(user: dict, contract_address: str, calldata: str) -> dict:
    """
    通用合约调用 — 通过 UserOp 发送任意 calldata 到指定合约
    用于 Gateway 代铸 NFT 等场景
    """
    sender = _get_sender(user)

    # 包装成 SimpleAccount.execute(contract, 0, calldata)
    call_data = build_execute_calldata(contract_address, 0, calldata)

    user_op_hash, tx_hash = await _submit_user_op(user, call_data)

    db = get_supabase()
    db.table("wallet_transactions").insert({
        "user_id": user["id"],
        "type": "contract_call",
        "amount": 0,
        "from_address": sender,
        "to_address": contract_address,
        "memo": f"contract_call:{calldata[:20]}...",
        "tx_hash": tx_hash,
        "user_op_hash": user_op_hash,
    }).execute()

    db.table("wallet_events").insert({
        "user_id": user["id"],
        "type": "contract_call",
        "data": {
            "contract_address": contract_address,
            "tx_hash": tx_hash,
            "user_op_hash": user_op_hash,
        },
    }).execute()

    logger.info(f"Contract call: {sender} → {contract_address} op={user_op_hash}")

    return {
        "status": "completed",
        "tx_hash": tx_hash,
        "user_op_hash": user_op_hash,
        "from": sender,
        "contract_address": contract_address,
    }


async def escrow_deposit(
    user: dict,
    escrow_contract: str,
    usdc_contract: str,
    order_id_bytes32: str,
    seller: str,
    amount: float,
) -> dict:
    """
    Escrow 托管支付 — executeBatch(approve + deposit) 一个 UserOp
    """
    sender = _get_sender(user)

    # 检查余额（EOA + smart account）
    balance = get_balance(_get_sender(user))
    if balance < amount:
        raise ValueError(f"Insufficient balance: {balance} USDC (need {amount})")

    amount_units = int(amount * (10 ** USDC_DECIMALS))

    # 构造两笔 inner calldata
    approve_data = build_approve_calldata(escrow_contract, amount_units)
    deposit_data = build_deposit_calldata(order_id_bytes32, seller, amount_units)

    # executeBatch: approve USDC + deposit to escrow — 一个 UserOp
    call_data = build_execute_batch_calldata([
        {"to": usdc_contract, "value": 0, "data": approve_data},
        {"to": escrow_contract, "value": 0, "data": deposit_data},
    ])

    user_op_hash, tx_hash = await _submit_user_op(user, call_data)

    # 记录交易
    db = get_supabase()
    db.table("wallet_transactions").insert({
        "user_id": user["id"],
        "type": "escrow_deposit",
        "amount": amount,
        "from_address": sender,
        "to_address": escrow_contract,
        "memo": f"order:{order_id_bytes32} seller:{seller}",
        "tx_hash": tx_hash,
        "user_op_hash": user_op_hash,
    }).execute()

    # 写事件
    db.table("wallet_events").insert({
        "user_id": user["id"],
        "type": "escrow_deposit",
        "data": {
            "escrow_contract": escrow_contract,
            "order_id_bytes32": order_id_bytes32,
            "seller": seller,
            "amount": amount,
            "tx_hash": tx_hash,
            "user_op_hash": user_op_hash,
        },
    }).execute()

    logger.info(f"Escrow deposit: {sender} → {escrow_contract} {amount} USDC op={user_op_hash}")

    return {
        "status": "completed",
        "tx_hash": tx_hash,
        "user_op_hash": user_op_hash,
        "from": sender,
        "escrow_contract": escrow_contract,
        "order_id_bytes32": order_id_bytes32,
        "seller": seller,
        "amount": str(amount),
    }
