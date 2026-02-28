"""
ConnectionManager — wallet↔WebSocket 映射 + 离线队列
"""
import json
import logging
from typing import Dict, Any, Optional

from fastapi import WebSocket

logger = logging.getLogger("pactum.ws")


class ConnectionManager:
    def __init__(self, supabase):
        self.active: Dict[str, WebSocket] = {}  # wallet → WebSocket
        self.supabase = supabase

    async def connect(self, wallet: str, ws: WebSocket):
        """注册连接，踢掉同 wallet 的旧连接"""
        old = self.active.get(wallet)
        if old:
            try:
                await old.send_json({
                    "type": "error",
                    "code": "REPLACED",
                    "message": "Another connection opened for this wallet",
                })
                await old.close(code=4001, reason="replaced")
            except Exception:
                pass

        self.active[wallet] = ws
        logger.info(f"Connected: {wallet} (total: {len(self.active)})")

        # 投递离线消息
        await self._deliver_offline(wallet, ws)

    def disconnect(self, wallet: str):
        self.active.pop(wallet, None)
        logger.info(f"Disconnected: {wallet} (total: {len(self.active)})")

    async def send_to(self, wallet: str, msg: Dict[str, Any]):
        """在线则直接推，离线存 agent_events 表"""
        ws = self.active.get(wallet)
        if ws:
            try:
                await ws.send_json(msg)
                return
            except Exception:
                self.active.pop(wallet, None)

        # 离线 → 存入数据库
        self.supabase.table("agent_events").insert({
            "wallet": wallet.lower(),
            "event_type": msg.get("type", "unknown"),
            "payload": msg,
        }).execute()
        logger.info(f"Queued offline event for {wallet}: {msg.get('type')}")

    async def _deliver_offline(self, wallet: str, ws: WebSocket):
        """重连后投递离线消息"""
        result = (
            self.supabase.table("agent_events")
            .select("*")
            .eq("wallet", wallet.lower())
            .eq("delivered", False)
            .order("created_at")
            .execute()
        )
        if not result.data:
            return

        for event in result.data:
            try:
                await ws.send_json(event["payload"])
                self.supabase.table("agent_events").update(
                    {"delivered": True}
                ).eq("event_id", event["event_id"]).execute()
            except Exception:
                break

        count = len(result.data)
        if count:
            logger.info(f"Delivered {count} offline events to {wallet}")
