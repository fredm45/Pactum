"""
WebSocket 消息路由 — 处理所有客户端消息
"""
import logging
import uuid
from typing import Dict, Any, Optional

from fastapi import WebSocket

from market import auth
from market.service import MarketService
from ws.connection import ConnectionManager
from ws import protocol as P
from tg.notify import send_notification as _tg_notify

logger = logging.getLogger("pactum.ws")


class WSHandler:
    def __init__(self, market: MarketService, manager: ConnectionManager):
        self.market = market
        self.manager = manager

    async def handle(self, ws: WebSocket, msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """路由消息到对应处理方法，返回响应"""
        msg_type = msg.get("type")
        req_id = msg.get("id", str(uuid.uuid4())[:8])

        if msg_type not in P.CLIENT_TYPES:
            return self._error(req_id, "UNKNOWN_TYPE", f"Unknown message type: {msg_type}")

        handler = getattr(self, f"_handle_{msg_type}", None)
        if not handler:
            return self._error(req_id, "NOT_IMPLEMENTED", f"Handler not implemented: {msg_type}")

        try:
            data = await handler(ws, msg)
            return {"type": P.RESULT, "reply_to": req_id, "ok": True, "data": data}
        except PermissionError as e:
            return self._error(req_id, "FORBIDDEN", str(e))
        except FileNotFoundError as e:
            return self._error(req_id, "NOT_FOUND", str(e))
        except FileExistsError as e:
            return self._error(req_id, "CONFLICT", str(e))
        except ValueError as e:
            return self._error(req_id, "INVALID", str(e))
        except Exception as e:
            logger.exception(f"Error handling {msg_type}")
            return self._error(req_id, "INTERNAL", str(e))

    def _error(self, req_id: str, code: str, message: str) -> Dict[str, Any]:
        return {"type": P.ERROR, "reply_to": req_id, "ok": False, "code": code, "message": message}

    def _get_wallet(self, ws: WebSocket) -> str:
        """从 ws.state 获取已认证的 wallet"""
        wallet = getattr(ws.state, "wallet", None)
        if not wallet:
            raise PermissionError("Not authenticated. Send auth message first.")
        return wallet

    # ========== ping ==========

    async def _handle_ping(self, ws: WebSocket, msg: Dict[str, Any]) -> Dict[str, Any]:
        return {"pong": True}

    # ========== auth ==========

    async def _handle_auth(self, ws: WebSocket, msg: Dict[str, Any]) -> Dict[str, Any]:
        """认证：JWT token 或 challenge-response"""
        token = msg.get("token")
        if token:
            wallet = auth.decode_token(token)
            ws.state.wallet = wallet.lower()
            await self.manager.connect(wallet.lower(), ws)
            return {"wallet": wallet.lower(), "method": "jwt"}

        # challenge-response
        wallet = msg.get("wallet")
        signature = msg.get("signature")
        challenge = msg.get("challenge")
        timestamp = msg.get("timestamp")

        if not all([wallet, signature, challenge, timestamp]):
            # 没有签名 → 生成 challenge
            result = auth.create_challenge(self.market.supabase)
            return {"action": "sign_challenge", **result}

        # 验证签名 → JWT
        token = auth.verify_challenge(
            supabase=self.market.supabase,
            contract=self.market.contract,
            wallet=wallet,
            challenge=challenge,
            timestamp=timestamp,
            signature=signature,
        )
        ws.state.wallet = wallet.lower()
        await self.manager.connect(wallet.lower(), ws)
        return {"wallet": wallet.lower(), "token": token, "method": "eip712"}

    # ========== sell ==========

    async def _handle_sell(self, ws: WebSocket, msg: Dict[str, Any]) -> Dict[str, Any]:
        wallet = self._get_wallet(ws)
        item = await self.market.list_item(
            wallet=wallet,
            name=msg.get("name", "Untitled"),
            description=msg.get("description", ""),
            price=float(msg["price"]),
            item_type=msg.get("type", "digital"),
            endpoint=msg.get("endpoint"),
            requires_shipping=msg.get("requires_shipping", False),
        )
        return item

    # ========== update_item ==========

    async def _handle_update_item(self, ws: WebSocket, msg: Dict[str, Any]) -> Dict[str, Any]:
        wallet = self._get_wallet(ws)
        item = await self.market.update_item(
            item_id=msg["item_id"],
            wallet=wallet,
            name=msg.get("name"),
            description=msg.get("description"),
            price=float(msg["price"]) if "price" in msg else None,
            status=msg.get("status"),
            endpoint=msg.get("endpoint"),
            requires_shipping=msg.get("requires_shipping"),
        )
        return item

    # ========== delete_item ==========

    async def _handle_delete_item(self, ws: WebSocket, msg: Dict[str, Any]) -> Dict[str, Any]:
        wallet = self._get_wallet(ws)
        return await self.market.delete_item(item_id=msg["item_id"], wallet=wallet)

    # ========== my_items ==========

    async def _handle_my_items(self, ws: WebSocket, msg: Dict[str, Any]) -> Dict[str, Any]:
        wallet = self._get_wallet(ws)
        items = await self.market.get_my_items(wallet)
        return {"items": items, "count": len(items)}

    # ========== search ==========

    async def _handle_search(self, ws: WebSocket, msg: Dict[str, Any]) -> Dict[str, Any]:
        items = await self.market.search_items(
            query=msg.get("query", ""),
            max_price=msg.get("max_price"),
        )
        return {"items": items, "count": len(items)}

    # ========== buy ==========

    async def _handle_buy(self, ws: WebSocket, msg: Dict[str, Any]) -> Dict[str, Any]:
        wallet = self._get_wallet(ws)
        result = await self.market.create_order(
            item_id=msg["item_id"],
            buyer_wallet=wallet,
            shipping_address=msg.get("shipping_address"),
            buyer_query=msg.get("query"),
        )
        order = result["order"]
        payment = result["payment"]

        # 查 item name 给通知用
        item_row = (
            self.market.supabase.table("items")
            .select("name")
            .eq("item_id", order["item_id"])
            .execute()
        )
        item_name = item_row.data[0]["name"] if item_row.data else "?"

        # 通知卖家（WS）
        await self.manager.send_to(order["seller_wallet"], {
            "type": P.ORDER_NEW,
            "order_id": order["order_id"],
            "item_id": order["item_id"],
            "buyer_wallet": order["buyer_wallet"],
            "amount": str(order["amount"]),
            "buyer_query": order.get("buyer_query"),
        })

        # Telegram 通知双方
        tg_data = {
            "order_id": order["order_id"],
            "amount": str(order["amount"]),
            "buyer_wallet": order["buyer_wallet"],
            "item_name": item_name,
            "buyer_query": order.get("buyer_query"),
        }
        await _tg_notify(order["seller_wallet"], "order_new", {**tg_data, "role": "seller"})
        await _tg_notify(order["buyer_wallet"], "order_new", {**tg_data, "role": "buyer"})

        return {
            "order_id": order["order_id"],
            "payment": payment,
        }

    # ========== pay ==========

    async def _handle_pay(self, ws: WebSocket, msg: Dict[str, Any]) -> Dict[str, Any]:
        wallet = self._get_wallet(ws)
        result = await self.market.confirm_payment(
            order_id=msg["order_id"],
            tx_hash=msg["tx_hash"],
        )

        # 通知卖家付款已确认
        order = (
            self.market.supabase.table("orders")
            .select("*")
            .eq("order_id", msg["order_id"])
            .execute()
        )
        if order.data:
            o = order.data[0]
            await self.manager.send_to(o["seller_wallet"], {
                "type": P.PAYMENT_CONFIRMED,
                "order_id": o["order_id"],
                "buyer_wallet": o["buyer_wallet"],
                "tx_hash": msg["tx_hash"],
                "amount": str(o["amount"]),
            })

            # Telegram 通知双方
            tg_data = {
                "order_id": o["order_id"],
                "amount": str(o["amount"]),
                "buyer_wallet": o["buyer_wallet"],
                "tx_hash": msg["tx_hash"],
            }
            await _tg_notify(o["seller_wallet"], "payment_confirmed", {**tg_data, "role": "seller"})
            await _tg_notify(o["buyer_wallet"], "payment_confirmed", {**tg_data, "role": "buyer"})

        return result

    # ========== deliver ==========

    async def _handle_deliver(self, ws: WebSocket, msg: Dict[str, Any]) -> Dict[str, Any]:
        wallet = self._get_wallet(ws)
        result = await self.market.deliver_order(
            order_id=msg["order_id"],
            wallet=wallet,
            content=msg.get("content"),
            tracking=msg.get("tracking"),
        )

        # 通知买家收到交付
        await self.manager.send_to(result["buyer_wallet"], {
            "type": P.DELIVERY,
            "order_id": result["order_id"],
            "seller_wallet": result["seller_wallet"],
            "content": msg.get("content"),
            "tracking": msg.get("tracking"),
        })

        # Telegram 通知双方
        tg_data = {
            "order_id": result["order_id"],
            "content": msg.get("content"),
            "tracking": msg.get("tracking"),
        }
        await _tg_notify(result["buyer_wallet"], "delivery", {**tg_data, "role": "buyer"})
        await _tg_notify(result["seller_wallet"], "delivery", {**tg_data, "role": "seller"})

        return result

    # ========== message ==========

    async def _handle_message(self, ws: WebSocket, msg: Dict[str, Any]) -> Dict[str, Any]:
        wallet = self._get_wallet(ws)

        order = await self.market.get_order(msg["order_id"], wallet)
        if not order:
            raise FileNotFoundError(f"Order {msg['order_id']} not found")

        # 判断发送方向
        if wallet == order["buyer_wallet"]:
            to_wallet = order["seller_wallet"]
            direction = "buyer_to_seller"
        else:
            to_wallet = order["buyer_wallet"]
            direction = "seller_to_buyer"

        result = await self.market.relay_message(
            from_wallet=wallet,
            to_wallet=to_wallet,
            order_id=msg["order_id"],
            content=msg["content"],
            direction=direction,
        )

        # 推送给对方
        await self.manager.send_to(to_wallet, {
            "type": P.MESSAGE_RECEIVED,
            "order_id": msg["order_id"],
            "from_wallet": wallet,
            "content": msg["content"],
        })

        # Telegram 通知对方
        await _tg_notify(to_wallet, "message_received", {
            "order_id": msg["order_id"],
            "from_wallet": wallet,
            "content": msg["content"],
        })

        return {"message_id": result["message_id"], "to_wallet": to_wallet}

    # ========== orders ==========

    async def _handle_orders(self, ws: WebSocket, msg: Dict[str, Any]) -> Dict[str, Any]:
        wallet = self._get_wallet(ws)
        orders = await self.market.get_wallet_orders(wallet)
        return {"orders": orders, "count": len(orders)}

    # ========== get_messages ==========

    async def _handle_get_messages(self, ws: WebSocket, msg: Dict[str, Any]) -> Dict[str, Any]:
        wallet = self._get_wallet(ws)
        messages = await self.market.get_order_messages(msg["order_id"], wallet)
        return {"messages": messages, "count": len(messages)}

    # ========== set_address ==========

    async def _handle_set_address(self, ws: WebSocket, msg: Dict[str, Any]) -> Dict[str, Any]:
        wallet = self._get_wallet(ws)
        address = msg.get("address")
        if not address:
            raise ValueError("address object is required")
        result = await self.market.update_shipping_address(wallet, address)
        return {"address": result}

    # ========== get_address ==========

    async def _handle_get_address(self, ws: WebSocket, msg: Dict[str, Any]) -> Dict[str, Any]:
        wallet = self._get_wallet(ws)
        address = await self.market.get_shipping_address(wallet)
        return {"address": address}
