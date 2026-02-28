"""
地址验证逻辑 — 按国家代码校验邮编格式
"""
import re
from market.models import ShippingAddress

# 国家代码 → 邮编正则
POSTAL_CODE_PATTERNS: dict[str, re.Pattern] = {
    "US": re.compile(r"^\d{5}(-\d{4})?$"),
    "CN": re.compile(r"^\d{6}$"),
    "JP": re.compile(r"^\d{3}-?\d{4}$"),
    "CA": re.compile(r"^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$"),
    "GB": re.compile(
        r"^(GIR\s?0AA|"
        r"[A-Za-z]{1,2}\d[A-Za-z\d]?\s?\d[A-Za-z]{2})$"
    ),
}


def validate_postal_code(postal_code: str, country: str) -> bool:
    """按国家代码做正则校验。未知国家只检查非空。"""
    code = postal_code.strip()
    if not code:
        return False
    pattern = POSTAL_CODE_PATTERNS.get(country.upper())
    if pattern:
        return bool(pattern.match(code))
    return True  # 未知国家只要非空即通过


def validate_shipping_address(addr: ShippingAddress) -> None:
    """校验地址完整性 + 邮编格式，失败抛 ValueError。"""
    for field in ("name", "street", "city", "state", "country"):
        val = getattr(addr, field, "")
        if not val or not val.strip():
            raise ValueError(f"Shipping address field '{field}' is required")

    if not validate_postal_code(addr.postal_code, addr.country):
        raise ValueError(
            f"Invalid postal code '{addr.postal_code}' for country '{addr.country}'"
        )
