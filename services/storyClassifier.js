const supabase = require('../config/supabase');

// Bộ nhớ đệm Cache trong bộ nhớ (chỉ dùng khi chưa có column story_type trong DB)
let memoryCache = null;
let memoryCacheTime = 0;
const CACHE_TTL = 15 * 60 * 1000; // 15 phút

/**
 * Thuật toán phân loại Truyện Tranh vs Truyện Chữ:
 *   - COMIC: nhiều ảnh (>= 5) và ít chữ/ảnh (< 800 ký tự/ảnh)
 *          | hoặc có ảnh nhưng gần như không có chữ (< 200 ký tự)
 *          | hoặc hoàn toàn không có nội dung (empty)
 *   - NOVEL: ngược lại (nhiều chữ so với số ảnh)
 */
function classifyContent(imgCount, textLen) {
  // Nếu có chữ (cho dù chỉ 1 chữ) -> truyện chữ
  if (textLen > 0) return 'novel';
  // Không có chữ nào -> truyện tranh
  return 'comic';
}

/**
 * Xây dựng map story_type từ DB (nhanh nếu đã có cột story_type, chậm nếu chưa có).
 */
async function getStoryTypesMap() {
  const now = Date.now();

  // 1. Thử đọc story_type từ bảng stories (nhanh - nếu cột đã tồn tại)
  try {
    const { data: stories, error } = await supabase
      .from('stories')
      .select('id, story_type');

    if (!error && stories && stories[0] && 'story_type' in stories[0]) {
      // Cột tồn tại -> dùng dữ liệu từ DB (siêu nhanh)
      const comicIds = new Set();
      const novelIds = new Set();
      for (const s of stories) {
        if (s.story_type === 'comic') comicIds.add(s.id);
        else novelIds.add(s.id);
      }
      return { comicIds, novelIds };
    }
  } catch (e) {
    // Cột chưa có, dùng fallback
  }

  // 2. Fallback: dùng cache bộ nhớ nếu còn hiệu lực
  if (memoryCache && (now - memoryCacheTime < CACHE_TTL)) {
    return memoryCache;
  }

  // 3. Phân loại từ nội dung chương (chậm nhưng chính xác)
  try {
    const { data: stories } = await supabase.from('stories').select('id');
    if (!stories) return { comicIds: new Set(), novelIds: new Set() };

    const storyIds = stories.map(s => s.id);

    // Lấy chapter đầu tiên của mỗi truyện (order by story_id + chapter_number)
    const { data: chaps } = await supabase
      .from('chapters')
      .select('story_id, content')
      .in('story_id', storyIds)
      .order('story_id')
      .order('chapter_number')
      .limit(storyIds.length * 2); // buffer để chắc chắn lấy đủ

    // Dedup: chỉ giữ chapter đầu tiên của mỗi story
    const chapMap = {};
    for (const c of (chaps || [])) {
      if (!chapMap[c.story_id]) chapMap[c.story_id] = c.content || '';
    }

    const comicIds = new Set();
    const novelIds = new Set();

    for (const s of stories) {
      const content = chapMap[s.id] || '';
      const imgCount = (content.match(/<img/gi) || []).length;
      const textLen = content.replace(/<[^>]*>/g, '').trim().length;
      const type = classifyContent(imgCount, textLen);
      if (type === 'comic') comicIds.add(s.id);
      else novelIds.add(s.id);
    }

    memoryCache = { comicIds, novelIds };
    memoryCacheTime = now;
    return memoryCache;
  } catch (e) {
    console.error('Lỗi getStoryTypesMap:', e);
    return { comicIds: new Set(), novelIds: new Set() };
  }
}

/**
 * Phân loại tất cả truyện và lưu vào cột story_type trong bảng stories.
 * Chạy 1 lần qua endpoint admin: /admin/classify-stories
 * Yêu cầu: đã có cột `story_type TEXT DEFAULT 'novel'` trong bảng stories.
 */
async function classifyAndSaveAll() {
  const { data: stories } = await supabase.from('stories').select('id');
  if (!stories) return { success: false, message: 'Không có truyện' };

  const storyIds = stories.map(s => s.id);

  const { data: chaps } = await supabase
    .from('chapters')
    .select('story_id, content')
    .in('story_id', storyIds)
    .order('story_id')
    .order('chapter_number')
    .limit(storyIds.length * 3);

  const chapMap = {};
  for (const c of (chaps || [])) {
    if (!chapMap[c.story_id]) chapMap[c.story_id] = c.content || '';
  }

  let comicCount = 0, novelCount = 0, errorCount = 0;

  for (const s of stories) {
    const content = chapMap[s.id] || '';
    const imgCount = (content.match(/<img/gi) || []).length;
    const textLen = content.replace(/<[^>]*>/g, '').trim().length;
    const storyType = classifyContent(imgCount, textLen);

    const { error } = await supabase
      .from('stories')
      .update({ story_type: storyType })
      .eq('id', s.id);

    if (error) errorCount++;
    else if (storyType === 'comic') comicCount++;
    else novelCount++;
  }

  // Xóa cache bộ nhớ để lần sau đọc từ DB
  memoryCache = null;
  memoryCacheTime = 0;

  return { success: true, comicCount, novelCount, errorCount, total: stories.length };
}

/**
 * Lấy danh sách BXH phân loại theo Truyện Tranh hoặc Truyện Chữ
 */
async function getTypeRankings(type = 'comic', rankingType = 'daily', limit = 5) {
  try {
    const { comicIds, novelIds } = await getStoryTypesMap();
    const matchedIds = (type === 'comic') ? comicIds : novelIds;

    if (!matchedIds || matchedIds.size === 0) return [];

    let rankData = [];
    if (rankingType === 'daily') {
      const { data } = await supabase.from('views_ranking_daily').select('*').order('view_count', { ascending: false });
      rankData = data || [];
    } else if (rankingType === 'weekly') {
      const { data } = await supabase.from('views_ranking_weekly').select('*').order('view_count', { ascending: false });
      rankData = data || [];
    } else if (rankingType === 'monthly') {
      const { data } = await supabase.from('views_ranking_monthly').select('*').order('view_count', { ascending: false });
      rankData = data || [];
    } else if (rankingType === 'rated') {
      const { data } = await supabase.from('views_ranking_rated').select('*');
      rankData = data || [];
    } else if (rankingType === 'bookmarks') {
      const { data } = await supabase.from('stories_bookmarks_count').select('*').order('bookmark_count', { ascending: false });
      rankData = data || [];
    } else if (rankingType === 'alltime') {
      const { data } = await supabase.from('views_ranking_yearly').select('*').order('view_count', { ascending: false });
      rankData = data || [];
    }

    const filtered = rankData.filter(item => matchedIds.has(item.id)).slice(0, limit);
    return filtered;
  } catch (err) {
    console.error('Lỗi getTypeRankings:', err);
    return [];
  }
}

module.exports = { getStoryTypesMap, classifyAndSaveAll, getTypeRankings };
