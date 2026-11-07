const { Pool } = require('pg'); const fs = require('fs');
const src = fs.readFileSync(__dirname + '/_a10_backup.js', 'utf8').match(/connectionString:'([^']+)'/)[1];
const pool = new Pool({ connectionString: src, ssl: { rejectUnauthorized: false } });
(async () => {
  const r = await pool.query('select title,content from chapters where story_id=7 and chapter_number=123');
  const { title, content } = r.rows[0];
  fs.writeFileSync(__dirname + '/../backup_lu123/ch123.html', content);
  const a = content.indexOf('Chủ nhân.</p>') >= 0 ? 0 : 0;
  const s = content.search(/<p>[^<]*Chủ nhân\.?[”"]? Lu bay lơ lửng/);
  const m = content.match(/<p>[^<]*Cả đời bé dài lắm[^]*?<\/p>\s*<p>[^<]*em sẽ đòi từ từ[^<]*<\/p>/);
  console.log(title, s, m && m.index, m && m[0].length);
  console.log(content.slice(s - 80, s + 60));
  if (process.argv[2] === 'apply' && s >= 0 && m) {
    const end = m.index + m[0].length;
    const nc = content.slice(0, s) + content.slice(end).replace(/^\s+/, '');
    fs.writeFileSync(__dirname + '/../backup_lu123/ch123.new.html', nc);
    await pool.query('update chapters set content=$1 where story_id=7 and chapter_number=123', [nc]);
    console.log('updated', content.length, '->', nc.length);
  }
  await pool.end();
})();
