// Cào lại ảnh chương từ truyenqq.com.vn để thay link ảnh đã chết (otruyencdn...) của truyện đang có trong DB.
// Dùng: node scripts/recrawl_truyenqq.js <story_id> <slug-truyenqq> [--from=N] [--to=N]
// Ví dụ: node scripts/recrawl_truyenqq.js 140 slave-game
// Chạy lại được: chương đã có link truyenqq sẽ bỏ qua. Chương chưa có trong DB sẽ được thêm.
const cheerio = require('cheerio');
const supabase = require('../config/supabase');

const HOST = 'truyenqq.com.vn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;

async function get(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
      if (r.status === 429 || r.status >= 500) { await sleep(5000 * (i + 1)); continue; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) { if (i === tries - 1) throw e; await sleep(3000 * (i + 1)); }
  }
  throw new Error('quá số lần thử (bị giới hạn tốc độ?)');
}

(async () => {
  const storyId = parseInt(process.argv[2]);
  const slug = process.argv[3];
  const FROM = parseFloat(arg('from', '-1')), TO = parseFloat(arg('to', '999999'));
  if (!storyId || !slug) throw new Error('Thiếu tham số: <story_id> <slug>');

  const $d = cheerio.load(await get(`https://${HOST}/${slug}`));
  const chapters = new Map();
  $d(`a[href^="/${slug}/chapter-"]`).each((_, el) => {
    const m = ($d(el).attr('href') || '').match(/chapter-(\d+(?:\.\d+)?)$/);
    if (m) chapters.set(parseFloat(m[1]), `https://${HOST}${$d(el).attr('href')}`);
  });
  console.log(`Nguồn có ${chapters.size} chương`);

  // chương đã làm xong (đã có link truyenqq) -> bỏ qua
  const done = new Set(); const exist = new Set();
  for (let p = 0; ; p++) {
    const { data } = await supabase.from('chapters').select('chapter_number,content').eq('story_id', storyId).range(p * 100, p * 100 + 99);
    if (!data || !data.length) break;
    data.forEach(c => { exist.add(Number(c.chapter_number)); if ((c.content || '').includes('truyenqq.com.vn')) done.add(Number(c.chapter_number)); });
    if (data.length < 100) break;
  }

  const todo = [...chapters.keys()].filter(n => n >= FROM && n <= TO && !done.has(n)).sort((a, b) => a - b);
  console.log(`Cần làm: ${todo.length} chương (đã xong trước đó: ${done.size})`);
  let ok = 0, fail = 0, added = 0;
  for (const num of todo) {
    try {
      const $c = cheerio.load(await get(chapters.get(num)));
      const images = [];
      $c('img').each((_, el) => {
        const src = $c(el).attr('data-src') || $c(el).attr('data-original') || $c(el).attr('src') || '';
        if (src.startsWith('http') && !/logo|avatar|banner/i.test(src)) images.push(src);
      });
      if (!images.length) throw new Error('không có ảnh');
      const ref = encodeURIComponent(`https://${HOST}/`);
      const content = images.map(img =>
        `<div style="text-align: center; margin-bottom: 10px;"><img src="/api/proxy-image?url=${encodeURIComponent(img)}&referer=${ref}" style="max-width: 100%; height: auto; border-radius: 4px;" loading="lazy"></div>`).join('');
      if (exist.has(num)) {
        const { error } = await supabase.from('chapters').update({ content }).eq('story_id', storyId).eq('chapter_number', num);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('chapters').insert([{ story_id: storyId, chapter_number: num, title: `Chương ${num}`, content }]);
        if (error) throw error; added++;
      }
      ok++;
      if (ok % 25 === 0) console.log(`  ...${ok}/${todo.length}`);
    } catch (e) { fail++; console.error(`  LỖI chương ${num}: ${e.message}`); }
    await sleep(1500);
  }
  console.log(`XONG story ${storyId}: ok ${ok} (thêm mới ${added}), lỗi ${fail}`);
})().catch(e => { console.error('LỖI:', e.message); process.exit(1); });
