"""
Telegram 通知推送 — 订单状态变更时发送消息给绑定的用户
"""
import logging
from telegram import Bot

logger = logging.getLogger("pactum.telegram")

_bot: Bot | None = None
_supabase = None


def init(bot: Bot, supabase):
    global _bot, _supabase
    _bot = bot
    _supabase = supabase


async def send_notification(wallet: str, event_type: str, data: dict):
    """向绑定了该 wallet 的所有 Telegram 账号推送通知"""
    if not _bot or not _supabase:
        return

    try:
        result = (
            _supabase.table("telegram_bindings")
            .select("chat_id")
            .eq("wallet", wallet.lower())
            .execute()
        )
        if not result.data:
            return

        text = _format_message(event_type, data)
        if not text:
            return

        for row in result.data:
            chat_id = row["chat_id"]
            try:
                await _bot.send_message(chat_id=chat_id, text=text)
                logger.info(f"Telegram notification sent: {event_type} → {wallet[:8]}...")
            except Exception as e:
                logger.error(f"Telegram send failed to {chat_id}: {e}")
    except Exception as e:
        logger.error(f"Telegram notification failed: {event_type} → {wallet[:8]}... : {e}")


def _format_message(event_type: str, data: dict) -> str | None:
    """根据事件类型和数据中的 role 字段格式化消息"""
    role = data.get("role", "")
    order_id = data.get("order_id", "?")[:8]
    amount = data.get("amount", "?")

    full_order_id = data.get("order_id", "?")

    if event_type == "order_new":
        if role == "seller":
            buyer = data.get("buyer_wallet", "?")
            buyer_short = f"{buyer[:6]}...{buyer[-4:]}" if len(buyer) > 10 else buyer
            item_name = data.get("item_name", "an item")
            query = data.get("buyer_query")
            msg = f"📦 New order! Buyer {buyer_short} ordered {item_name}, {amount} USDC"
            if query:
                q = query if len(query) <= 500 else query[:500] + "..."
                msg += f"\nQuery: {q}"
            msg += f"\n\n🚚 Manual deliver: https://www.pactum.cc/orders?deliver={full_order_id}"
            msg += f"\n🤖 Ask your AI to deliver: POST https://api.pactum.cc/market/orders/{full_order_id}/deliver-file (Bearer JWT, multipart file)"
            return msg
        elif role == "buyer":
            item_name = data.get("item_name", "an item")
            return f"📦 Your order for {item_name} has been created. Amount: {amount} USDC\nWaiting for payment..."

    elif event_type == "payment_confirmed":
        if role == "seller":
            buyer = data.get("buyer_wallet", "?")
            buyer_short = f"{buyer[:6]}...{buyer[-4:]}" if len(buyer) > 10 else buyer
            tx = data.get("tx_hash", "")
            tx_short = f"{tx[:10]}..." if len(tx) > 10 else tx
            msg = f"💰 Payment received! Buyer {buyer_short} paid {amount} USDC\nTx: {tx_short}"
            msg += f"\n\n🚚 Manual deliver: https://www.pactum.cc/orders?deliver={full_order_id}"
            msg += f"\n🤖 Ask your AI to deliver: POST https://api.pactum.cc/market/orders/{full_order_id}/deliver-file (Bearer JWT, multipart file)"
            return msg
        elif role == "buyer":
            return f"✅ Payment confirmed! Waiting for seller to process your order..."

    elif event_type == "processing":
        if role == "buyer":
            return f"⏳ Your order {order_id}... is being processed. We'll notify you when it's ready."
        elif role == "seller":
            return f"⏳ Order {order_id}... is now processing."

    elif event_type == "delivery":
        if role == "buyer":
            tracking = data.get("tracking")
            file_url = data.get("file_url")
            item_name = data.get("item_name")
            msg = f"📬 Order {order_id}... ({item_name}) delivered!" if item_name else f"📬 Order {order_id}... delivered!"
            if tracking:
                msg += f"\nTracking: {tracking}"
            if file_url:
                msg += f"\nDownload: {file_url}"
                msg += "\nYou can also send this link to your agent to download."
            return msg
        elif role == "seller":
            return f"📬 Delivery sent for order {order_id}..."

    elif event_type == "completed":
        if role == "buyer":
            return f"✅ Order {order_id}... completed!"
        elif role == "seller":
            return f"✅ Order {order_id}... completed! Funds released."

    elif event_type == "message_received":
        from_wallet = data.get("from_wallet", "?")
        from_short = f"{from_wallet[:6]}...{from_wallet[-4:]}" if len(from_wallet) > 10 else from_wallet
        content = data.get("content", "")
        if len(content) > 300:
            content = content[:300] + "..."
        return f"💬 Message from {from_short}:\n{content}"

    return None
