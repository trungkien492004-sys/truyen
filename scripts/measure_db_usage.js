// Đo dung lượng Supabase (chỉ đọc). Chạy: DATABASE_URL=... node scripts/measure_db_usage.js
const { Client } = require('pg');

async function q(c, sql) {
  try { return (await c.query(sql)).rows; } catch (e) { return [{ error: e.message }]; }
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  console.log('== DB size ==');
  console.table(await q(c, "SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size"));

  console.log('== Top 15 bảng (tổng / data / index) ==');
  console.table(await q(c, `
    SELECT relname AS bang,
           pg_size_pretty(pg_total_relation_size(relid)) AS tong,
           pg_size_pretty(pg_relation_size(relid)) AS data,
           pg_size_pretty(pg_indexes_size(relid)) AS idx,
           n_live_tup AS so_dong
    FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 15`));

  console.log('== story_views ==');
  console.table(await q(c, `SELECT count(*) AS tong, min(created_at) AS cu_nhat, max(created_at) AS moi_nhat,
    count(*) FILTER (WHERE created_at < now() - interval '30 days') AS cu_hon_30_ngay,
    count(*) FILTER (WHERE created_at < now() - interval '365 days') AS cu_hon_1_nam FROM story_views`));

  console.log('== Storage (schema storage.objects) ==');
  console.table(await q(c, `SELECT bucket_id, count(*) AS so_file,
    pg_size_pretty(sum(COALESCE((metadata->>'size')::bigint,0))) AS tong
    FROM storage.objects GROUP BY bucket_id ORDER BY sum(COALESCE((metadata->>'size')::bigint,0)) DESC`));

  console.log('== Chapters: tổng độ dài content ==');
  console.table(await q(c, `SELECT count(*) AS so_chuong, pg_size_pretty(sum(octet_length(content))::bigint) AS tong_content FROM chapters`));

  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
