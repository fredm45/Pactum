"""
注册 + 验证 业务逻辑
1. register(email) → 发验证码到邮箱
2. verify(email, code) → 创建 Privy 钱包 → 返回 API key + 钱包地址
"""
import secrets
import logging
from datetime import datetime, timezone, timedelta

import resend

from db.client import get_supabase
from auth.api_key import generate_api_key
from privy.client import create_wallet
from userop.builder import get_smart_account_address
from config import RESEND_API_KEY, FROM_EMAIL

logger = logging.getLogger("wallet.registration")

VERIFY_CODE_TTL_MINUTES = 5


async def register(email: str) -> dict:
    """
    发送验证码到邮箱。如果用户已存在，返回提示。
    """
    db = get_supabase()

    # 检查是否已注册
    existing = db.table("wallet_users").select("id").eq("email", email).execute()
    if existing.data:
        raise ValueError("Email already registered. Use your existing API key.")

    # 生成 6 位验证码
    code = f"{secrets.randbelow(1000000):06d}"
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=VERIFY_CODE_TTL_MINUTES)).isoformat()

    # 作废之前的验证码
    db.table("wallet_verification_codes").update({"used": True}).eq("email", email).eq("used", False).execute()

    # 存储新验证码
    db.table("wallet_verification_codes").insert({
        "email": email,
        "code": code,
        "expires_at": expires_at,
    }).execute()

    # 发送邮件
    if RESEND_API_KEY:
        resend.api_key = RESEND_API_KEY
        resend.Emails.send({
            "from": FROM_EMAIL,
            "to": [email],
            "subject": "Pactum Wallet — Verification Code",
            "html": f"""
                <h2>Your verification code</h2>
                <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px;">{code}</p>
                <p>This code expires in {VERIFY_CODE_TTL_MINUTES} minutes.</p>
                <p>If you didn't request this, please ignore this email.</p>
            """,
        })
        logger.info(f"Verification code sent to {email}")
    else:
        # dev 模式：直接打印
        logger.warning(f"[DEV] Verification code for {email}: {code}")

    return {"message": "Verification code sent", "email": email}


async def verify(email: str, code: str) -> dict:
    """
    验证邮箱 → 创建 Privy 钱包 → 生成 API key → 返回凭证
    """
    db = get_supabase()

    # 查找有效验证码
    result = (
        db.table("wallet_verification_codes")
        .select("*")
        .eq("email", email)
        .eq("code", code)
        .eq("used", False)
        .execute()
    )

    if not result.data:
        raise ValueError("Invalid or expired verification code")

    record = result.data[0]

    # 检查过期
    expires_at = datetime.fromisoformat(record["expires_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) > expires_at:
        raise ValueError("Verification code expired")

    # 标记为已使用
    db.table("wallet_verification_codes").update({"used": True}).eq("id", record["id"]).execute()

    # 检查是否已注册（竞争条件保护）
    existing = db.table("wallet_users").select("id").eq("email", email).execute()
    if existing.data:
        raise ValueError("Email already registered")

    # 创建 Privy 钱包 (EOA)
    wallet = await create_wallet()

    # 计算 counterfactual smart account 地址
    smart_account = get_smart_account_address(wallet["address"])

    # 生成 API key
    plain_key, key_hash = generate_api_key()

    # 创建用户（wallet_address 存 smart account，EOA 地址存 wallet_address 字段保持兼容）
    db.table("wallet_users").insert({
        "email": email,
        "api_key_hash": key_hash,
        "privy_wallet_id": wallet["id"],
        "wallet_address": wallet["address"],  # EOA（Privy 钱包）
        "smart_account_address": smart_account,  # counterfactual smart account
    }).execute()

    logger.info(f"User registered: {email} → EOA={wallet['address']} SA={smart_account}")

    return {
        "api_key": plain_key,
        "wallet_address": smart_account,
        "email": email,
    }
