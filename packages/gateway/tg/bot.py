"""
Telegram Bot — 绑定 JWT + 查询订单
使用 python-telegram-bot (webhook 模式，集成在 FastAPI 中)
"""
import logging
from telegram import Update, Bot
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    filters,
)

from market import auth

logger = logging.getLogger("pactum.telegram")


class PactumBot:
    def __init__(self, token: str, supabase):
        self.bot = Bot(token)
        self.supabase = supabase
        self.app = (
            Application.builder()
            .token(token)
            .updater(None)  # webhook 模式，不用 polling
            .build()
        )
        self._register_handlers()

    def _register_handlers(self):
        self.app.add_handler(CommandHandler("start", self._cmd_start))
        self.app.add_handler(CommandHandler("bind", self._cmd_bind))
        self.app.add_handler(CommandHandler("orders", self._cmd_orders))
        self.app.add_handler(CommandHandler("order", self._cmd_order))
        self.app.add_handler(CommandHandler("unbind", self._cmd_unbind))
        # 非命令文本 → 当作 JWT 绑定尝试
        self.app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, self._handle_text))

    # ========== /start ==========

    async def _cmd_start(self, update: Update, ctx):
        await update.message.reply_text(
            "Welcome to Pactum Market Bot!\n\n"
            "Bind your agent to receive order notifications.\n\n"
            "How to bind:\n"
            "1. Ask your Agent for its JWT token\n"
            "2. Paste the JWT here (or use /bind)\n\n"
            "Commands:\n"
            "/bind — Bind your agent\n"
            "/orders — View your orders\n"
            "/order <id> — Order details\n"
            "/unbind — Unbind"
        )

    # ========== /bind ==========

    async def _cmd_bind(self, update: Update, ctx):
        await update.message.reply_text(
            "Please paste your Agent's JWT token.\n"
            "You can get it from your Agent after it authenticates with Pactum."
        )

    # ========== JWT 文本处理 ==========

    async def _handle_text(self, update: Update, ctx):
        """非命令文本 → 尝试当作 JWT 绑定"""
        text = update.message.text.strip()
        # JWT 格式检查（3段 base64 用 . 连接）
        if text.count(".") != 2 or len(text) < 50:
            return

        try:
            wallet = auth.decode_token(text)
        except (ValueError, KeyError) as e:
            await update.message.reply_text(f"Invalid JWT: {e}")
            return

        chat_id = update.message.chat_id
        try:
            # upsert — 同一 chat_id + wallet 只存一条（lowercase 统一）
            wallet = wallet.lower()
            self.supabase.table("telegram_bindings").upsert(
                {"chat_id": chat_id, "wallet": wallet}
            ).execute()

            await update.message.reply_text(
                f"Bound! Wallet: {wallet[:6]}...{wallet[-4:]}\n"
                f"You'll receive order notifications here.\n\n"
                f"Use /orders to view your orders."
            )
            logger.info(f"Telegram bind: chat_id={chat_id} wallet={wallet}")
        except Exception as e:
            logger.error(f"Telegram bind failed: {e}")
            await update.message.reply_text(f"Bind failed: {e}")

    # ========== /orders ==========

    async def _cmd_orders(self, update: Update, ctx):
        chat_id = update.message.chat_id
        wallets = self._get_wallets(chat_id)
        if not wallets:
            await update.message.reply_text("Not bound. Paste your JWT to bind first.")
            return

        lines = []
        try:
            for wallet in wallets:
                label = f"{wallet[:6]}...{wallet[-4:]}"
                bought = (
                    self.supabase.table("orders")
                    .select("order_id, status, amount, created_at, items(name)")
                    .eq("buyer_wallet", wallet)
                    .order("created_at", desc=True)
                    .limit(5)
                    .execute()
                )
                sold = (
                    self.supabase.table("orders")
                    .select("order_id, status, amount, created_at, items(name)")
                    .eq("seller_wallet", wallet)
                    .order("created_at", desc=True)
                    .limit(5)
                    .execute()
                )
                if bought.data:
                    lines.append(f"📦 Bought ({label}):")
                    for o in bought.data:
                        name = o.get("items", {}).get("name", "?") if o.get("items") else "?"
                        lines.append(f"  {_status_emoji(o['status'])} {name} — {o['amount']} USDC [{o['status']}]")
                        lines.append(f"    ID: {o['order_id'][:8]}...")
                if sold.data:
                    lines.append(f"💰 Sold ({label}):")
                    for o in sold.data:
                        name = o.get("items", {}).get("name", "?") if o.get("items") else "?"
                        lines.append(f"  {_status_emoji(o['status'])} {name} — {o['amount']} USDC [{o['status']}]")
                        lines.append(f"    ID: {o['order_id'][:8]}...")
        except Exception as e:
            await update.message.reply_text(f"Query failed: {e}")
            return

        if not lines:
            await update.message.reply_text("No orders found.")
            return

        await update.message.reply_text("\n".join(lines))

    # ========== /order <id> ==========

    async def _cmd_order(self, update: Update, ctx):
        chat_id = update.message.chat_id
        wallets = self._get_wallets(chat_id)
        if not wallets:
            await update.message.reply_text("Not bound. Paste your JWT to bind first.")
            return

        if not ctx.args:
            await update.message.reply_text("Usage: /order <order_id>")
            return

        order_id = ctx.args[0]
        try:
            result = (
                self.supabase.table("orders")
                .select("*, items(name, type)")
                .eq("order_id", order_id)
                .execute()
            )
        except Exception as e:
            await update.message.reply_text(f"Query failed: {e}")
            return

        if not result.data:
            # 尝试 prefix 匹配
            try:
                result = (
                    self.supabase.table("orders")
                    .select("*, items(name, type)")
                    .like("order_id", f"{order_id}%")
                    .execute()
                )
            except Exception as e:
                await update.message.reply_text(f"Query failed: {e}")
                return
            if not result.data:
                await update.message.reply_text("Order not found.")
                return

        o = result.data[0]
        # 权限检查 — 检查所有绑定的 wallet
        wallet = None
        for w in wallets:
            if w in (o["buyer_wallet"], o["seller_wallet"]):
                wallet = w
                break
        if not wallet:
            await update.message.reply_text("Not your order.")
            return

        name = o.get("items", {}).get("name", "?") if o.get("items") else "?"
        role = "Buyer" if wallet == o["buyer_wallet"] else "Seller"
        lines = [
            f"{_status_emoji(o['status'])} Order: {o['order_id'][:8]}...",
            f"Item: {name}",
            f"Role: {role}",
            f"Amount: {o['amount']} USDC",
            f"Status: {o['status']}",
        ]
        if o.get("tx_hash"):
            lines.append(f"Tx: {o['tx_hash'][:10]}...")
        if o.get("result"):
            content = str(o["result"])
            if len(content) > 200:
                content = content[:200] + "..."
            lines.append(f"Result: {content}")
        if o.get("buyer_query"):
            lines.append(f"Query: {o['buyer_query']}")
        lines.append(f"Created: {o.get('created_at', '?')[:16]}")

        await update.message.reply_text("\n".join(lines))

    # ========== /unbind ==========

    async def _cmd_unbind(self, update: Update, ctx):
        chat_id = update.message.chat_id

        # 支持 /unbind <wallet_prefix> 解绑指定 wallet，否则解绑全部
        if ctx.args:
            prefix = ctx.args[0].lower()
            try:
                result = (
                    self.supabase.table("telegram_bindings")
                    .select("wallet")
                    .eq("chat_id", chat_id)
                    .execute()
                )
            except Exception as e:
                await update.message.reply_text(f"Query failed: {e}")
                return
            matched = [r["wallet"] for r in (result.data or []) if r["wallet"].startswith(prefix)]
            if not matched:
                await update.message.reply_text(f"No bound wallet matching '{prefix}'.")
                return
            try:
                for w in matched:
                    self.supabase.table("telegram_bindings").delete().eq("chat_id", chat_id).eq("wallet", w).execute()
            except Exception as e:
                await update.message.reply_text(f"Unbind failed: {e}")
                return
            await update.message.reply_text(f"Unbound {len(matched)} wallet(s).")
            logger.info(f"Telegram unbind: chat_id={chat_id} wallets={matched}")
        else:
            # 列出已绑定的 wallet，提示用法
            try:
                result = (
                    self.supabase.table("telegram_bindings")
                    .select("wallet")
                    .eq("chat_id", chat_id)
                    .execute()
                )
            except Exception as e:
                await update.message.reply_text(f"Query failed: {e}")
                return
            wallets = [r["wallet"] for r in (result.data or [])]
            if not wallets:
                await update.message.reply_text("Not bound.")
                return
            lines = ["Usage: /unbind <wallet_prefix>", "", "Bound wallets:"]
            for w in wallets:
                lines.append(f"  • {w[:6]}...{w[-4:]}  ({w})")
            await update.message.reply_text("\n".join(lines))
            logger.info(f"Telegram unbind list: chat_id={chat_id}")

    # ========== helpers ==========

    def _get_wallets(self, chat_id: int) -> list[str]:
        try:
            result = (
                self.supabase.table("telegram_bindings")
                .select("wallet")
                .eq("chat_id", chat_id)
                .execute()
            )
            return [r["wallet"] for r in (result.data or [])]
        except Exception as e:
            logger.error(f"Failed to get wallets for chat_id={chat_id}: {e}")
            return []

    def _get_wallet(self, chat_id: int) -> str | None:
        wallets = self._get_wallets(chat_id)
        return wallets[0] if wallets else None

    async def process_update(self, update_data: dict):
        """处理来自 webhook 的 update"""
        update = Update.de_json(update_data, self.bot)
        await self.app.process_update(update)


def _status_emoji(status: str) -> str:
    return {
        "created": "⏳",
        "paid": "💳",
        "processing": "⚙️",
        "delivered": "📬",
        "completed": "✅",
        "failed": "❌",
        "disputed": "⚠️",
    }.get(status, "❓")
