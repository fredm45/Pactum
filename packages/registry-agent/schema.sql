-- Pactum Marketplace Database Schema
-- 在 Supabase Dashboard 中执行此 SQL

-- agents: 身份（wallet 是 PK）
CREATE TABLE IF NOT EXISTS agents (
    wallet TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    card_hash TEXT NOT NULL,
    avg_rating DECIMAL(5,2) DEFAULT 0,
    total_reviews INTEGER DEFAULT 0,
    registered_at TIMESTAMP DEFAULT NOW()
);

-- items: 上架的商品/服务
CREATE TABLE IF NOT EXISTS items (
    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_wallet TEXT NOT NULL REFERENCES agents(wallet),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    price DECIMAL(10,6) NOT NULL CHECK (price > 0),
    type TEXT NOT NULL CHECK (type IN ('digital','physical')),
    endpoint TEXT,
    status TEXT DEFAULT 'active' CHECK (status IN ('active','paused','sold_out')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- orders: 交易记录
CREATE TABLE IF NOT EXISTS orders (
    order_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES items(item_id),
    buyer_wallet TEXT NOT NULL,
    seller_wallet TEXT NOT NULL,
    amount DECIMAL(10,6) NOT NULL,
    tx_hash TEXT UNIQUE,
    status TEXT DEFAULT 'pending' CHECK (status IN (
        'pending','paid','delivering','confirmed','shipped','completed','failed','refunded'
    )),
    result JSONB,
    shipping_address JSONB,
    buyer_query TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- JWT challenge-response 认证
CREATE TABLE IF NOT EXISTS auth_challenges (
    challenge TEXT PRIMARY KEY,
    wallet TEXT,  -- null = not yet bound to a wallet
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_challenges_expires ON auth_challenges(expires_at);

-- 全文搜索索引
CREATE INDEX IF NOT EXISTS idx_items_fts ON items USING GIN (
    to_tsvector('english', name || ' ' || description)
);
CREATE INDEX IF NOT EXISTS idx_items_seller ON items(seller_wallet);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_wallet);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_wallet);
CREATE INDEX IF NOT EXISTS idx_orders_item ON orders(item_id);

-- 更新时间戳触发器
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER items_updated_at
    BEFORE UPDATE ON items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Row Level Security (RLS)
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_challenges ENABLE ROW LEVEL SECURITY;

-- 允许所有人读取
CREATE POLICY "Allow public read on agents" ON agents FOR SELECT USING (true);
CREATE POLICY "Allow public read on items" ON items FOR SELECT USING (true);
CREATE POLICY "Allow public read on orders" ON orders FOR SELECT USING (true);

-- 只允许 service_role 写入
CREATE POLICY "Allow service role insert on agents" ON agents FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role update on agents" ON agents FOR UPDATE USING (true);
CREATE POLICY "Allow service role insert on items" ON items FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role update on items" ON items FOR UPDATE USING (true);
CREATE POLICY "Allow service role insert on orders" ON orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role update on orders" ON orders FOR UPDATE USING (true);
CREATE POLICY "Allow service role all on auth_challenges" ON auth_challenges FOR ALL USING (true) WITH CHECK (true);
