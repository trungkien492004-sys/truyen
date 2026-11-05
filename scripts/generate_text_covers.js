// Tạo ảnh bìa chữ (nền gradient + tên truyện) cho các truyện đang dùng cover mặc định vì mất cover gốc.
// Cần: npm i --no-save sharp
// Dùng:
//   node scripts/generate_text_covers.js --preview=<thư mục>   # chỉ vẽ ra file để xem, không đụng DB
//   DATABASE_URL=... node scripts/generate_text_covers.js --apply   # upload + gán vào DB
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const lost = require('./lost_covers.json');
const PREVIEW = (process.argv.find(a => a.startsWith('--preview=')) || '').split('=')[1];
const APPLY = process.argv.includes('--apply');
const W = 600, H = 900;

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function cleanTitle(t) {
  return t.replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim() || t.trim();
}

function wrap(text, maxChars) {
  const lines = []; let cur = '';
  for (const w of text.split(' ')) {
    if (!cur) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

function coverSvg(id, rawTitle) {
  const title = cleanTitle(rawTitle);
  const hue = (id * 47) % 360;
  const c1 = `hsl(${hue},55%,28%)`, c2 = `hsl(${(hue + 40) % 360},60%,14%)`, accent = `hsl(${(hue + 25) % 360},80%,75%)`;
  let size = 64, lines = wrap(title, 11);
  if (lines.length > 5) { size = 52; lines = wrap(title, 14); }
  if (lines.length > 6) { size = 42; lines = wrap(title, 17); }
  const lh = size * 1.25, startY = H / 2 - ((lines.length - 1) * lh) / 2;
  const text = lines.map((l, i) =>
    `<text x="${W / 2}" y="${startY + i * lh}" text-anchor="middle" font-size="${size}" font-weight="700" fill="#fff" font-family="Segoe UI, Arial, sans-serif">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <circle cx="${W * 0.85}" cy="${H * 0.12}" r="170" fill="${accent}" opacity="0.10"/>
  <circle cx="${W * 0.1}" cy="${H * 0.9}" r="220" fill="${accent}" opacity="0.08"/>
  <rect x="36" y="36" width="${W - 72}" height="${H - 72}" rx="14" fill="none" stroke="${accent}" stroke-width="3" opacity="0.7"/>
  <rect x="${W / 2 - 50}" y="${startY - size * 1.9}" width="100" height="4" fill="${accent}"/>
  ${text}
  <rect x="${W / 2 - 50}" y="${startY + (lines.length - 1) * lh + size * 0.9}" width="100" height="4" fill="${accent}"/>
</svg>`;
}

const render = (id, title) => sharp(Buffer.from(coverSvg(id, title))).webp({ quality: 82 }).toBuffer();

(async () => {
  if (PREVIEW) {
    fs.mkdirSync(PREVIEW, { recursive: true });
    for (const s of lost.slice(0, 8)) fs.writeFileSync(path.join(PREVIEW, `${s.id}.webp`), await render(s.id, s.title));
    console.log('Đã vẽ thử 8 ảnh vào', PREVIEW);
    return;
  }
  if (!APPLY) { console.log('Dùng --preview=<thư mục> hoặc --apply'); return; }

  const { Client } = require('pg');
  const storage = require('../services/storage');
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  let ok = 0;
  for (const s of lost) {
    const buf = await render(s.id, s.title);
    const url = await storage.uploadBuffer(buf, { contentType: 'image/webp', key: `cover_text_${s.id}.webp` });
    // chỉ gán nếu truyện vẫn đang dùng cover mặc định (không đè cover thật bạn đã up sau này)
    const r = await c.query(`UPDATE stories SET cover_url=$1 WHERE id=$2 AND cover_url='/css/default-cover.jpg'`, [url, s.id]);
    console.log(`${s.id}: ${r.rowCount ? 'đã gán' : 'bỏ qua (đã có cover khác)'}  ${(buf.length / 1024).toFixed(0)}KB`);
    ok += r.rowCount;
  }
  console.log(`Xong, gán ${ok}/${lost.length} truyện`);
  await c.end();
})().catch(e => { console.error('LỖI:', e.message); process.exit(1); });
