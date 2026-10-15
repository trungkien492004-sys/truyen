const { Client } = require('C:/Users/Kien/.gemini/antigravity/scratch/truyen/node_modules/pg');

const cs = 'postgresql://postgres.hdfwyfdrgkueatxkxuky:Yugiki4910%40@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';

const schemaSql = `
-- 1. Bảng Nữ Tướng (Admin tạo)
CREATE TABLE IF NOT EXISTS card_heroes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    title VARCHAR(150),
    bio TEXT,
    rarity VARCHAR(10) NOT NULL DEFAULT 'SR', -- R, SR, SSR, UR
    element VARCHAR(20) NOT NULL DEFAULT 'fire', -- fire, water, wind, thunder, dark, light
    role VARCHAR(20) NOT NULL DEFAULT 'dps', -- dps, tank, healer, support
    base_hp INT NOT NULL DEFAULT 1000,
    base_atk INT NOT NULL DEFAULT 200,
    base_def INT NOT NULL DEFAULT 80,
    base_spd INT NOT NULL DEFAULT 100,
    base_crit NUMERIC(5,2) NOT NULL DEFAULT 10.0,
    avatar_url TEXT,
    card_image_url TEXT NOT NULL,
    skill_basic JSONB NOT NULL DEFAULT '{"name":"Đánh Thường","desc":"Tấn công 1 mục tiêu, hồi 25 Nộ","dmg_rate":1.0,"rage_gain":25,"target":"single"}',
    skill_ultimate JSONB NOT NULL DEFAULT '{"name":"Tuyệt Kỹ","desc":"Tiêu hao 100 Nộ. Gây sát thương lớn lên toàn bộ kẻ địch","dmg_rate":2.2,"rage_cost":100,"target":"all"}',
    skill_passive JSONB NOT NULL DEFAULT '{"name":"Nội Tại","desc":"Tăng 10% Công và 10% Máu"}',
    shards_to_summon INT NOT NULL DEFAULT 30,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Bảng Tướng Người Chơi Sở Hữu
CREATE TABLE IF NOT EXISTS user_heroes (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hero_id INT NOT NULL REFERENCES card_heroes(id) ON DELETE CASCADE,
    shards INT NOT NULL DEFAULT 0,
    is_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
    level INT NOT NULL DEFAULT 1,
    exp INT NOT NULL DEFAULT 0,
    star INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, hero_id)
);

-- 3. Bảng Đội Hình 3 Nữ Tướng Ra Trận
CREATE TABLE IF NOT EXISTS user_card_teams (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    slot_1 INT REFERENCES card_heroes(id) ON DELETE SET NULL,
    slot_2 INT REFERENCES card_heroes(id) ON DELETE SET NULL,
    slot_3 INT REFERENCES card_heroes(id) ON DELETE SET NULL,
    combat_power INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Bảng Xếp Hạng Đấu Trường (Arena Rank)
CREATE TABLE IF NOT EXISTS arena_ranks (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    elo_points INT NOT NULL DEFAULT 1000,
    tier VARCHAR(30) NOT NULL DEFAULT 'Đồng',
    wins INT NOT NULL DEFAULT 0,
    losses INT NOT NULL DEFAULT 0,
    win_streak INT NOT NULL DEFAULT 0,
    daily_tickets INT NOT NULL DEFAULT 5,
    last_ticket_reset TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Bảng Túi Đồ & Hòm Quà
CREATE TABLE IF NOT EXISTS user_card_items (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    wooden_chests INT NOT NULL DEFAULT 2, -- tặng 2 hòm mở đầu trải nghiệm
    silver_chests INT NOT NULL DEFAULT 1,
    gold_chests INT NOT NULL DEFAULT 0,
    exp_pills INT NOT NULL DEFAULT 50,
    star_stones INT NOT NULL DEFAULT 5,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Bảng Nhật Ký Trận Đấu (Battle Logs)
CREATE TABLE IF NOT EXISTS arena_battle_logs (
    id SERIAL PRIMARY KEY,
    attacker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    defender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    winner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    elo_change INT NOT NULL DEFAULT 0,
    log_summary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tạo Index tăng tốc truy vấn
CREATE INDEX IF NOT EXISTS idx_card_heroes_rarity ON card_heroes(rarity);
CREATE INDEX IF NOT EXISTS idx_user_heroes_user ON user_heroes(user_id);
CREATE INDEX IF NOT EXISTS idx_arena_ranks_elo ON arena_ranks(elo_points DESC);
`;

async function migrate() {
  const client = new Client({ connectionString: cs });
  try {
    await client.connect();
    console.log('Connected to PostgreSQL database!');
    await client.query(schemaSql);
    console.log('Database tables for Card Game created successfully!');
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await client.end();
  }
}

migrate();
