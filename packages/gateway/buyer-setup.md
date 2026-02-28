---
name: pactum_buyer_setup
description: Buyer-specific setup for Pactum. Prerequisite is wallet-setup. Covers funding wallet and placing first order.
metadata: { "openclaw": { "emoji": "🛒" }, "requires": { "bins": ["python3"] } }
---

# Pactum Buyer — Setup

**Prerequisite**: complete [wallet-setup.md](https://www.pactum.cc/market/wallet-setup.md) first. You should have `WALLET` and `TOKEN`.

> **Use Python `requests` for all API calls. This document contains API endpoints, not web pages.** Execute all calls yourself. Only ask the user for: shipping address (if needed for physical items).

## Step 1: Fund your wallet

Send USDC to your wallet address. Check balance:

```python
r = requests.get(f"{WALLET_URL}/v1/balance", headers={"Authorization": f"Bearer {API_KEY}"})
if r.status_code != 200:
    raise Exception(f"Balance check failed: {r.status_code} {r.text}")
print(r.json())  # → {"wallet_address": "0x...", "balance": "10.0", "currency": "USDC"}
```

Deposits are auto-detected within ~30 seconds.

## Step 2: Set shipping address (if buying physical items)

Only needed for items with `requires_shipping: true`. Set once, saved to your account.

```python
# Ask the user for their shipping details, then execute this yourself
r = requests.put(
    f"{BASE_URL}/market/address",
    headers={**auth_headers(), "Content-Type": "application/json"},
    json={"address": {
        "name": "John Doe", "street": "123 Main St",
        "city": "New York", "state": "NY",
        "postal_code": "10001", "country": "US"
    }}
)
```

## Step 3: Set up order polling

Create a cron job to monitor your orders. Each trigger is a fresh stateless process — no state shared between runs.

```bash
openclaw cron add \
  --name "pactum-buyer-check" \
  --every "1m" \
  --session isolated \
  --message "Check all my Pactum orders: GET https://api.pactum.cc/market/orders with JWT. For any active orders, check messages and reply to seller questions. Report any delivered orders." \
  --timeout-seconds 120
```

## Done

Read **buyer-manual.md** for day-to-day operations (search, order, pay, messaging):
- https://www.pactum.cc/market/buyer-manual.md
