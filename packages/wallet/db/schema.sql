-- =============================================
-- Pactum Wallet — DB Schema（5 张表）
-- Supabase Dashboard → SQL Editor 执行
-- =============================================

-- 1. wallet_users: 用户 + 钱包 + 限额
CREATE TABLE IF NOT EXISTS wallet_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    api_key_hash TEXT NOT NULL,
    privy_wallet_id TEXT UNIQUE NOT NULL,
    wallet_address TEXT UNIQUE NOT NULL,            -- EOA (Privy)
    smart_account_address TEXT UNIQUE,              -- ERC-4337 Smart Account
    smart_account_deployed BOOLEAN DEFAULT FALSE,   -- 是否已部署（首次 UserOp 部署）
    per_transaction_limit DECIMAL(12,2) DEFAULT 10.00,
    daily_limit DECIMAL(12,2) DEFAULT 50.00,
    require_confirmation_above DECIMAL(12,2) DEFAULT 5.00,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. wallet_verification_codes: 邮箱验证码（5min 过期）
CREATE TABLE IF NOT EXISTS wallet_verification_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. wallet_transactions: 交易记录
CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES wallet_users(id),
    type TEXT NOT NULL CHECK (type IN ('deposit', 'payment', 'withdrawal', 'escrow_deposit')),
    amount DECIMAL(12,6) NOT NULL,
    from_address TEXT,
    to_address TEXT,
    memo TEXT,
    tx_hash TEXT UNIQUE,
    user_op_hash TEXT,                              -- ERC-4337 UserOp hash
    status TEXT DEFAULT 'completed',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. wallet_pending_payments: 大额待确认（10min 过期）
CREATE TABLE IF NOT EXISTS wallet_pending_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES wallet_users(id),
    to_address TEXT NOT NULL,
    amount DECIMAL(12,6) NOT NULL,
    memo TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. wallet_events: Agent 轮询事件
CREATE TABLE IF NOT EXISTS wallet_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES wallet_users(id),
    type TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ========== 索引 ==========

CREATE INDEX IF NOT EXISTS idx_wallet_users_email ON wallet_users(email);
CREATE INDEX IF NOT EXISTS idx_wallet_users_address ON wallet_users(wallet_address);
CREATE INDEX IF NOT EXISTS idx_wallet_users_smart_account ON wallet_users(smart_account_address);
CREATE INDEX IF NOT EXISTS idx_wallet_verification_codes_email ON wallet_verification_codes(email);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_hash ON wallet_transactions(tx_hash);
CREATE INDEX IF NOT EXISTS idx_wallet_pending_payments_user ON wallet_pending_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_pending_payments_status ON wallet_pending_payments(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_wallet_events_user ON wallet_events(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_events_created ON wallet_events(user_id, created_at);

-- ========== updated_at 触发器 ==========
-- 复用 gateway 已有的 update_updated_at_column 函数，如果不存在则创建

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS wallet_users_updated_at ON wallet_users;
CREATE TRIGGER wallet_users_updated_at
    BEFORE UPDATE ON wallet_users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ========== RLS ==========

ALTER TABLE wallet_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_verification_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_pending_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_events ENABLE ROW LEVEL SECURITY;

-- service_role 完全访问
CREATE POLICY wallet_users_service ON wallet_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY wallet_verification_codes_service ON wallet_verification_codes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY wallet_transactions_service ON wallet_transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY wallet_pending_payments_service ON wallet_pending_payments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY wallet_events_service ON wallet_events FOR ALL USING (true) WITH CHECK (true);

-- ========== ERC-4337 迁移（已有表执行） ==========
-- ALTER TABLE wallet_users ADD COLUMN IF NOT EXISTS smart_account_address TEXT UNIQUE;
-- ALTER TABLE wallet_users ADD COLUMN IF NOT EXISTS smart_account_deployed BOOLEAN DEFAULT FALSE;
-- ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS user_op_hash TEXT;
-- ALTER TABLE wallet_transactions DROP CONSTRAINT IF EXISTS wallet_transactions_type_check;
-- ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_type_check CHECK (type IN ('deposit', 'payment', 'withdrawal', 'escrow_deposit'));
-- CREATE INDEX IF NOT EXISTS idx_wallet_users_smart_account ON wallet_users(smart_account_address);
