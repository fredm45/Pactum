"""
认证：Wallet API key → JWT (含 NFT token_id)
JWT payload: { wallet, token_id (可选), api_key (用于注册时 mint), iat, exp }
"""
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import jwt
from supabase import Client
from web3 import Web3

from config import JWT_SECRET, JWT_ALGORITHM, JWT_TTL_HOURS, CHALLENGE_TTL_MINUTES, WALLET_SERVICE_URL


def _build_token(wallet: str, token_id: int | None = None, api_key: str | None = None) -> str:
    """签发 JWT，可选包含 NFT token_id 和 api_key"""
    now = datetime.now(timezone.utc)
    payload = {
        "wallet": wallet.lower(),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=JWT_TTL_HOURS)).timestamp()),
    }
    if token_id is not None and token_id > 0:
        payload["token_id"] = token_id
    if api_key:
        payload["api_key"] = api_key
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def create_challenge(supabase: Client) -> dict:
    challenge = str(uuid.uuid4())
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=CHALLENGE_TTL_MINUTES)

    supabase.table("auth_challenges").insert({
        "challenge": challenge,
        "expires_at": expires_at.isoformat(),
        "used": False,
    }).execute()

    return {
        "challenge": challenge,
        "expires_at": expires_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def verify_challenge(
    supabase: Client,
    contract,
    wallet: str,
    challenge: str,
    timestamp: int,
    signature: str,
) -> str:
    """验证 EIP-712 签名，返回 JWT token"""
    result = (
        supabase.table("auth_challenges")
        .select("*")
        .eq("challenge", challenge)
        .execute()
    )
    if not result.data:
        raise ValueError("Challenge not found")

    ch = result.data[0]
    if ch["used"]:
        raise ValueError("Challenge already used")

    expires_at = datetime.fromisoformat(ch["expires_at"].replace("Z", "")).replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires_at:
        raise ValueError("Challenge expired")

    supabase.table("auth_challenges").update(
        {"used": True, "wallet": wallet.lower()}
    ).eq("challenge", challenge).execute()

    # 链上验证
    if contract:
        try:
            checksum = Web3.to_checksum_address(wallet)
            challenge_bytes = Web3.keccak(text=challenge)
            sig_bytes = bytes.fromhex(signature.replace("0x", ""))

            is_valid = contract.functions.verifyEIP712(
                checksum, challenge_bytes, timestamp, sig_bytes
            ).call()

            print(f"[AUTH] wallet={checksum} challenge_bytes={challenge_bytes.hex()} timestamp={timestamp} sig_len={len(sig_bytes)} is_valid={is_valid}")

            if not is_valid:
                raise ValueError("EIP-712 signature verification failed on-chain")
        except ValueError:
            raise
        except Exception as e:
            raise ValueError(f"On-chain verification error: {e}")
    else:
        print(f"[DEV] Skipping on-chain verification for {wallet}")

    # 查链上 NFT token_id
    token_id = _get_token_id(contract, wallet)
    return _build_token(wallet, token_id=token_id)


def decode_token(token: str) -> dict:
    """解码 JWT，返回完整 payload（含 wallet, token_id, api_key）"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise ValueError("Token expired")
    except jwt.InvalidTokenError as e:
        raise ValueError(f"Invalid token: {e}")


def get_wallet_from_token(token: str) -> str:
    """解码 JWT 返回 wallet 地址（向后兼容）"""
    return decode_token(token)["wallet"]


def _get_token_id(contract, wallet: str) -> int | None:
    """查链上 walletToToken，返回 token_id（0 表示未注册）"""
    if not contract:
        return None
    try:
        checksum = Web3.to_checksum_address(wallet)
        tid = contract.functions.walletToToken(checksum).call()
        return tid if tid > 0 else None
    except Exception:
        return None


async def authenticate_wallet_user(api_key: str, contract=None) -> dict:
    """
    用 Wallet Service API key 认证：
    1. 调 Wallet GET /v1/balance 验证 key
    2. 拿到 wallet_address
    3. 查链上 NFT token_id
    4. 签发 JWT（含 token_id + api_key）
    """
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{WALLET_SERVICE_URL}/v1/balance",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        if resp.status_code != 200:
            raise ValueError("Invalid Wallet API key")
        data = resp.json()

    wallet = data["wallet_address"].lower()

    # 查链上 NFT
    token_id = _get_token_id(contract, wallet)

    token = _build_token(wallet, token_id=token_id, api_key=api_key)
    return {
        "token": token,
        "wallet": wallet,
        "registered": token_id is not None and token_id > 0,
    }
