"""
API Key 生成 + bcrypt 验证
格式: pk_live_{32 hex chars}
"""
import secrets
import bcrypt


def generate_api_key() -> tuple[str, str]:
    """
    生成 API key 和对应的 bcrypt hash
    Returns: (plain_key, bcrypt_hash)
    """
    raw = secrets.token_hex(16)
    plain = f"pk_live_{raw}"
    hashed = bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()
    return plain, hashed


def verify_api_key(plain: str, hashed: str) -> bool:
    """验证明文 API key 与 bcrypt hash 是否匹配"""
    return bcrypt.checkpw(plain.encode(), hashed.encode())
