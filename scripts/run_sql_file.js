// Chạy một file .sql lên DB. Dùng: DATABASE_URL=... node scripts/run_sql_file.js scripts/xxx.sql
const { Client } = require('pg');
const fs = require('fs');
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query(fs.readFileSync(process.argv[2], 'utf8'));
  console.log('OK:', process.argv[2]);
  console.log((await c.query('SELECT chapter_word_count(17, 1) AS words')).rows[0]);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
