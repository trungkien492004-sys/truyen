// Khôi phục ảnh truyện 17 "Vợ tôi Nhiễm Nhiễm" (ch 1-59) từ file EPUB đầy đủ ảnh.
// Ảnh được nén WebP rồi upload lên bucket 'uploads' của Supabase mới, sau đó thay link cũ trong chapters.content.
//
// Dùng:  DATABASE_URL=... node scripts/restore_story17_images.js [--apply] [--from=1] [--to=59]
// Không có --apply = chạy thử (chỉ đọc + nén thử trong RAM, in ước tính dung lượng).
// Chạy lại nhiều lần an toàn (bỏ qua ảnh đã upload, chương đã sửa).
const AdmZip = require('adm-zip');
const sharp = require('sharp');
const { Client } = require('pg');
const supabase = require('../config/supabase');

const EPUB = process.env.EPUB_PATH || 'C:/Users/Kien/Downloads/Vo_Toi_Nhiem_Nhiem_Full_Anh.epub';
const STORY_ID = 17;
const OLD = 'xlaqupbqiwpoprywnkgi.supabase.co';
const BUCKET = 'uploads';
const arg = (k, d) => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const APPLY = process.argv.includes('--apply');
const FROM = +arg('from', 1), TO = +arg('to', 59);
const MAX_W = 1000, QUALITY = 65;

const imgRe = /<img\b[^>]*?\bsrc="([^"]+)"[^>]*>/g;

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

(async () => {
  const zip = new AdmZip(EPUB);
  const entries = new Map(zip.getEntries().map(e => [e.entryName, e]));
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const { rows: existingRows } = await c.query(`SELECT name FROM storage.objects WHERE bucket_id=$1 AND name LIKE 'nhiem17_%'`, [BUCKET]);
  const existing = new Set(existingRows.map(r => r.name));
  const { rows: chapters } = await c.query(
    `SELECT id, chapter_number, content FROM chapters WHERE story_id=$1 AND chapter_number BETWEEN $2 AND $3 AND content LIKE $4 ORDER BY chapter_number`,
    [STORY_ID, FROM, TO, `%${OLD}%`]);
  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'}: ${chapters.length} chương cần sửa (ch ${FROM}-${TO})`);

  let totalIn = 0, totalOut = 0, done = 0, failed = 0;
  for (const ch of chapters) {
    const n = Math.round(ch.chapter_number);
    const xh = entries.get(`OEBPS/chapter-${n}.xhtml`);
    if (!xh) { console.log(`ch${n}: không có trong EPUB -> bỏ qua`); failed++; continue; }
    const epubSrcs = [...xh.getData().toString('utf8').matchAll(imgRe)].map(m => m[1]);
    const dbMatches = [...ch.content.matchAll(imgRe)].filter(m => m[1].includes(OLD));
    const dbAllImgs = [...ch.content.matchAll(imgRe)].length;
    if (epubSrcs.length !== dbAllImgs) { console.log(`ch${n}: LỆCH số ảnh epub=${epubSrcs.length} db=${dbAllImgs} -> bỏ qua`); failed++; continue; }

    // vị trí ảnh cũ trong chương, ghép theo thứ tự với EPUB
    const allMatches = [...ch.content.matchAll(imgRe)];
    const jobs = [];
    allMatches.forEach((m, idx) => { if (m[1].includes(OLD)) jobs.push({ idx, oldUrl: m[1], name: `nhiem17_c${String(n).padStart(2, '0')}_${String(idx + 1).padStart(3, '0')}.webp`, src: epubSrcs[idx] }); });

    const results = new Map();
    await pool(jobs, 6, async job => {
      const entry = entries.get('OEBPS/' + job.src.replace(/^\.?\/?/, '')) || entries.get(job.src);
      if (!entry) throw new Error(`thiếu ảnh ${job.src} trong EPUB`);
      const input = entry.getData();
      const out = await sharp(input).rotate().resize({ width: MAX_W, withoutEnlargement: true }).webp({ quality: QUALITY }).toBuffer();
      totalIn += input.length; totalOut += out.length;
      if (APPLY && !existing.has(job.name)) {
        const { error } = await supabase.storage.from(BUCKET).upload(job.name, out, { contentType: 'image/webp', upsert: true });
        if (error) throw new Error(`upload ${job.name}: ${error.message}`);
      }
      results.set(job.oldUrl + '#' + job.idx, supabase.storage.from(BUCKET).getPublicUrl(job.name).data.publicUrl);
    });

    if (APPLY) {
      let k = -1;
      const newContent = ch.content.replace(imgRe, (full, src) => {
        k++;
        const r = results.get(src + '#' + k);
        return r ? full.replace(src, r) : full;
      });
      await c.query(`UPDATE chapters SET content=$1 WHERE id=$2`, [newContent, ch.id]);
    }
    done++;
    console.log(`ch${n}: ${jobs.length} ảnh OK`);
  }
  console.log(`\nXong ${done} chương, lỗi/bỏ qua ${failed}. Ảnh gốc ${(totalIn / 1e6).toFixed(1)}MB -> WebP ${(totalOut / 1e6).toFixed(1)}MB`);
  await c.end();
})().catch(e => { console.error('LỖI:', e.message); process.exit(1); });
