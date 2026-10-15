const { Client } = require('pg');

const cs = 'postgresql://postgres.hdfwyfdrgkueatxkxuky:Yugiki4910%40@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';
const client = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });

async function run() {
  await client.connect();
  console.log('Connected to Supabase PostgreSQL!');

  await client.query(`
    ALTER TABLE arena_ranks ADD COLUMN IF NOT EXISTS dungeon_stage INT NOT NULL DEFAULT 1;
  `);
  console.log('Verified column dungeon_stage in arena_ranks.');

  await client.query(`
    CREATE TABLE IF NOT EXISTS user_card_quests (
      id SERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      quest_date DATE NOT NULL DEFAULT CURRENT_DATE,
      read_chapters INT NOT NULL DEFAULT 0,
      battles_fought INT NOT NULL DEFAULT 0,
      stages_cleared INT NOT NULL DEFAULT 0,
      chests_opened INT NOT NULL DEFAULT 0,
      claimed_quests JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, quest_date)
    );
  `);
  console.log('Verified table user_card_quests.');

  await client.end();
  console.log('Migration completed successfully!');
}

run().catch(err => {
  console.error('Migration error:', err);
  client.end();
  process.exit(1);
});
