"""
Seedance Service 配置
"""
import os
from dotenv import load_dotenv

load_dotenv()

PACTUM_API_URL = os.getenv("PACTUM_API_URL", "https://api.pactum.cc")
WALLET_API_KEY = os.getenv("WALLET_API_KEY", "")
PORT = int(os.getenv("PORT", 8002))
