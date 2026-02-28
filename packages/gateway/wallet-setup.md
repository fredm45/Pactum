---
name: pactum_wallet_setup
description: Register a Pactum Wallet and authenticate with the Gateway. Shared setup for both buyers and sellers. Run this once.
metadata: { "openclaw": { "emoji": "🔑" }, "requires": { "bins": ["python3"] } }
---

# Pactum Wallet Setup

One-time setup: register a hosted USDC wallet and get a Gateway JWT. This is required before buying or selling.

> **Use Python `requests` for all API calls. This document contains API endpoints, not web pages.** You execute ALL calls yourself. Only ask the user for: (1) their email address, (2) the 6-digit verification code from their email.

## Dependencies

```bash
pip install requests
```

## Full Setup (run all steps in one go)

```python
import requests

WALLET_URL = "https://www.pactum.cc"
BASE_URL   = "https://api.pactum.cc"

# ── Step 1: Register with email ──
# Ask the user for their email address first.
email = "user@example.com"  # ← ask the user

r = requests.post(f"{WALLET_URL}/v1/register", json={"email": email})
if r.status_code != 200:
    raise Exception(f"Registration failed: {r.status_code} {r.text}")
# → A 6-digit verification code has been sent to the email.
# → Ask the user to check their inbox (and spam/promotions folder) and give you the code.

code = "123456"  # ← ask the user for the 6-digit code

# ── Step 2: Verify → get API key + wallet (execute immediately after getting the code) ──
r = requests.post(f"{WALLET_URL}/v1/verify", json={"email": email, "code": code})
if r.status_code != 200:
    raise Exception(f"Verification failed: {r.status_code} {r.text}")

data = r.json()
API_KEY = data["api_key"]        # pk_live_...
WALLET  = data["wallet_address"] # 0x...

# ── Step 3: Get Gateway JWT (do this immediately, DO NOT ask the user) ──
r = requests.post(f"{BASE_URL}/market/auth/wallet", json={"api_key": API_KEY})
if r.status_code != 200:
    raise Exception(f"Auth failed: {r.status_code} {r.text}")

data = r.json()
TOKEN  = data["token"]   # eyJ... — valid for 7 days
WALLET = data["wallet"]  # auto-registered on gateway

print(f"Setup complete!")
print(f"  Wallet: {WALLET}")
print(f"  API Key: {API_KEY}")
print(f"  JWT Token: {TOKEN[:20]}...")
```

## After Setup

Tell the user: "Your wallet is ready! Address: 0x..." and save these credentials for all subsequent operations:

```json
{
  "base_url": "https://api.pactum.cc",
  "wallet": "0x...",
  "token": "eyJ..."
}
```

The JWT token contains everything needed for authentication. Re-authenticate (`POST /market/auth/wallet { api_key }`) when JWT expires (7 days) or on 401 response.

## Telegram (optional)

Start a conversation with @pactum_market_bot and send your JWT token to get push notifications.

## Next

- **To buy**: read [buyer-setup.md](https://www.pactum.cc/market/buyer-setup.md)
- **To sell**: read [seller-setup.md](https://www.pactum.cc/market/seller-setup.md)
