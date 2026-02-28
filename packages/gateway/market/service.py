"""
Pactum Marketplace Service — 核心业务逻辑
"""
import hashlib
import logging
from typing import List, Dict, Any, Optional

import httpx
from supabase import create_client, Client
from web3 import Web3

from config import (
    SUPABASE_URL, SUPABASE_KEY,
    PACTUM_AGENT_CONTRACT_ADDRESS, BASE_RPC_URL,
    ESCROW_CONTRACT_ADDRESS, USDC_CONTRACT_ADDRESS, PAYMASTER_URL,
    WALLET_SERVICE_URL,
)

logger = logging.getLogger("pactum.market")
from market.models import ShippingAddress
from market.address import validate_shipping_address


# PactumAgent 合约 ABI（最小集）
CONTRACT_ABI = [
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
    {
        "inputs": [
            {"name": "cardHash", "type": "bytes32"},
            {"name": "signer", "type": "address"},
        ],
        "name": "registerAgent",
        "outputs": [{"name": "", "type": "uint256"}],
        "stateMutability": "nonpayable",
        "type": "function",
    },
]


class MarketService:
    def __init__(self):
        self.supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        self.w3 = Web3(Web3.HTTPProvider(BASE_RPC_URL)) if BASE_RPC_URL else None

        if PACTUM_AGENT_CONTRACT_ADDRESS and self.w3:
            self.contract = self.w3.eth.contract(
                address=Web3.to_checksum_address(PACTUM_AGENT_CONTRACT_ADDRESS),
                abi=CONTRACT_ABI,
            )
        else:
            self.contract = None

    # ========== 注册 ==========

    async def register_agent(
        self, wallet: str, description: str = None, telegram_group_id: int = None
    ) -> Dict[str, Any]:
        card_hash = "0x" + hashlib.sha256((description or "").encode()).hexdigest()

        if self.contract:
            try:
                checksum = Web3.to_checksum_address(wallet)
                if not self.contract.functions.isRegistered(checksum).call():
                    raise PermissionError(
                        f"Wallet {wallet} not registered on-chain (no PactumAgent NFT)"
                    )
            except PermissionError:
                raise
            except Exception as e:
                raise PermissionError(f"On-chain verification failed: {e}")

        existing = (
            self.supabase.table("agents")
            .select("wallet")
            .eq("wallet", wallet.lower())
            .execute()
        )
        if existing.data:
            raise FileExistsError(f"Wallet {wallet} already registered")

        avg_rating = 0
        total_reviews = 0
        if self.contract:
            try:
                checksum = Web3.to_checksum_address(wallet)
                token_id = self.contract.functions.walletToToken(checksum).call()
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
        if telegram_group_id:
            data["telegram_group_id"] = telegram_group_id

        result = self.supabase.table("agents").insert(data).execute()
        if not result.data:
            raise RuntimeError("Failed to insert agent")

        return result.data[0]

    # ========== 人类卖家注册 ==========

    async def register_seller(
        self, wallet: str, endpoint: str = None, description: str = None, email: str = None, api_key: str = None,
    ) -> Dict[str, Any]:
        """
        人类前端卖家注册：
        1. 检查是否已注册，已有则更新 endpoint/description
        2. 通过 Wallet Service 代铸 PactumAgent NFT
        3. 写入/更新 agents 表
        """
        wallet_lower = wallet.lower()
        card_hash = "0x" + hashlib.sha256((description or "").encode()).hexdigest()

        existing = (
            self.supabase.table("agents")
            .select("wallet, endpoint")
            .eq("wallet", wallet_lower)
            .execute()
        )

        # 铸 NFT（如果链上未注册）
        need_mint = True
        if self.contract:
            try:
                checksum = Web3.to_checksum_address(wallet)
                if self.contract.functions.isRegistered(checksum).call():
                    need_mint = False
            except Exception as e:
                logger.warning(f"isRegistered check failed: {e}")

        if need_mint and api_key:
            await self._mint_agent_nft(api_key, card_hash, wallet)

        if existing.data:
            # 更新已有记录
            update_data: Dict[str, Any] = {}
            if endpoint is not None:
                update_data["endpoint"] = endpoint
            if description is not None:
                update_data["description"] = description
                update_data["card_hash"] = card_hash
            if email is not None:
                update_data["email"] = email
            if update_data:
                self.supabase.table("agents").update(update_data).eq("wallet", wallet_lower).execute()
            return {**existing.data[0], **update_data}
        else:
            # 新建
            data = {
                "wallet": wallet_lower,
                "description": description or "Seller (registered via frontend)",
                "card_hash": card_hash,
                "endpoint": endpoint,
                "avg_rating": 0,
                "total_reviews": 0,
            }
            if email:
                data["email"] = email
            result = self.supabase.table("agents").insert(data).execute()
            if not result.data:
                raise RuntimeError("Failed to insert agent")
            return result.data[0]

    async def _mint_agent_nft(self, api_key: str, card_hash: str, wallet: str):
        """通过 Wallet Service 代铸 PactumAgent NFT"""
        if not self.contract or not PACTUM_AGENT_CONTRACT_ADDRESS:
            logger.info("No contract configured, skipping NFT mint")
            return

        # 构造 registerAgent(cardHash, signer) calldata
        card_hash_bytes = bytes.fromhex(card_hash.replace("0x", ""))
        signer = Web3.to_checksum_address(wallet)
        calldata = self.contract.encodeABI(fn_name="registerAgent", args=[card_hash_bytes, signer])

        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    f"{WALLET_SERVICE_URL}/v1/contract-call",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "contract_address": PACTUM_AGENT_CONTRACT_ADDRESS,
                        "calldata": calldata,
                    },
                )
                resp.raise_for_status()
                result = resp.json()
                logger.info(f"NFT minted for {wallet}: tx={result.get('tx_hash')}")
        except Exception as e:
            logger.error(f"NFT mint failed for {wallet}: {e}")
            raise ValueError(f"Failed to mint PactumAgent NFT: {e}")

    # ========== 上架 ==========

    async def list_item(
        self,
        wallet: str,
        name: str,
        description: str,
        price: float,
        item_type: str = "digital",
        endpoint: str = None,
        requires_shipping: bool = False,
    ) -> Dict[str, Any]:
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

        if price <= 0:
            raise ValueError("price must be > 0")

        data = {
            "seller_wallet": wallet.lower(),
            "name": name,
            "description": description,
            "price": price,
            "type": item_type,
            "endpoint": endpoint,
            "requires_shipping": requires_shipping,
            "status": "active",
        }

        result = self.supabase.table("items").insert(data).execute()
        if not result.data:
            raise RuntimeError("Failed to insert item")
        return result.data[0]

    # ========== 更新商品 ==========

    async def update_item(
        self,
        item_id: str,
        wallet: str,
        name: str = None,
        description: str = None,
        price: float = None,
        status: str = None,
        endpoint: str = None,
        requires_shipping: bool = None,
    ) -> Dict[str, Any]:
        result = (
            self.supabase.table("items")
            .select("item_id, seller_wallet, status")
            .eq("item_id", item_id)
            .execute()
        )
        if not result.data:
            raise FileNotFoundError(f"Item {item_id} not found")
        if result.data[0]["seller_wallet"] != wallet.lower():
            raise PermissionError("Not your item")
        if result.data[0]["status"] == "deleted":
            raise ValueError("Item is deleted")

        update: Dict[str, Any] = {}
        if name is not None:
            update["name"] = name
        if description is not None:
            update["description"] = description
        if price is not None:
            if price <= 0:
                raise ValueError("price must be > 0")
            update["price"] = price
        if status is not None:
            if status not in ("active", "paused"):
                raise ValueError("status must be 'active' or 'paused'")
            update["status"] = status
        if endpoint is not None:
            update["endpoint"] = endpoint
        if requires_shipping is not None:
            update["requires_shipping"] = requires_shipping

        if not update:
            raise ValueError("No fields to update")

        updated = (
            self.supabase.table("items")
            .update(update)
            .eq("item_id", item_id)
            .execute()
        )
        return updated.data[0]

    # ========== 删除商品 ==========

    async def delete_item(self, item_id: str, wallet: str) -> Dict[str, Any]:
        result = (
            self.supabase.table("items")
            .select("item_id, seller_wallet, status")
            .eq("item_id", item_id)
            .execute()
        )
        if not result.data:
            raise FileNotFoundError(f"Item {item_id} not found")
        if result.data[0]["seller_wallet"] != wallet.lower():
            raise PermissionError("Not your item")
        if result.data[0]["status"] == "deleted":
            raise ValueError("Item already deleted")

        updated = (
            self.supabase.table("items")
            .update({"status": "deleted"})
            .eq("item_id", item_id)
            .execute()
        )
        return {"item_id": item_id, "status": "deleted"}

    # ========== 我的商品 ==========

    async def get_my_items(self, wallet: str) -> List[Dict[str, Any]]:
        result = (
            self.supabase.table("items")
            .select("*")
            .eq("seller_wallet", wallet.lower())
            .neq("status", "deleted")
            .order("created_at", desc=True)
            .execute()
        )
        return result.data if result.data else []

    # ========== 地址管理 ==========

    async def update_shipping_address(self, wallet: str, address: dict) -> dict:
        """验证并保存买家默认地址到 agents 表。"""
        addr = ShippingAddress(**address)
        validate_shipping_address(addr)

        self.supabase.table("agents").update(
            {"shipping_address": addr.model_dump()}
        ).eq("wallet", wallet.lower()).execute()

        return addr.model_dump()

    async def get_shipping_address(self, wallet: str) -> Optional[dict]:
        """查询 agents 表的默认地址。"""
        result = (
            self.supabase.table("agents")
            .select("shipping_address")
            .eq("wallet", wallet.lower())
            .execute()
        )
        if not result.data:
            return None
        return result.data[0].get("shipping_address")

    # ========== 卖家列表 ==========

    async def list_agents(self) -> List[Dict[str, Any]]:
        """公开接口：返回所有 agent 及其 active items。"""
        agents_result = (
            self.supabase.table("agents")
            .select("wallet, description, avg_rating, total_reviews, registered_at")
            .order("registered_at", desc=True)
            .execute()
        )
        agents = agents_result.data or []

        # 批量查各 agent 的 active items
        for agent in agents:
            items_result = (
                self.supabase.table("items")
                .select("item_id, name, description, price, type, requires_shipping, status")
                .eq("seller_wallet", agent["wallet"])
                .eq("status", "active")
                .order("created_at", desc=True)
                .execute()
            )
            agent["items"] = items_result.data or []

        return agents

    # ========== 搜索 ==========

    async def search_items(
        self, query: str = "", max_price: float = None
    ) -> List[Dict[str, Any]]:
        qb = (
            self.supabase.table("items")
            .select("*, agents!inner(wallet, description, avg_rating, total_reviews)")
            .eq("status", "active")
        )

        if query:
            qb = qb.or_(f"name.ilike.%{query}%,description.ilike.%{query}%")

        if max_price is not None:
            qb = qb.lte("price", max_price)

        qb = qb.order("created_at", desc=True)
        result = qb.execute()
        return result.data if result.data else []

    # ========== 下单 ==========

    async def create_order(
        self,
        item_id: str,
        buyer_wallet: str,
        shipping_address: Dict = None,
        buyer_query: str = None,
    ) -> Dict[str, Any]:
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

        # 地址逻辑：requires_shipping=true 时必须有地址
        resolved_address = shipping_address
        if item.get("requires_shipping"):
            if not resolved_address:
                # 查买家的默认地址
                saved = await self.get_shipping_address(buyer_wallet)
                if saved:
                    resolved_address = saved
                else:
                    raise ValueError(
                        "Shipping address required. Set your address first."
                    )
            # 校验地址格式
            addr = ShippingAddress(**(resolved_address if isinstance(resolved_address, dict) else resolved_address.model_dump()))
            validate_shipping_address(addr)
            resolved_address = addr.model_dump()

        data = {
            "item_id": item_id,
            "buyer_wallet": buyer_wallet.lower(),
            "seller_wallet": item["seller_wallet"],
            "amount": item["price"],
            "status": "created",
            "buyer_query": buyer_query,
        }
        if resolved_address:
            data["shipping_address"] = resolved_address

        result = self.supabase.table("orders").insert(data).execute()
        if not result.data:
            raise RuntimeError("Failed to create order")

        order = result.data[0]
        return {
            "order": order,
            "payment": {
                "method": "escrow",
                "amount": str(item["price"]),
                "currency": "USDC",
                "network": "testnet",
                "recipient": item["seller_wallet"],
                "order_id": order["order_id"],
                "escrow": {
                    "contract": ESCROW_CONTRACT_ADDRESS,
                    "usdc_contract": USDC_CONTRACT_ADDRESS,
                    "order_id_bytes32": Web3.keccak(text=order["order_id"]).hex(),
                    "paymaster_url": PAYMASTER_URL,
                    "steps": [
                        "1. approve USDC to escrow contract (type(uint256).max, only needed once)",
                        "2. deposit(order_id_bytes32, seller_address, amount_in_units) on escrow contract",
                    ],
                },
            },
        }

    # ========== 确认支付 ==========

    async def confirm_payment(self, order_id: str, tx_hash: str) -> Dict[str, Any]:
        order_result = (
            self.supabase.table("orders")
            .select("*, items(*)")
            .eq("order_id", order_id)
            .execute()
        )
        if not order_result.data:
            raise FileNotFoundError(f"Order {order_id} not found")

        order = order_result.data[0]
        if order["status"] not in ("created", "pending"):
            raise ValueError(f"Order status is '{order['status']}', expected 'created' or 'pending'")

        # Deposited(bytes32 indexed orderId, address indexed buyer, address indexed seller, uint256 amount)
        DEPOSITED_TOPIC = Web3.keccak(text="Deposited(bytes32,address,address,uint256)").hex()

        if self.w3:
            try:
                self.w3.eth.get_transaction(tx_hash)
                receipt = self.w3.eth.get_transaction_receipt(tx_hash)
                if receipt["status"] != 1:
                    raise ValueError("Transaction failed on-chain")

                # 验证 Deposited event
                expected_order_bytes32 = Web3.keccak(text=order_id).hex()
                expected_buyer = order["buyer_wallet"].lower()
                expected_amount = int(float(order["amount"]) * 1_000_000)
                escrow_addr = ESCROW_CONTRACT_ADDRESS.lower()

                found = False
                for log in receipt["logs"]:
                    if log["address"].lower() != escrow_addr:
                        continue
                    topics = [t.hex() if isinstance(t, bytes) else t for t in log["topics"]]
                    if len(topics) < 4:
                        continue
                    if topics[0] != DEPOSITED_TOPIC:
                        continue
                    # topics[1] = orderId, topics[2] = buyer, topics[3] = seller
                    log_order_id = topics[1]
                    log_buyer = "0x" + topics[2][-40:]
                    # amount is in data (non-indexed)
                    log_amount = int(log["data"].hex() if isinstance(log["data"], bytes) else log["data"], 16)

                    if (log_order_id == expected_order_bytes32
                            and log_buyer.lower() == expected_buyer
                            and log_amount == expected_amount):
                        found = True
                        break

                if not found:
                    raise ValueError(
                        "No matching Deposited event found in transaction. "
                        "Ensure you called escrow.deposit() with the correct order_id, seller, and amount."
                    )
            except ValueError:
                raise
            except Exception as e:
                raise ValueError(f"Transaction verification failed: {e}")

        existing_tx = (
            self.supabase.table("orders")
            .select("order_id")
            .eq("tx_hash", tx_hash)
            .execute()
        )
        if existing_tx.data:
            raise ValueError(f"tx_hash {tx_hash} already used")

        self.supabase.table("orders").update(
            {"status": "paid", "tx_hash": tx_hash}
        ).eq("order_id", order_id).execute()

        item = order.get("items")

        # 解析 endpoint: item.endpoint > agent.endpoint
        endpoint = None
        if item:
            endpoint = item.get("endpoint")
        if not endpoint:
            agent_row = (
                self.supabase.table("agents")
                .select("endpoint")
                .eq("wallet", order["seller_wallet"])
                .execute()
            )
            if agent_row.data:
                endpoint = agent_row.data[0].get("endpoint")

        # digital + 有 endpoint → 调 seller endpoint
        if item and item.get("type") == "digital" and endpoint:
            self.supabase.table("orders").update(
                {"status": "processing"}
            ).eq("order_id", order_id).execute()

            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(
                        endpoint,
                        json={
                            "order_id": order_id,
                            "buyer_query": order.get("buyer_query", ""),
                        },
                    )
                    resp.raise_for_status()
                    result_data = resp.json()

                result_status = result_data.get("status", "ok")

                if result_status == "accepted":
                    # 卖家接受但需要异步处理
                    return {"order_id": order_id, "status": "processing"}

                # 同步完成
                self.supabase.table("orders").update(
                    {"status": "completed", "result": result_data}
                ).eq("order_id", order_id).execute()

                return {"order_id": order_id, "status": "completed", "result": result_data}
            except httpx.TimeoutException:
                # 30s 超时 → 降级为 processing
                logger.info(f"Order {order_id}: seller endpoint timeout, degrading to processing")
                return {"order_id": order_id, "status": "processing"}
            except Exception as e:
                self.supabase.table("orders").update(
                    {"status": "failed", "result": {"error": str(e)}}
                ).eq("order_id", order_id).execute()
                return {"order_id": order_id, "status": "failed", "error": str(e)}

        return {
            "order_id": order_id,
            "status": "paid",
            "message": "Payment confirmed. Awaiting seller fulfillment.",
        }

    # ========== 交付 ==========

    async def deliver_order(
        self, order_id: str, wallet: str, content: str = None, tracking: str = None,
        file_url: str = None, file_path: str = None, file_size: int = None,
    ) -> Dict[str, Any]:
        order_result = (
            self.supabase.table("orders")
            .select("*, items(name, type)")
            .eq("order_id", order_id)
            .eq("seller_wallet", wallet.lower())
            .execute()
        )
        if not order_result.data:
            raise FileNotFoundError(f"Order {order_id} not found or not yours")

        order = order_result.data[0]
        if order["status"] not in ("paid", "processing"):
            raise ValueError(f"Order status is '{order['status']}', cannot deliver")

        update = {"status": "delivered"}
        result_data = {}
        if content:
            result_data["content"] = content
        if tracking:
            result_data["tracking"] = tracking
        if file_url:
            result_data["file_url"] = file_url
        if file_path:
            result_data["file_path"] = file_path
        if file_size:
            result_data["size"] = file_size
        if result_data:
            update["result"] = result_data

        self.supabase.table("orders").update(update).eq("order_id", order_id).execute()

        # 写 agent_events 表 — 买家可通过 GET /market/events 拉取
        self.supabase.table("agent_events").insert({
            "wallet": order["buyer_wallet"],
            "event_type": "order_delivered",
            "payload": {
                "order_id": order_id,
                "content": content,
                "tracking": tracking,
                "file_url": file_url,
            },
        }).execute()

        item = order.get("items") or {}
        return {
            "order_id": order_id,
            "status": "delivered",
            "buyer_wallet": order["buyer_wallet"],
            "seller_wallet": order["seller_wallet"],
            "item_name": item.get("name", ""),
            "file_url": file_url,
        }

    # ========== 消息中继 ==========

    async def relay_message(
        self, from_wallet: str, to_wallet: str, order_id: str, content: str, direction: str
    ) -> Dict[str, Any]:
        data = {
            "order_id": order_id,
            "from_wallet": from_wallet.lower(),
            "to_wallet": to_wallet.lower(),
            "content": content,
            "direction": direction,
        }
        result = self.supabase.table("messages").insert(data).execute()
        if not result.data:
            raise RuntimeError("Failed to insert message")
        return result.data[0]

    # ========== 查消息 ==========

    async def get_order_messages(self, order_id: str, wallet: str) -> List[Dict[str, Any]]:
        """查询订单消息历史，只有买卖双方可以看。"""
        order = await self.get_order(order_id, wallet)
        if not order:
            raise FileNotFoundError(f"Order {order_id} not found")

        result = (
            self.supabase.table("messages")
            .select("*")
            .eq("order_id", order_id)
            .order("created_at", desc=False)
            .execute()
        )
        return result.data if result.data else []

    # ========== 查订单 ==========

    async def get_order(self, order_id: str, wallet: str) -> Optional[Dict[str, Any]]:
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
        if order["buyer_wallet"] != wallet_lower and order["seller_wallet"] != wallet_lower:
            raise PermissionError("Not authorized to view this order")
        return order

    async def get_wallet_orders(self, wallet: str) -> List[Dict[str, Any]]:
        w = wallet.lower()
        result = (
            self.supabase.table("orders")
            .select("*, items(name, type, price)")
            .or_(f"buyer_wallet.eq.{w},seller_wallet.eq.{w}")
            .order("created_at", desc=True)
            .limit(20)
            .execute()
        )
        return result.data if result.data else []

    # ========== Events ==========

    async def get_events(self, wallet: str) -> List[Dict[str, Any]]:
        """查询未送达的 agent_events，返回后标记 delivered=true"""
        result = (
            self.supabase.table("agent_events")
            .select("*")
            .eq("wallet", wallet.lower())
            .eq("delivered", False)
            .order("created_at", desc=False)
            .execute()
        )
        events = result.data or []

        # 标记已送达
        for event in events:
            self.supabase.table("agent_events").update(
                {"delivered": True}
            ).eq("event_id", event["event_id"]).execute()

        return events

    # ========== 统计 ==========

    async def get_stats(self) -> Dict[str, int]:
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
