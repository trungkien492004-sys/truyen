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

const esc = s => s.normalize('NFC').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
  const hue = (id * 47) % 360, pattern = id % 4;
  const c1 = `hsl(${hue},50%,30%)`, c2 = `hsl(${(hue + 35) % 360},55%,12%)`;
  const gold = `hsl(${(hue + 25) % 360},70%,78%)`;
  let size = 66, lines = wrap(title, 11);
  if (lines.length > 4) { size = 54; lines = wrap(title, 13); }
  if (lines.length > 5) { size = 44; lines = wrap(title, 16); }
  const lh = size * 1.3, startY = H * 0.46 - ((lines.length - 1) * lh) / 2;
  const font = "'Times New Roman', Cambria, serif";
  const text = lines.map((l, i) => {
    const y = startY + i * lh;
    return `<text x="${W / 2 + 36 + 3}" y="${y + 4}" text-anchor="middle" font-size="${size}" font-weight="700" fill="#000" opacity="0.45" font-family="${font}">${esc(l)}</text>
    <text x="${W / 2 + 36}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="700" fill="#fff8e7" font-family="${font}">${esc(l)}</text>`;
  }).join('');
  // hoạ tiết nền theo id
  let pat = '';
  if (pattern === 0) for (let i = -H; i < W + H; i += 46) pat += `<line x1="${i}" y1="0" x2="${i + H}" y2="${H}" stroke="${gold}" stroke-width="1.2" opacity="0.10"/>`;
  else if (pattern === 1) for (let x = 40; x < W; x += 56) for (let y = 40; y < H; y += 56) pat += `<circle cx="${x}" cy="${y}" r="3" fill="${gold}" opacity="0.14"/>`;
  else if (pattern === 2) for (let r = 60; r < 900; r += 70) pat += `<circle cx="${W * 0.8}" cy="${H * 0.15}" r="${r}" fill="none" stroke="${gold}" stroke-width="1.4" opacity="0.12"/>`;
  else for (let y = 30; y < H; y += 38) pat += `<path d="M0 ${y} Q ${W / 4} ${y - 18} ${W / 2} ${y} T ${W} ${y}" fill="none" stroke="${gold}" stroke-width="1.3" opacity="0.11"/>`;
  const cx = W / 2 + 36;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
    <linearGradient id="sp" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity="0.55"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.10"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient>
    <radialGradient id="v" cx="0.5" cy="0.45" r="0.8"><stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>${pat}
  <rect width="${W}" height="${H}" fill="url(#v)"/>
  <rect x="0" y="0" width="64" height="${H}" fill="url(#sp)"/>
  <rect x="64" y="0" width="3" height="${H}" fill="#000" opacity="0.35"/>
  <rect x="92" y="40" width="${W - 128}" height="${H - 80}" fill="none" stroke="${gold}" stroke-width="2.5" opacity="0.8"/>
  <rect x="100" y="48" width="${W - 144}" height="${H - 96}" fill="none" stroke="${gold}" stroke-width="1" opacity="0.5"/>
  <text x="${cx}" y="120" text-anchor="middle" font-size="22" letter-spacing="10" fill="${gold}" font-family="${font}" opacity="0.9">TRUYỆN</text>
  <g stroke="${gold}" stroke-width="2" opacity="0.9"><line x1="${cx - 70}" y1="146" x2="${cx - 10}" y2="146"/><line x1="${cx + 10}" y1="146" x2="${cx + 70}" y2="146"/></g>
  <rect x="${cx - 5}" y="141" width="10" height="10" fill="${gold}" transform="rotate(45 ${cx} 146)"/>
  ${text}
  <g stroke="${gold}" stroke-width="2" opacity="0.9"><line x1="${cx - 90}" y1="${H - 120}" x2="${cx - 12}" y2="${H - 120}"/><line x1="${cx + 12}" y1="${H - 120}" x2="${cx + 90}" y2="${H - 120}"/></g>
  <rect x="${cx - 5}" y="${H - 125}" width="10" height="10" fill="${gold}" transform="rotate(45 ${cx} ${H - 120})"/>
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
    const url = await storage.uploadBuffer(buf, { contentType: 'image/webp', key: `cover_v2_${s.id}.webp` });
    // chỉ gán nếu truyện vẫn đang dùng cover mặc định (không đè cover thật bạn đã up sau này)
    const r = await c.query(`UPDATE stories SET cover_url=$1 WHERE id=$2 AND (cover_url='/css/default-cover.jpg' OR cover_url LIKE '%/cover_text_%' OR cover_url LIKE '%/cover_v2_%')`, [url, s.id]);
    console.log(`${s.id}: ${r.rowCount ? 'đã gán' : 'bỏ qua (đã có cover khác)'}  ${(buf.length / 1024).toFixed(0)}KB`);
    ok += r.rowCount;
  }
  console.log(`Xong, gán ${ok}/${lost.length} truyện`);
  await c.end();
})().catch(e => { console.error('LỖI:', e.message); process.exit(1); });
