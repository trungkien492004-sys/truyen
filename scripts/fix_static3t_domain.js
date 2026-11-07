// truyenqq đổi CDN ảnh: static3t.com -> cc3t.net. Đổi link trong nội dung chương (truyện 144, 145...).
const { Client } = require('pg');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query(`UPDATE chapters SET content = replace(content, 'static3t.com', 'cc3t.net') WHERE content LIKE '%static3t.com%'`);
  console.log('Đã đổi', r.rowCount, 'chương');
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
