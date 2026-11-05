// Phân tích khả năng khôi phục (chỉ đọc). DATABASE_URL=... node scripts/analyze_recovery.js
const { Client } = require('pg');
const OLD = 'xlaqupbqiwpoprywnkgi';
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;

  const names = new Set((await q(`SELECT name FROM storage.objects WHERE bucket_id='uploads'`)).map(r => r.name));
  const fileOf = u => decodeURIComponent(u.split('/').pop().split('?')[0]);
  const re = new RegExp(`https://${OLD}\\.supabase\\.co/storage/v1/object/public/[^"'\\s)<>]+`, 'g');

  // 1. Mọi URL cũ -> có sẵn trong bucket mới không?
  const urls = new Map(); // url -> nơi dùng
  const add = (u, where) => { if (!urls.has(u)) urls.set(u, []); urls.get(u).push(where); };
  for (const r of await q(`SELECT id, cover_url u FROM stories WHERE cover_url LIKE $1`, [`%${OLD}%`])) add(r.u, `stories.cover#${r.id}`);
  for (const r of await q(`SELECT id, avatar u FROM users WHERE avatar LIKE $1`, [`%${OLD}%`])) add(r.u, `users.avatar#${r.id}`);
  for (const r of await q(`SELECT id, equipped_avatar u FROM users WHERE equipped_avatar LIKE $1`, [`%${OLD}%`])) add(r.u, `users.equipped#${r.id}`);
  for (const r of await q(`SELECT id, value u, name FROM shop_items WHERE value LIKE $1`, [`%${OLD}%`])) add(r.u, `shop_items#${r.id}(${r.name})`);
  for (const r of await q(`SELECT id, story_id, chapter_number, content FROM chapters WHERE content LIKE $1`, [`%${OLD}%`]))
    for (const m of r.content.match(re) || []) add(m, `chapter s${r.story_id} #${r.chapter_number}`);

  let have = 0, miss = 0; const missing = [];
  for (const [u, w] of urls) { if (names.has(fileOf(u))) have++; else { miss++; missing.push([u, w]); } }
  console.log(`URL cũ khác nhau: ${urls.size} | đã có trong bucket mới: ${have} | thật sự mất: ${miss}`);
  const byKind = {};
  for (const [, w] of missing) for (const x of w) { const k = x.split('#')[0].split(' ')[0]; byKind[k] = (byKind[k] || 0) + 1; }
  console.log('Vị trí dùng ảnh mất:', byKind);
  console.log('Ví dụ ảnh mất trong chương:'); console.table(missing.filter(m => m[1][0].startsWith('chapter')).slice(0, 8).map(m => ({ url: m[0].slice(-45), dung: m[1][0] })));

  // 2. Truyện có source_url
  console.log('\n== Truyện có source_url (cover mất) ==');
  console.table(await q(`SELECT id, title, story_type, source_url FROM stories WHERE cover_url LIKE $1 AND source_url IS NOT NULL ORDER BY id`, [`%${OLD}%`]));
  console.log('Tổng truyện có source_url:', (await q(`SELECT count(*)::int n FROM stories WHERE source_url IS NOT NULL`))[0].n, '/', (await q(`SELECT count(*)::int n FROM stories`))[0].n);

  // 3. Chương thiếu (khoảng trống số chương) ở các truyện
  console.log('\n== Truyện có khoảng trống chương (thiếu) ==');
  console.table(await q(`
    SELECT s.id, s.title, s.story_type, (s.source_url IS NOT NULL) AS co_nguon, count(*)::int AS co, max(c.chapter_number)::int AS max_chap,
           (max(c.chapter_number)::int - count(*)::int) AS thieu_uoc_tinh
    FROM chapters c JOIN stories s ON s.id=c.story_id GROUP BY s.id HAVING max(c.chapter_number) - count(*) > 0
    ORDER BY thieu_uoc_tinh DESC LIMIT 40`));

  // 4. Chương rỗng / quá ngắn
  console.log('== Chương rỗng/ngắn (<200 ký tự) theo truyện ==');
  console.table(await q(`SELECT s.id, s.title, count(*)::int AS n FROM chapters c JOIN stories s ON s.id=c.story_id
    WHERE c.content IS NULL OR length(c.content) < 200 GROUP BY s.id,s.title ORDER BY n DESC LIMIT 20`));
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
