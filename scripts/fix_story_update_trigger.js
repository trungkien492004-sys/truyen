const { Client } = require('pg');
const cs = 'postgresql://postgres.hdfwyfdrgkueatxkxuky:Yugiki4910%40@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';

async function run() {
  const c = new Client({ connectionString: cs });
  await c.connect();

  console.log('1. Dropping existing triggers on chapters table...');
  await c.query('DROP TRIGGER IF EXISTS trg_auto_update_story_time ON chapters');
  await c.query('DROP TRIGGER IF EXISTS trg_update_story_last_update_at ON chapters');

  console.log('2. Creating trigger ONLY for INSERT and DELETE (NEVER for UPDATE)...');
  await c.query(`
    CREATE TRIGGER trg_auto_update_story_time
    AFTER INSERT OR DELETE ON chapters
    FOR EACH ROW
    EXECUTE FUNCTION update_story_last_update_at();
  `);
  console.log('Trigger created successfully.');

  console.log('3. Recalculating last_update_at for all stories based on actual latest chapter...');
  const res = await c.query(`
    UPDATE stories s
    SET last_update_at = COALESCE(
      (SELECT MAX(c.created_at) FROM chapters c WHERE c.story_id = s.id),
      s.created_at
    );
  `);
  console.log('Updated rows:', res.rowCount);

  console.log('4. Top 10 stories by last_update_at now:');
  const top = await c.query(`
    SELECT id, title, last_update_at
    FROM stories
    ORDER BY last_update_at DESC
    LIMIT 10;
  `);
  console.table(top.rows);

  await c.end();
}

run().catch(console.error);
