// Thống kê MỌI link ảnh trong chương theo host: bao nhiêu chương/truyện dùng, host còn sống không.
// Dùng: DATABASE_URL=... node scripts/census_image_hosts.js
const { Client } = require('pg');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const hosts = {}; // host -> {chapters:Set, stories:Set, sample, ref}
  const { rows: ids } = await c.query(`SELECT id FROM chapters WHERE content LIKE '%<img%' ORDER BY id`);
  console.log('Chương có ảnh:', ids.length);
  for (let i = 0; i < ids.length; i += 150) {
    const batch = ids.slice(i, i + 150).map(r => r.id);
    const { rows } = await c.query(`SELECT id, story_id, content FROM chapters WHERE id = ANY($1)`, [batch]);
    for (const r of rows) {
      for (const m of r.content.matchAll(/<img[^>]+src="([^"]+)"/g)) {
        let u = m[1].replace(/&amp;/g, '&'), ref = null;
        if (u.startsWith('/api/proxy-image')) { const p = new URL('https://x' + u); u = p.searchParams.get('url'); ref = p.searchParams.get('referer'); }
        let host; try { host = new URL(u, 'https://truyen-psi.vercel.app').hostname; } catch { host = '(lỗi url)'; }
        const h = hosts[host] = hosts[host] || { chapters: new Set(), stories: new Set(), sample: u, ref };
        h.chapters.add(r.id); h.stories.add(r.story_id);
      }
    }
  }
  const out = [];
  for (const [host, h] of Object.entries(hosts)) {
    let st;
    try { const r = await fetch(h.sample, { headers: { 'User-Agent': UA, ...(h.ref ? { Referer: h.ref } : {}) }, signal: AbortSignal.timeout(15000) }); st = r.status; } catch (e) { st = 'ERR'; }
    out.push({ host, truyen: h.stories.size, chuong: h.chapters.size, status: st, truyen_ids: [...h.stories].sort((a, b) => a - b).slice(0, 12).join(',') });
  }
  out.sort((a, b) => b.chuong - a.chuong);
  console.table(out);
  await c.end();
})().catch(e => { console.error(e.message); process.exit(1); });
