// Kiểm tra ảnh truyện tranh: lấy 1 chương mỗi truyện tranh, thử tải ảnh đầu tiên (trực tiếp & qua /api/proxy-image).
const supabase = require('../config/supabase');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const code = async (u, ref) => { try { const r = await fetch(u, { method: 'GET', headers: { 'User-Agent': UA, ...(ref ? { Referer: ref } : {}) }, signal: AbortSignal.timeout(15000) }); return r.status; } catch (e) { return 'ERR'; } };
(async () => {
  const { data: stories } = await supabase.from('stories').select('id,title,source_url').eq('story_type', 'comic').limit(300);
  const byHost = {};
  const rows = [];
  for (const s of stories) {
    const { data: ch } = await supabase.from('chapters').select('chapter_number,content').eq('story_id', s.id).order('chapter_number', { ascending: false }).limit(1);
    if (!ch || !ch[0]) { rows.push({ id: s.id, host: '(không chương)' }); continue; }
    const m = (ch[0].content || '').match(/<img[^>]+src="([^"]+)"/);
    if (!m) { rows.push({ id: s.id, host: '(không ảnh)' }); continue; }
    const url = m[1].replace(/&amp;/g, '&');
    const host = new URL(url, 'https://x.com').hostname;
    const direct = await code(url);
    const proxied = await code('https://truyen-psi.vercel.app/api/proxy-image?url=' + encodeURIComponent(url));
    rows.push({ id: s.id, host, direct, proxied, title: s.title.slice(0, 25) });
    const k = `${host} direct=${direct} proxy=${proxied}`;
    byHost[k] = (byHost[k] || 0) + 1;
  }
  console.log(byHost);
  console.log('Hỏng cả 2 đường:'); console.table(rows.filter(r => r.direct !== 200 && r.proxied !== 200 && r.direct !== undefined).slice(0, 40));
})();
