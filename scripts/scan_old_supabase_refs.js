// Quét tham chiếu tới Supabase cũ (chỉ đọc). Chạy: DATABASE_URL=... node scripts/scan_old_supabase_refs.js
const { Client } = require('pg');
const OLD = 'xlaqupbqiwpoprywnkgi';

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = async (sql, p) => (await c.query(sql, p)).rows;

  // Mọi cột text trong schema public có chứa host cũ
  const cols = await q(`SELECT table_name, column_name, data_type FROM information_schema.columns
    WHERE table_schema='public' AND data_type IN ('text','character varying','ARRAY','json','jsonb')
    AND table_name NOT IN (SELECT table_name FROM information_schema.views WHERE table_schema='public')`);
  console.log('== Cột chứa link Supabase cũ ==');
  for (const { table_name: t, column_name: col } of cols) {
    const r = await q(`SELECT count(*)::int AS n FROM "${t}" WHERE "${col}"::text LIKE $1`, [`%${OLD}%`]);
    if (r[0].n > 0) console.log(`${t}.${col}: ${r[0].n} dòng`);
  }

  console.log('\n== Truyện có cover cũ ==');
  console.table(await q(`SELECT id, title, story_type, left(cover_url,90) AS cover FROM stories WHERE cover_url LIKE $1 ORDER BY id`, [`%${OLD}%`]));

  console.log('== Chương có ảnh cũ theo truyện ==');
  console.table(await q(`SELECT s.id, s.title, s.story_type, count(*)::int AS chuong_loi, min(c.chapter_number) AS tu, max(c.chapter_number) AS den
    FROM chapters c JOIN stories s ON s.id=c.story_id WHERE c.content LIKE $1 GROUP BY s.id,s.title,s.story_type ORDER BY 4 DESC`, [`%${OLD}%`]));

  console.log('== Cột của stories ==');
  console.log((await q(`SELECT column_name FROM information_schema.columns WHERE table_name='stories' ORDER BY ordinal_position`)).map(r => r.column_name).join(', '));
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
