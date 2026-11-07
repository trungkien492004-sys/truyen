// Xuất EPUB của một truyện từ DB. Dùng: node scripts/export_story_epub.js <story_id> <thư_mục_đích>
const fs = require('fs');
const path = require('path');
const supabase = require('../config/supabase');
const { generateEpub } = require('../services/epubGenerator');
(async () => {
  const id = parseInt(process.argv[2]);
  const outDir = process.argv[3] || '.';
  const { data: story } = await supabase.from('stories').select('*').eq('id', id).single();
  if (!story) throw new Error('Không thấy truyện ' + id);
  let chapters = [], page = 0;
  for (;;) {
    const { data, error } = await supabase.from('chapters').select('*').eq('story_id', id)
      .order('chapter_number', { ascending: true }).range(page * 200, page * 200 + 199);
    if (error) throw error;
    chapters.push(...data);
    if (data.length < 200) break;
    page++;
  }
  const buf = await generateEpub(story, chapters);
  const safe = story.title.replace(/[\/:*?"<>|]/g, '').trim();
  const file = path.join(outDir, `${safe}.epub`);
  fs.writeFileSync(file, buf);
  const broken = chapters.filter(c => /xlaqupbqiwpoprywnkgi/.test(c.content || '')).length;
  console.log(`OK: ${file}\n${chapters.length} chương, ${(buf.length / 1e6).toFixed(1)}MB, chương còn ảnh hỏng: ${broken}`);
})().catch(e => { console.error(e.message); process.exit(1); });
