"""
Pactum Gateway 配置 — 环境变量 + 常量
"""
import os
from dotenv import load_dotenv

load_dotenv()

# Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

# 区块链
BASE_RPC_URL = os.getenv("BASE_RPC_URL", "")
PACTUM_AGENT_CONTRACT_ADDRESS = os.getenv("PACTUM_AGENT_CONTRACT_ADDRESS", "")

# Escrow
ESCROW_CONTRACT_ADDRESS = os.getenv("ESCROW_CONTRACT_ADDRESS", "0xc61ec6B42ada753A952Edf1F3E6416502682F720")
USDC_CONTRACT_ADDRESS = os.getenv("USDC_CONTRACT_ADDRESS", "0x036CbD53842c5426634e7929541eC2318f3dCF7e")
PAYMASTER_URL = os.getenv("PAYMASTER_URL", "")

# JWT
JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
JWT_TTL_HOURS = 24 * 7  # 7 days
CHALLENGE_TTL_MINUTES = 5

# Resend (admin email verification)
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
ADMIN_FROM_EMAIL = os.getenv("ADMIN_FROM_EMAIL", "admin@pactum.cc")

# Wallet Service
WALLET_SERVICE_URL = os.getenv("WALLET_SERVICE_URL", "http://localhost:8001")

# 服务
PORT = int(os.getenv("PORT", 8000))
PUBLIC_URL = os.getenv("PUBLIC_URL", "https://api.pactum.cc")
PROTOCOL_VERSION = "3.0.0"
