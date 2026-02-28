"""
Privy Server Wallet API 客户端
- 创建钱包（Basic auth）
- 发送交易（需要 authorization signature）
- secp256k1_sign 签名（UserOp hash 签名用）
"""
import base64
import json
import logging

import httpx
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import hashes, serialization

from config import PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_AUTH_KEY, CHAIN_ID

logger = logging.getLogger("wallet.privy")

PRIVY_BASE = "https://api.privy.io/v1"


def _basic_auth() -> str:
    creds = base64.b64encode(f"{PRIVY_APP_ID}:{PRIVY_APP_SECRET}".encode()).decode()
    return f"Basic {creds}"


def _load_signing_key() -> ec.EllipticCurvePrivateKey | None:
    """从 base64 编码的 PEM 加载 P-256 私钥"""
    if not PRIVY_AUTH_KEY:
        return None
    pem_bytes = base64.b64decode(PRIVY_AUTH_KEY)
    # 支持直接 PEM 或 base64(PEM)
    if b"-----BEGIN" not in pem_bytes:
        # 尝试作为 DER
        return serialization.load_der_private_key(pem_bytes, password=None)
    return serialization.load_pem_private_key(pem_bytes, password=None)


_signing_key = None


def _get_signing_key() -> ec.EllipticCurvePrivateKey:
    global _signing_key
    if _signing_key is None:
        _signing_key = _load_signing_key()
        if _signing_key is None:
            raise RuntimeError("PRIVY_AUTH_KEY not configured")
    return _signing_key


def _make_auth_signature(method: str, url: str, body: dict | None = None) -> str:
    """
    生成 Privy authorization signature
    1. 构造 payload
    2. JSON 规范化
    3. ECDSA P-256 + SHA-256 签名
    4. base64 编码
    """
    payload = {
        "version": 1,
        "method": method,
        "url": url,
        "body": body,
        "headers": {"privy-app-id": PRIVY_APP_ID},
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))

    key = _get_signing_key()
    signature = key.sign(
        canonical.encode(),
        ec.ECDSA(hashes.SHA256()),
    )
    # 转为 DER 编码的签名再 base64
    return base64.b64encode(signature).decode()


def _common_headers() -> dict:
    return {
        "Authorization": _basic_auth(),
        "privy-app-id": PRIVY_APP_ID,
        "Content-Type": "application/json",
    }


async def create_wallet() -> dict:
    """
    创建新的 Privy 服务端钱包
    Returns: {"id": "wallet_id", "address": "0x..."}
    """
    url = f"{PRIVY_BASE}/wallets"
    body = {"chain_type": "ethereum"}

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            url,
            headers=_common_headers(),
            json=body,
        )
        resp.raise_for_status()
        data = resp.json()
        logger.info(f"Created Privy wallet: {data.get('address', 'unknown')}")
        return {"id": data["id"], "address": data["address"]}


async def send_transaction(wallet_id: str, to: str, data: str) -> str:
    """
    通过 Privy 发送链上交易（USDC transfer 等）
    Returns: tx_hash
    """
    url = f"{PRIVY_BASE}/wallets/{wallet_id}/rpc"
    body = {
        "method": "eth_sendTransaction",
        "caip2": "eip155:84532",
        "chain_type": "ethereum",
        "sponsor": True,
        "params": {
            "transaction": {
                "to": to,
                "value": "0x0",
                "data": data,
            }
        },
    }

    headers = _common_headers()
    headers["privy-authorization-signature"] = _make_auth_signature("POST", url, body)

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers=headers, json=body)
        if resp.status_code != 200:
            logger.error(f"Privy RPC error {resp.status_code}: {resp.text}")
            logger.error(f"Request body: {json.dumps(body)}")
            resp.raise_for_status()
        result = resp.json()
        tx_hash = result["data"]["hash"]
        logger.info(f"Sent tx via Privy: {tx_hash}")
        return tx_hash


async def sign_message(wallet_id: str, message: str) -> str:
    """
    签名 userOpHash — 使用 secp256k1_sign + 手动 EIP-191 包装。

    SimpleAccount v0.7 验签逻辑:
        hash = toEthSignedMessageHash(userOpHash)
        owner == ECDSA.recover(hash, signature)

    所以我们先做 EIP-191 包装，再用 secp256k1_sign 做 raw ECDSA 签名。
    注: 不用 personal_sign 是因为 Privy 的 personal_sign + encoding:hex 有 bug。

    message: "0x..." 格式的 hex 消息（如 userOpHash）
    Returns: 65 字节签名的 hex 字符串 "0x..."
    """
    from web3 import Web3 as _W3

    # 手动做 EIP-191 包装: keccak256("\x19Ethereum Signed Message:\n32" + hash_bytes)
    hash_bytes = bytes.fromhex(message.replace("0x", ""))
    prefix = b"\x19Ethereum Signed Message:\n" + str(len(hash_bytes)).encode()
    eth_signed_hash = _W3.keccak(prefix + hash_bytes)
    eth_signed_hash_hex = "0x" + eth_signed_hash.hex().replace("0x", "")

    url = f"{PRIVY_BASE}/wallets/{wallet_id}/rpc"
    body = {
        "method": "secp256k1_sign",
        "chain_type": "ethereum",
        "params": {
            "hash": eth_signed_hash_hex,
        },
    }

    headers = _common_headers()
    headers["privy-authorization-signature"] = _make_auth_signature("POST", url, body)

    logger.info(f"Signing with secp256k1_sign: wallet={wallet_id} original_hash={message[:20]}... eip191_hash={eth_signed_hash_hex[:20]}...")

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(url, headers=headers, json=body)
        if resp.status_code != 200:
            logger.error(f"Privy secp256k1_sign error {resp.status_code}: {resp.text}")
            resp.raise_for_status()
        result = resp.json()
        signature = result["data"]["signature"]
        logger.info(f"Signed via Privy wallet {wallet_id}")
        return signature
