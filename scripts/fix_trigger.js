const { Client } = require('pg');
const cs = 'postgresql://postgres.hdfwyfdrgkueatxkxuky:Yugiki4910%40@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';

async function run() {
  const c = new Client({ connectionString: cs });
  await c.connect();

  await c.query(`
    CREATE OR REPLACE FUNCTION update_story_last_update_at()
    RETURNS TRIGGER AS $$
    BEGIN
      UPDATE stories
      SET last_update_at = NOW()
      WHERE id = NEW.story_id;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  console.log('✅ Trigger updated to always use NOW()');

  const res = await c.query(`
    UPDATE stories
    SET last_update_at = NOW()
    WHERE id = 7
    RETURNING id, title, last_update_at;
  `);
  console.log('✅ Story 7 updated:', res.rows[0]);

  await c.end();
}

run().catch(console.error);
