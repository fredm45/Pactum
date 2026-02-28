"""
FastAPI 依赖注入 — 从 Bearer token 解析用户
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from db.client import get_supabase
from auth.api_key import verify_api_key

_bearer = HTTPBearer()


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    """
    从 Bearer token 验证 API key，返回 wallet_users 行
    遍历所有用户做 bcrypt 比较 — 用户规模小（<10k）时没问题
    大规模可加 key prefix 索引
    """
    token = creds.credentials
    db = get_supabase()

    # 取前缀做初筛 — API key 格式 pk_live_{hex}
    if not token.startswith("pk_live_"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key format")

    # 拉所有用户（规模小时可行）
    result = db.table("wallet_users").select("*").execute()
    for user in result.data or []:
        if verify_api_key(token, user["api_key_hash"]):
            return user

    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
