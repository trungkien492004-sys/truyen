// Bổ sung các chương còn thiếu của truyện tranh nguồn vietmanhwa (ảnh là link CDN, không tốn Storage).
// Dùng: node scripts/fill_vietmanhwa_gaps.js 424 431 ...   (hoặc không tham số = tất cả truyện có khoảng trống)
const supabase = require('../config/supabase');
const { syncVietManhwaStory } = require('../services/vietmanhwaCrawler');
(async () => {
  let ids = process.argv.slice(2).map(Number).filter(Boolean);
  const { data: stories } = await supabase.from('stories').select('id,title,source_url').like('source_url', '%vietmanhwa%');
  if (!ids.length) ids = stories.map(s => s.id);
  const summary = [];
  for (const s of stories.filter(s => ids.includes(s.id))) {
    try {
      const r = await syncVietManhwaStory(s.source_url, { maxChapters: 999999 });
      summary.push({ id: s.id, title: s.title.slice(0, 30), nguon: r.totalChapters, them: r.addedCount });
    } catch (e) { summary.push({ id: s.id, title: s.title.slice(0, 30), loi: e.message.slice(0, 60) }); }
  }
  console.table(summary);
})();
