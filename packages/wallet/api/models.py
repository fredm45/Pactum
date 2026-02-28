"""
Pydantic 请求/响应模型
"""
from decimal import Decimal
from pydantic import BaseModel, EmailStr, Field


# ===== Registration =====

class RegisterRequest(BaseModel):
    email: EmailStr


class VerifyRequest(BaseModel):
    email: EmailStr
    code: str = Field(..., min_length=6, max_length=6)


# ===== Payment =====

class PayRequest(BaseModel):
    to: str = Field(..., description="Destination wallet address")
    amount: Decimal = Field(..., gt=0, description="USDC amount")
    memo: str | None = None


class WithdrawRequest(BaseModel):
    to: str = Field(..., description="External wallet address")
    amount: Decimal = Field(..., gt=0, description="USDC amount")
    memo: str | None = None


# ===== Escrow =====

class EscrowDepositRequest(BaseModel):
    escrow_contract: str = Field(..., description="Escrow contract address")
    usdc_contract: str = Field(..., description="USDC contract address")
    order_id_bytes32: str = Field(..., description="bytes32 order ID hex (0x...)")
    seller: str = Field(..., description="Seller wallet address")
    amount: Decimal = Field(..., gt=0, description="USDC amount (human-readable)")


# ===== Settings =====

class UpdateSettingsRequest(BaseModel):
    per_transaction_limit: Decimal | None = Field(None, gt=0)
    daily_limit: Decimal | None = Field(None, gt=0)
    require_confirmation_above: Decimal | None = Field(None, gt=0)


# ===== Contract Call =====

class ContractCallRequest(BaseModel):
    contract_address: str = Field(..., description="Target contract address")
    calldata: str = Field(..., description="ABI-encoded calldata (0x...)")
