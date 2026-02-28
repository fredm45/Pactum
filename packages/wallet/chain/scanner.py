"""
USDC 充值检测 — 定时扫描 Transfer events
匹配 to 地址在 wallet_users 中的记录 → 写入 transactions + events
"""
import asyncio
import logging

from db.client import get_supabase
from chain.usdc import get_transfer_events, get_latest_block
from config import SCANNER_INTERVAL

logger = logging.getLogger("wallet.scanner")

# 记住上次扫描到的区块
_last_scanned_block: int | None = None


def _get_user_addresses() -> dict[str, str]:
    """获取所有用户地址 → user_id 的映射（EOA + smart account，地址小写化）"""
    db = get_supabase()
    result = db.table("wallet_users").select("id, wallet_address, smart_account_address").execute()
    addr_map = {}
    for row in (result.data or []):
        # EOA 地址
        addr_map[row["wallet_address"].lower()] = row["id"]
        # Smart account 地址
        if row.get("smart_account_address"):
            addr_map[row["smart_account_address"].lower()] = row["id"]
    return addr_map


async def scan_deposits():
    """单次扫描"""
    global _last_scanned_block

    try:
        latest = get_latest_block()

        if _last_scanned_block is None:
            # 首次启动，从当前区块开始（不扫历史）
            _last_scanned_block = latest
            logger.info(f"Scanner initialized at block {latest}")
            return

        if latest <= _last_scanned_block:
            return  # 没有新区块

        from_block = _last_scanned_block + 1
        to_block = min(latest, from_block + 2000)  # 最多扫 2000 个区块

        events = get_transfer_events(from_block, to_block)
        user_map = _get_user_addresses()

        db = get_supabase()
        deposit_count = 0

        for evt in events:
            to_lower = evt["to"].lower()
            if to_lower not in user_map:
                continue

            user_id = user_map[to_lower]
            tx_hash = evt["tx_hash"]

            # 幂等：检查 tx_hash 是否已存在
            existing = db.table("wallet_transactions").select("id").eq("tx_hash", tx_hash).execute()
            if existing.data:
                continue

            # 写入交易记录
            db.table("wallet_transactions").insert({
                "user_id": user_id,
                "type": "deposit",
                "amount": evt["value"],
                "from_address": evt["from"],
                "to_address": evt["to"],
                "tx_hash": tx_hash,
                "status": "completed",
            }).execute()

            # 写入事件
            db.table("wallet_events").insert({
                "user_id": user_id,
                "type": "deposit_received",
                "data": {
                    "from": evt["from"],
                    "amount": evt["value"],
                    "tx_hash": tx_hash,
                },
            }).execute()

            deposit_count += 1

        if deposit_count > 0:
            logger.info(f"Detected {deposit_count} deposits in blocks {from_block}-{to_block}")

        _last_scanned_block = to_block

    except Exception as e:
        logger.error(f"Scanner error: {e}")


async def scanner_loop():
    """持续运行的充值检测循环"""
    logger.info(f"Starting deposit scanner (interval: {SCANNER_INTERVAL}s)")
    while True:
        await scan_deposits()
        await asyncio.sleep(SCANNER_INTERVAL)


async def expired_payment_cleanup_loop():
    """清理过期的 pending payments"""
    from config import EXPIRED_PAYMENT_CLEANUP_INTERVAL
    from datetime import datetime, timezone

    logger.info("Starting expired payment cleanup loop")
    while True:
        try:
            db = get_supabase()
            now = datetime.now(timezone.utc).isoformat()
            result = (
                db.table("wallet_pending_payments")
                .update({"status": "expired"})
                .eq("status", "pending")
                .lt("expires_at", now)
                .execute()
            )
            expired = len(result.data or [])
            if expired > 0:
                logger.info(f"Expired {expired} pending payments")
        except Exception as e:
            logger.error(f"Cleanup error: {e}")

        await asyncio.sleep(EXPIRED_PAYMENT_CLEANUP_INTERVAL)
