// Quét cover_url của mọi truyện, liệt kê cover không mở được. Dùng: node scripts/check_dead_covers.js [--json=file]
const supabase = require('../config/supabase');
const fs = require('fs');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
(async () => {
  const { data: stories } = await supabase.from('stories').select('id,title,story_type,cover_url').order('id').limit(1000);
  const dead = [];
  await Promise.all(Array.from({ length: 8 }, async (_, w) => {
    for (let i = w; i < stories.length; i += 8) {
      const s = stories[i];
      if (!s.cover_url || s.cover_url.startsWith('/')) continue; // ảnh nội bộ
      let st;
      try { const r = await fetch(s.cover_url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) }); st = r.status; }
      catch (e) { st = 'ERR'; }
      if (st !== 200) dead.push({ id: s.id, title: s.title.trim(), type: s.story_type, host: new URL(s.cover_url).hostname, status: st });
    }
  }));
  dead.sort((a, b) => a.id - b.id);
  console.table(dead.map(d => ({ ...d, title: d.title.slice(0, 35) })));
  console.log(`Cover chết: ${dead.length}/${stories.length}`);
  const out = (process.argv.find(a => a.startsWith('--json=')) || '').split('=')[1];
  if (out) fs.writeFileSync(out, JSON.stringify(dead, null, 1));
})();
