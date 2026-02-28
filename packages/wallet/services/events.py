"""
事件写入/查询 — Agent 轮询用
"""
from datetime import datetime, timezone
from db.client import get_supabase


async def get_events(user_id: str, since: str | None = None, limit: int = 50) -> dict:
    """
    获取用户事件，支持按时间过滤
    """
    db = get_supabase()
    query = db.table("wallet_events").select("*").eq("user_id", user_id)

    if since:
        query = query.gt("created_at", since)

    result = query.order("created_at", desc=False).limit(limit).execute()

    return {"events": result.data or []}
