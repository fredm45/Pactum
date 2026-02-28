"""
Pactum Marketplace Service - 中心化交易市场核心逻辑
"""
import hashlib
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional

import jwt
from supabase import create_client, Client
from web3 import Web3
import httpx

JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
JWT_TTL_HOURS = 24
CHALLENGE_TTL_MINUTES = 5


class MarketplaceService:
    def __init__(
        self,
        supabase_url: str,
        supabase_key: str,
        contract_address: str = None,
        rpc_url: str = None,
    ):
        self.supabase: Client = create_client(supabase_url, supabase_key)
        self.w3 = Web3(Web3.HTTPProvider(rpc_url)) if rpc_url else None
        self.contract_address = contract_address

        # PactumAgent 合约 ABI
        self.contract_abi = [
            {
                "inputs": [{"name": "wallet", "type": "address"}],
                "name": "isRegistered",
                "outputs": [{"name": "", "type": "bool"}],
                "stateMutability": "view",
                "type": "function",
            },
            {
                "inputs": [{"name": "tokenId", "type": "uint256"}],
                "name": "getAgentStats",
                "outputs": [
                    {"name": "avgRating", "type": "uint256"},
                    {"name": "reviewCount", "type": "uint256"},
                ],
                "stateMutability": "view",
                "type": "function",
            },
            {
                "inputs": [{"name": "", "type": "address"}],
                "name": "walletToToken",
                "outputs": [{"name": "", "type": "uint256"}],
                "stateMutability": "view",
                "type": "function",
            },
            {
                "inputs": [
                    {"name": "wallet", "type": "address"},
                    {"name": "challenge", "type": "bytes32"},
                    {"name": "timestamp", "type": "uint256"},
                    {"name": "signature", "type": "bytes"},
                ],
                "name": "verifyEIP712",
                "outputs": [{"name": "", "type": "bool"}],
                "stateMutability": "view",
                "type": "function",
            },
        ]

        if self.contract_address and self.w3:
            self.contract = self.w3.eth.contract(
                address=Web3.to_checksum_address(self.contract_address),
                abi=self.contract_abi,
            )
        else:
            self.contract = None

    # ========== Challenge-Response Auth ==========

    def create_challenge(self) -> dict:
        """Generate a random challenge, store in auth_challenges table."""
        challenge = str(uuid.uuid4())
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=CHALLENGE_TTL_MINUTES)

        self.supabase.table("auth_challenges").insert({
            "challenge": challenge,
            "expires_at": expires_at.isoformat(),
            "used": False,
        }).execute()

        return {
            "challenge": challenge,
            "expires_at": expires_at.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

    def verify_challenge(
        self, wallet: str, challenge: str, timestamp: int, signature: str
    ) -> str:
        """
        Verify EIP-712 signature via on-chain verifyEIP712().
        Returns JWT token on success.
        Raises ValueError on failure.
        """
        # Check challenge exists and not expired/used
        result = (
            self.supabase.table("auth_challenges")
            .select("*")
            .eq("challenge", challenge)
            .execute()
        )
        if not result.data:
            raise ValueError("Challenge not found")

        ch = result.data[0]
        if ch["used"]:
            raise ValueError("Challenge already used")

        expires_at = datetime.fromisoformat(ch["expires_at"].replace("Z", "+00:00"))
        if datetime.now(timezone.utc) > expires_at:
            raise ValueError("Challenge expired")

        # Mark challenge as used
        self.supabase.table("auth_challenges").update(
            {"used": True, "wallet": wallet.lower()}
        ).eq("challenge", challenge).execute()

        # On-chain EIP-712 verification
        if self.contract:
            try:
                checksum = Web3.to_checksum_address(wallet)
                # Convert challenge string to bytes32 (keccak256)
                challenge_bytes = Web3.keccak(text=challenge)
                sig_bytes = bytes.fromhex(signature.replace("0x", ""))

                is_valid = self.contract.functions.verifyEIP712(
                    checksum, challenge_bytes, timestamp, sig_bytes
                ).call()

                if not is_valid:
                    raise ValueError("EIP-712 signature verification failed on-chain")
            except ValueError:
                raise
            except Exception as e:
                raise ValueError(f"On-chain verification error: {e}")
        else:
            # No contract — dev mode, skip on-chain check
            print(f"[DEV] Skipping on-chain verification for {wallet}")

        # Issue JWT
        now = datetime.now(timezone.utc)
        payload = {
            "wallet": wallet.lower(),
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=JWT_TTL_HOURS)).timestamp()),
        }
        token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
        return token

    @staticmethod
    def decode_token(token: str) -> str:
        """Decode JWT, return wallet address. Raises ValueError on failure."""
        try:
            payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
            return payload["wallet"]
        except jwt.ExpiredSignatureError:
            raise ValueError("Token expired")
        except jwt.InvalidTokenError as e:
            raise ValueError(f"Invalid token: {e}")

    # ========== 注册（无签名）==========

    async def register_agent(
        self, wallet: str, description: str
    ) -> Dict[str, Any]:
        """
        注册 agent 身份
        - 服务端自己算 card_hash = sha256(description)
        - 链上 isRegistered(wallet) 必须 True
        - wallet 去重 → 409
        """
        card_hash = "0x" + hashlib.sha256(description.encode()).hexdigest()

        # 链上验证
        if self.contract:
            try:
                checksum = Web3.to_checksum_address(wallet)
                is_registered = self.contract.functions.isRegistered(
                    checksum
                ).call()
                if not is_registered:
                    raise PermissionError(
                        f"Wallet {wallet} not registered on-chain (no PactumAgent NFT)"
                    )
            except PermissionError:
                raise
            except Exception as e:
                print(f"On-chain verification failed: {e}")

        # 去重
        existing = (
            self.supabase.table("agents")
            .select("wallet")
            .eq("wallet", wallet.lower())
            .execute()
        )
        if existing.data:
            raise FileExistsError(f"Wallet {wallet} already registered")

        # 读取链上统计
        avg_rating = 0
        total_reviews = 0
        if self.contract:
            try:
                checksum = Web3.to_checksum_address(wallet)
                token_id = self.contract.functions.walletToToken(
                    checksum
                ).call()
                stats = self.contract.functions.getAgentStats(token_id).call()
                avg_rating = stats[0] / 100
                total_reviews = stats[1]
            except Exception as e:
                print(f"Failed to read on-chain stats: {e}")

        data = {
            "wallet": wallet.lower(),
            "description": description,
            "card_hash": card_hash,
            "avg_rating": avg_rating,
            "total_reviews": total_reviews,
        }

        result = self.supabase.table("agents").insert(data).execute()
        if not result.data:
            raise RuntimeError("Failed to insert agent")

        return result.data[0]

    # ========== 买（搜索）==========

    async def enter_buy(
        self, query: str = "", max_price: float = None
    ) -> List[Dict[str, Any]]:
        """搜索 items（name/description ILIKE，price 过滤）"""
        qb = (
            self.supabase.table("items")
            .select("*, agents!inner(wallet, description, avg_rating, total_reviews)")
            .eq("status", "active")
        )

        if query:
            qb = qb.or_(
                f"name.ilike.%{query}%,description.ilike.%{query}%"
            )

        if max_price is not None:
            qb = qb.lte("price", max_price)

        qb = qb.order("created_at", desc=True)
        result = qb.execute()
        return result.data if result.data else []

    # ========== 卖（上架）==========

    async def enter_sell(
        self,
        wallet: str,
        description: str,
        price: float,
        item_type: str,
        endpoint: str = None,
        name: str = None,
    ) -> Dict[str, Any]:
        """上架商品/服务"""
        agent = (
            self.supabase.table("agents")
            .select("wallet")
            .eq("wallet", wallet.lower())
            .execute()
        )
        if not agent.data:
            raise PermissionError(f"Wallet {wallet} not registered")

        if item_type not in ("digital", "physical"):
            raise ValueError("type must be 'digital' or 'physical'")

        if item_type == "digital" and not endpoint:
            raise ValueError("endpoint required for digital items")

        if price <= 0:
            raise ValueError("price must be > 0")

        item_name = name or description[:80]

        data = {
            "seller_wallet": wallet.lower(),
            "name": item_name,
            "description": description,
            "price": price,
            "type": item_type,
            "endpoint": endpoint,
            "status": "active",
        }

        result = self.supabase.table("items").insert(data).execute()
        if not result.data:
            raise RuntimeError("Failed to insert item")

        return result.data[0]

    # ========== 购买流程 ==========

    async def create_order(
        self,
        item_id: str,
        buyer_wallet: str,
        shipping_address: Dict = None,
        buyer_query: str = None,
    ) -> Dict[str, Any]:
        """创建订单（pending 状态）"""
        item_result = (
            self.supabase.table("items")
            .select("*")
            .eq("item_id", item_id)
            .eq("status", "active")
            .execute()
        )
        if not item_result.data:
            raise FileNotFoundError(f"Item {item_id} not found or not active")

        item = item_result.data[0]

        if item["type"] == "physical" and not shipping_address:
            raise ValueError("shipping_address required for physical items")

        data = {
            "item_id": item_id,
            "buyer_wallet": buyer_wallet.lower(),
            "seller_wallet": item["seller_wallet"],
            "amount": item["price"],
            "status": "pending",
            "buyer_query": buyer_query,
        }
        if shipping_address:
            data["shipping_address"] = shipping_address

        result = self.supabase.table("orders").insert(data).execute()
        if not result.data:
            raise RuntimeError("Failed to create order")

        order = result.data[0]

        return {
            "order": order,
            "payment": {
                "amount": str(item["price"]),
                "currency": "USDC",
                "network": "testnet",
                "recipient": item["seller_wallet"],
                "order_id": order["order_id"],
            },
        }

    async def confirm_payment(
        self, order_id: str, tx_hash: str
    ) -> Dict[str, Any]:
        """确认支付"""
        order_result = (
            self.supabase.table("orders")
            .select("*, items(*)")
            .eq("order_id", order_id)
            .execute()
        )
        if not order_result.data:
            raise FileNotFoundError(f"Order {order_id} not found")

        order = order_result.data[0]
        if order["status"] != "pending":
            raise ValueError(f"Order status is '{order['status']}', expected 'pending'")

        # 验证交易
        if self.w3:
            try:
                tx = self.w3.eth.get_transaction(tx_hash)
                receipt = self.w3.eth.get_transaction_receipt(tx_hash)
                if receipt["status"] != 1:
                    raise ValueError("Transaction failed on-chain")
            except Exception as e:
                raise ValueError(f"Transaction verification failed: {e}")

        # tx_hash 去重
        existing_tx = (
            self.supabase.table("orders")
            .select("order_id")
            .eq("tx_hash", tx_hash)
            .execute()
        )
        if existing_tx.data:
            raise ValueError(f"tx_hash {tx_hash} already used")

        # 更新为 paid
        self.supabase.table("orders").update(
            {"status": "paid", "tx_hash": tx_hash}
        ).eq("order_id", order_id).execute()

        item = order.get("items")

        # digital → 调 seller endpoint
        if item and item.get("type") == "digital" and item.get("endpoint"):
            self.supabase.table("orders").update(
                {"status": "delivering"}
            ).eq("order_id", order_id).execute()

            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(
                        item["endpoint"],
                        json={
                            "order_id": order_id,
                            "buyer_wallet": order["buyer_wallet"],
                            "buyer_query": order.get("buyer_query", ""),
                            "amount": str(order["amount"]),
                        },
                    )
                    resp.raise_for_status()
                    result_data = resp.json()

                self.supabase.table("orders").update(
                    {"status": "completed", "result": result_data}
                ).eq("order_id", order_id).execute()

                return {
                    "order_id": order_id,
                    "status": "completed",
                    "result": result_data,
                }

            except Exception as e:
                self.supabase.table("orders").update(
                    {"status": "failed", "result": {"error": str(e)}}
                ).eq("order_id", order_id).execute()

                return {
                    "order_id": order_id,
                    "status": "failed",
                    "error": str(e),
                }

        # physical → paid
        return {
            "order_id": order_id,
            "status": "paid",
            "message": "Payment confirmed. Awaiting seller fulfillment.",
        }

    # ========== 订单查询 ==========

    async def get_order(
        self, order_id: str, wallet: str
    ) -> Optional[Dict[str, Any]]:
        """buyer 或 seller 可查自己的订单"""
        result = (
            self.supabase.table("orders")
            .select("*, items(name, type, endpoint)")
            .eq("order_id", order_id)
            .execute()
        )
        if not result.data:
            return None

        order = result.data[0]
        wallet_lower = wallet.lower()
        if (
            order["buyer_wallet"] != wallet_lower
            and order["seller_wallet"] != wallet_lower
        ):
            raise PermissionError("Not authorized to view this order")

        return order

    # ========== 统计 ==========

    async def get_stats(self) -> Dict[str, int]:
        """市场统计"""
        agents = self.supabase.table("agents").select("wallet", count="exact").execute()
        items = (
            self.supabase.table("items")
            .select("item_id", count="exact")
            .eq("status", "active")
            .execute()
        )
        orders = self.supabase.table("orders").select("order_id", count="exact").execute()

        return {
            "sellers": agents.count or 0,
            "items": items.count or 0,
            "orders": orders.count or 0,
        }
