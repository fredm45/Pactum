"""
Supabase Storage 封装 — 文件上传 / 签名 URL / 下载 token
"""
import hashlib
import hmac
import uuid
from typing import Optional

from supabase import Client

from config import JWT_SECRET

BUCKET = "market-files"
MAX_SIZE = 5 * 1024 * 1024  # 5 MB
ALLOWED_MIMES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "video/mp4", "video/webm", "video/quicktime",
    "audio/mpeg", "audio/ogg", "audio/wav",
}


def _build_path(wallet: str, filename: str, subfolder: str = "uploads", order_id: str = None) -> str:
    prefix = wallet[:10].lower()
    safe_name = filename.replace("/", "_").replace("\\", "_")
    if order_id:
        return f"{subfolder}/{prefix}/{order_id}/{safe_name}"
    short_id = uuid.uuid4().hex[:8]
    return f"{subfolder}/{prefix}/{short_id}/{safe_name}"


async def upload_file(
    supabase: Client,
    wallet: str,
    filename: str,
    content: bytes,
    content_type: str,
    subfolder: str = "uploads",
    order_id: str = None,
) -> dict:
    if len(content) > MAX_SIZE:
        raise ValueError(f"File too large ({len(content)} bytes, max {MAX_SIZE})")
    if content_type not in ALLOWED_MIMES:
        raise ValueError(f"Unsupported file type: {content_type}. Allowed: {', '.join(sorted(ALLOWED_MIMES))}")

    path = _build_path(wallet, filename, subfolder, order_id)
    supabase.storage.from_(BUCKET).upload(
        path, content, {"content-type": content_type}
    )

    signed = supabase.storage.from_(BUCKET).create_signed_url(path, 3600)
    signed_url = signed.get("signedURL") or signed.get("signedUrl", "")

    return {
        "path": path,
        "signed_url": signed_url,
        "content_type": content_type,
        "size": len(content),
    }


def get_signed_url(supabase: Client, path: str, ttl: int = 3600) -> str:
    signed = supabase.storage.from_(BUCKET).create_signed_url(path, ttl)
    return signed.get("signedURL") or signed.get("signedUrl", "")


def make_download_token(order_id: str) -> str:
    """生成 order 的下载 token（HMAC），永不过期"""
    return hmac.new(JWT_SECRET.encode(), order_id.encode(), hashlib.sha256).hexdigest()[:16]


def verify_download_token(order_id: str, token: str) -> bool:
    expected = make_download_token(order_id)
    return hmac.compare_digest(expected, token)
