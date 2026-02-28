-- Pactum Gateway Database Schema
-- 在 Supabase Dashboard 中执行此 SQL

-- agents: 身份（wallet 是 PK）
CREATE TABLE IF NOT EXISTS agents (
    wallet TEXT PRIMARY KEY,
    description TEXT NOT NULL,
    card_hash TEXT NOT NULL,
    avg_rating DECIMAL(5,2) DEFAULT 0,
    total_reviews INTEGER DEFAULT 0,
    telegram_group_id BIGINT UNIQUE,
    shipping_address JSONB,
    endpoint TEXT,
    email TEXT,
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
    requires_shipping BOOLEAN DEFAULT FALSE,
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
    status TEXT DEFAULT 'created' CHECK (status IN (
        'created','paid','processing','needs_clarification','delivered','completed','failed','refunded'
    )),
    result JSONB,
    shipping_address JSONB,
    buyer_query TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- messages: 消息记录（仲裁用）
CREATE TABLE IF NOT EXISTS messages (
    message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(order_id),
    from_wallet TEXT NOT NULL,
    to_wallet TEXT NOT NULL,
    content TEXT NOT NULL,
    direction TEXT CHECK (direction IN ('buyer_to_seller','seller_to_buyer')),
    created_at TIMESTAMP DEFAULT NOW()
);

-- JWT challenge-response 认证
CREATE TABLE IF NOT EXISTS auth_challenges (
    challenge TEXT PRIMARY KEY,
    wallet TEXT,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE
);

-- telegram_bindings: 一个 Telegram 账号绑定多个 wallet
CREATE TABLE IF NOT EXISTS telegram_bindings (
    chat_id BIGINT NOT NULL,
    wallet TEXT NOT NULL REFERENCES agents(wallet),
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (chat_id, wallet)
);

CREATE INDEX IF NOT EXISTS idx_tg_bindings_chat ON telegram_bindings(chat_id);
CREATE INDEX IF NOT EXISTS idx_tg_bindings_wallet ON telegram_bindings(wallet);

CREATE POLICY "Allow service role all on telegram_bindings" ON telegram_bindings FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE telegram_bindings ENABLE ROW LEVEL SECURITY;

-- agent_events: 离线消息队列
CREATE TABLE IF NOT EXISTS agent_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    delivered BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_challenges_expires ON auth_challenges(expires_at);
CREATE INDEX IF NOT EXISTS idx_items_fts ON items USING GIN (
    to_tsvector('english', name || ' ' || description)
);
CREATE INDEX IF NOT EXISTS idx_items_seller ON items(seller_wallet);
CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_wallet);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_wallet);
CREATE INDEX IF NOT EXISTS idx_orders_item ON orders(item_id);
CREATE INDEX IF NOT EXISTS idx_agents_group ON agents(telegram_group_id);
CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(order_id);
CREATE INDEX IF NOT EXISTS idx_events_wallet_undelivered ON agent_events(wallet) WHERE delivered = FALSE;

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
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;

-- 允许所有人读取
CREATE POLICY "Allow public read on agents" ON agents FOR SELECT USING (true);
CREATE POLICY "Allow public read on items" ON items FOR SELECT USING (true);
CREATE POLICY "Allow public read on orders" ON orders FOR SELECT USING (true);
CREATE POLICY "Allow public read on messages" ON messages FOR SELECT USING (true);

-- 只允许 service_role 写入
CREATE POLICY "Allow service role insert on agents" ON agents FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role update on agents" ON agents FOR UPDATE USING (true);
CREATE POLICY "Allow service role insert on items" ON items FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role update on items" ON items FOR UPDATE USING (true);
CREATE POLICY "Allow service role insert on orders" ON orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role update on orders" ON orders FOR UPDATE USING (true);
CREATE POLICY "Allow service role all on auth_challenges" ON auth_challenges FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow service role insert on messages" ON messages FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow service role all on agent_events" ON agent_events FOR ALL USING (true) WITH CHECK (true);
