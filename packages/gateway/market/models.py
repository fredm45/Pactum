"""
Pydantic 请求/响应模型
"""
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, field_validator


# ========== Auth ==========

class AuthVerifyRequest(BaseModel):
    wallet: str
    signature: str
    challenge: str
    timestamp: int


# ========== Registration ==========

class RegisterRequest(BaseModel):
    wallet: str
    description: Optional[str] = None
    telegram_group_id: Optional[int] = None


# ========== Shipping Address ==========

class ShippingAddress(BaseModel):
    name: str          # 收件人
    street: str        # 街道
    city: str          # 城市
    state: str         # 州/省
    postal_code: str   # 邮编
    country: str       # 国家代码 (US, CN, JP, etc.)

    @field_validator("country")
    @classmethod
    def country_upper(cls, v: str) -> str:
        return v.strip().upper()


class UpdateAddressRequest(BaseModel):
    address: ShippingAddress


# ========== Items ==========

class ListItemRequest(BaseModel):
    name: str
    description: str
    price: float
    type: str = "digital"
    endpoint: Optional[str] = None
    requires_shipping: bool = False


# ========== Purchase ==========

class RegisterSellerRequest(BaseModel):
    endpoint: Optional[str] = None
    description: Optional[str] = None
    email: Optional[str] = None


class BuyRequest(BaseModel):
    query: Optional[str] = None
    shipping_address: Optional[ShippingAddress] = None
