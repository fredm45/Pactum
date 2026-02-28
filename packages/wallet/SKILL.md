# Pactum Wallet — Agent Skill

You have access to a hosted USDC wallet. Use it to send payments, receive deposits, and pay into Escrow — all without managing private keys.

Base URL: `https://www.pactum.cc`

## Authentication

All authenticated endpoints require: `Authorization: Bearer pk_live_xxx`

## Quick Start

1. **Register** — get a wallet by verifying your email:
```
POST /v1/register
{"email": "agent@example.com"}
→ Verification code sent to email

POST /v1/verify
{"email": "agent@example.com", "code": "123456"}
→ {"api_key": "pk_live_...", "wallet_address": "0x...", "email": "..."}
```

2. **Check balance**:
```
GET /v1/balance
→ {"wallet_address": "0x...", "balance": "10.5", "currency": "USDC", "network": "testnet"}
```

3. **Send payment**:
```
POST /v1/pay
{"to": "0xRecipient...", "amount": 2.5, "memo": "Order #123"}
→ {"status": "completed", "tx_hash": "0x...", "from": "0x...", "to": "0x...", "amount": "2.5"}
```

If the amount exceeds your confirmation threshold (default 5 USDC), you'll get:
```
→ {"status": "pending_confirmation", "payment_id": "uuid", "expires_at": "..."}

POST /v1/pay/{payment_id}/confirm  → executes payment
POST /v1/pay/{payment_id}/cancel   → cancels payment
```

4. **Escrow deposit** (for marketplace orders):
```
POST /v1/escrow-deposit
{
  "escrow_contract": "0xc61ec6B42ada753A952Edf1F3E6416502682F720",
  "usdc_contract": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "order_id_bytes32": "0x...",
  "seller": "0xSellerAddress...",
  "amount": 0.01
}
→ {"status": "completed", "approve_tx": "0x...", "deposit_tx": "0x...", "from": "0x...", ...}
```

This sends two transactions: approve USDC → deposit into Escrow. The `deposit_tx` is what you submit as payment proof.

5. **Withdraw to external wallet**:
```
POST /v1/withdraw
{"to": "0xExternal...", "amount": 5.0}
```

6. **Poll for events** (deposits, payments, etc.):
```
GET /v1/events?since=2024-01-01T00:00:00Z
→ {"events": [{"type": "deposit_received", "data": {"from": "0x...", "amount": 1.0, "tx_hash": "0x..."}, "created_at": "..."}]}
```

7. **View transaction history**:
```
GET /v1/transactions?limit=20
```

8. **Manage limits**:
```
GET /v1/settings
PATCH /v1/settings
{"per_transaction_limit": 20, "daily_limit": 100, "require_confirmation_above": 10}
```

9. **Regenerate API key** (invalidates old one):
```
POST /v1/api-key/regenerate
→ {"api_key": "pk_live_new..."}
```

## Deposit Detection

When USDC is sent to your wallet address, it's automatically detected within ~30 seconds. Check via:
- `GET /v1/events?since=...` — look for `deposit_received` events
- `GET /v1/balance` — check updated balance

## Limits

| Setting | Default | Description |
|---------|---------|-------------|
| per_transaction_limit | 10 USDC | Max per single payment |
| daily_limit | 50 USDC | Max total per day |
| require_confirmation_above | 5 USDC | Payments above this need confirmation |
