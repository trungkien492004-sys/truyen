// Chuyển toàn bộ ảnh từ Supabase Storage (project hiện tại) sang Cloudflare R2, rồi đổi link trong DB.
// KHÔNG nén, KHÔNG xóa gì trên Supabase (xóa là bước riêng, làm tay sau khi kiểm tra).
//
// Cần trong .env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
// Chạy:
//   DATABASE_URL=... node scripts/migrate_images_to_r2.js            # báo cáo (không ghi gì)
//   DATABASE_URL=... node scripts/migrate_images_to_r2.js --copy     # copy ảnh sang R2 (chạy lại được, bỏ qua file đã có)
//   DATABASE_URL=... node scripts/migrate_images_to_r2.js --rewrite  # đổi link trong DB (chỉ sau khi --copy xong và đã mở thử vài ảnh)
const { Client } = require('pg');
const { HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { r2Client, R2_READY, publicUrlFor } = require('../services/storage');

const SB_PREFIX = `${process.env.SUPABASE_URL.replace(/\/+$/, '')}/storage/v1/object/public/uploads/`;
const COPY = process.argv.includes('--copy');
const REWRITE = process.argv.includes('--rewrite');

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

(async () => {
  if (!R2_READY) { console.error('Thiếu biến R2_* trong .env (xem hướng dẫn). Dừng.'); process.exit(1); }
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const R2_PREFIX = publicUrlFor('');

  const { rows: objs } = await c.query(
    `SELECT name, COALESCE((metadata->>'size')::bigint,0) AS size FROM storage.objects WHERE bucket_id='uploads' AND name !~ '^(test|anon_test)'`);
  const totalMB = objs.reduce((a, o) => a + Number(o.size), 0) / 1e6;
  console.log(`Supabase Storage: ${objs.length} file, ${totalMB.toFixed(0)}MB`);

  if (COPY) {
    let copied = 0, skipped = 0, failed = 0;
    await pool(objs, 8, async o => {
      try {
        try { await r2Client().send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET, Key: o.name })); skipped++; return; } catch { /* chưa có */ }
        const res = await fetch(SB_PREFIX + encodeURIComponent(o.name).replace(/%2F/g, '/'));
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const body = Buffer.from(await res.arrayBuffer());
        await r2Client().send(new PutObjectCommand({
          Bucket: process.env.R2_BUCKET, Key: o.name, Body: body,
          ContentType: res.headers.get('content-type') || 'application/octet-stream',
          CacheControl: 'public, max-age=31536000, immutable'
        }));
        copied++;
        if ((copied + skipped) % 200 === 0) console.log(`  ...${copied + skipped}/${objs.length}`);
      } catch (e) { failed++; console.error(`  LỖI ${o.name}: ${e.message}`); }
    });
    console.log(`Copy xong: mới ${copied}, đã có ${skipped}, lỗi ${failed}`);
  }

  // Các cột text chứa link Supabase Storage
  const cols = (await c.query(`SELECT table_name t, column_name col, data_type dt FROM information_schema.columns
    WHERE table_schema='public' AND data_type IN ('text','character varying','ARRAY')
    AND table_name NOT IN (SELECT table_name FROM information_schema.views WHERE table_schema='public')`)).rows;
  const like = `%${SB_PREFIX}%`;
  for (const { t, col, dt } of cols) {
    const n = (await c.query(`SELECT count(*)::int n FROM "${t}" WHERE "${col}"::text LIKE $1`, [like])).rows[0].n;
    if (!n) continue;
    if (!REWRITE) { console.log(`[báo cáo] ${t}.${col}: ${n} dòng chứa link Supabase`); continue; }
    const sql = dt === 'ARRAY'
      ? `UPDATE "${t}" SET "${col}" = ARRAY(SELECT replace(x, $1, $2) FROM unnest("${col}") x) WHERE "${col}"::text LIKE $3`
      : `UPDATE "${t}" SET "${col}" = replace("${col}", $1, $2) WHERE "${col}" LIKE $3`;
    const r = await c.query(sql, [SB_PREFIX, R2_PREFIX, like]);
    console.log(`[đã đổi] ${t}.${col}: ${r.rowCount} dòng`);
  }
  await c.end();
})().catch(e => { console.error('LỖI:', e.message); process.exit(1); });
