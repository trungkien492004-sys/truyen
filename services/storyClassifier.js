const supabase = require('../config/supabase');

// Bộ nhớ đệm Cache tạm thời tránh gửi 80+ request liên tục tới Supabase mỗi lần người dùng F5 trang chủ
let storyTypeCache = null;
let cacheTime = 0;

/**
 * Phân loại toàn bộ truyện 1 lần duy nhất và lưu cache 10 phút
 */
async function getStoryTypesMap() {
  const now = Date.now();
  if (storyTypeCache && (now - cacheTime < 10 * 60 * 1000)) {
    return storyTypeCache;
  }

  try {
    // 1. Lấy tất cả truyện và 1 chương đại diện duy nhất
    const { data: stories } = await supabase.from('stories').select('id');
    if (!stories) return { comicIds: new Set(), novelIds: new Set() };

    const storyIds = stories.map(s => s.id);
    const { data: chaps } = await supabase
      .from('chapters')
      .select('story_id, content')
      .in('story_id', storyIds)
      .limit(storyIds.length);

    const chapMap = {};
    (chaps || []).forEach(c => {
      if (!chapMap[c.story_id]) chapMap[c.story_id] = c.content || '';
    });

    const comicIds = new Set();
    const novelIds = new Set();

    for (const s of stories) {
      const content = chapMap[s.id] || '';
      const imgCount = (content.match(/<img\s+/gi) || []).length;
      const cleanText = content.replace(/<[^>]*>/g, '').trim();
      const textLen = cleanText.length;

      const isComic = (textLen < 300) || (imgCount >= 3);
      if (isComic) {
        comicIds.add(s.id);
      } else {
        novelIds.add(s.id);
      }
    }

    storyTypeCache = { comicIds, novelIds };
    cacheTime = now;
    return storyTypeCache;
  } catch (e) {
    console.error('Lỗi getStoryTypesMap:', e);
    return { comicIds: new Set(), novelIds: new Set() };
  }
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

module.exports = { getTypeRankings };
