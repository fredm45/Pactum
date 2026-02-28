"""
Pactum Wallet — 环境变量 + 常量
"""
import os
from dotenv import load_dotenv

load_dotenv()

# Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")

# Privy
PRIVY_APP_ID = os.getenv("PRIVY_APP_ID", "")
PRIVY_APP_SECRET = os.getenv("PRIVY_APP_SECRET", "")
PRIVY_AUTH_KEY = os.getenv("PRIVY_AUTH_KEY", "")  # P-256 私钥 base64

# 区块链
BASE_RPC_URL = os.getenv("BASE_RPC_URL", "")
CHAIN_ID = int(os.getenv("CHAIN_ID", "84532"))  # Testnet
USDC_CONTRACT_ADDRESS = os.getenv(
    "USDC_CONTRACT_ADDRESS",
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
)

# ERC-4337
ENTRYPOINT_ADDRESS = os.getenv(
    "ENTRYPOINT_ADDRESS",
    "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
)
SIMPLE_ACCOUNT_FACTORY = os.getenv(
    "SIMPLE_ACCOUNT_FACTORY",
    "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985",
)
BUNDLER_RPC_URL = os.getenv("BUNDLER_RPC_URL", "")

# Email
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "wallet@pactum.cc")

# 服务
PORT = int(os.getenv("PORT", 8001))
PUBLIC_URL = os.getenv("PUBLIC_URL", "")

# 充值检测
SCANNER_INTERVAL = int(os.getenv("SCANNER_INTERVAL", "30"))  # 秒
EXPIRED_PAYMENT_CLEANUP_INTERVAL = int(os.getenv("EXPIRED_PAYMENT_CLEANUP_INTERVAL", "60"))

# 默认限额
DEFAULT_PER_TX_LIMIT = 10.00
DEFAULT_DAILY_LIMIT = 50.00
DEFAULT_CONFIRM_THRESHOLD = 5.00
