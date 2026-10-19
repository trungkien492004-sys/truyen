const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { generateEpub } = require('../services/epubGenerator');

// Sử dụng Memory Storage để chạy không đĩa (tương thích Vercel Serverless)
const upload = multer({ storage: multer.memoryStorage() });

// Middleware nạp thông tin người dùng mới nhất từ DB và số thông báo chưa đọc vào res.locals cho mọi template EJS
router.use(async (req, res, next) => {
  res.locals.unreadNotificationsCount = 0;
  if (req.user && req.user.id) {
    try {
      // Đọc thông tin user mới nhất từ DB để không bị lệch avatar/badge/frame do cookie-session cũ trên mobile
      const { data: dbUser } = await supabase
        .from('users')
        .select('display_name, avatar, bio, equipped_badge, equipped_avatar, equipped_frame, role')
        .eq('id', req.user.id)
        .single();

      if (dbUser) {
        Object.assign(req.user, dbUser);
      }

      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', req.user.id)
        .eq('is_read', false);
      res.locals.unreadNotificationsCount = count || 0;
    } catch (e) {
      console.error('Lỗi nạp thông tin user/thông báo:', e);
    }
  }
  res.locals.user = req.user;
  next();
});

const EXP_PER_CHAPTER = 5;

function getBadgeForCount(count) {
  if (count >= 500) return { label: 'Huyền thoại độc giả', badge_class: 'legend' };
  if (count >= 100) return { label: 'Đại học giả', badge_class: 'gold' };
  if (count >= 20) return { label: 'Mọt sách thực thụ', badge_class: 'silver' };
  if (count >= 1) return { label: 'Độc giả mới', badge_class: 'bronze' };
  return { label: 'Người mới', badge_class: 'bronze' };
}

async function unlockAchievement(userId, achievementName) {
  try {
    const { data: ach } = await supabase
      .from('achievements')
      .select('id, description')
      .eq('name', achievementName)
      .single();
    if (!ach) return;

    // Kiểm tra xem đã mở khóa chưa
    const { data: exists } = await supabase
      .from('user_achievements')
      .select('*')
      .eq('user_id', userId)
      .eq('achievement_id', ach.id)
      .single();

    if (!exists) {
      await supabase.from('user_achievements').insert([{ user_id: userId, achievement_id: ach.id }]);
      // Gửi thông báo
      await supabase.from('notifications').insert([{
        user_id: userId,
        message: `🏆 Bạn đã mở khóa huy hiệu: ${achievementName}! (${ach.description})`,
        link: '/profile'
      }]);
    }
  } catch (err) {
    console.error('Lỗi mở khóa thành tựu:', err);
  }
}

// Hàm gamification: ghi nhận lượt đọc chương (tính EXP 1 lần/chương) + cập nhật streak đọc liên tục
async function awardReadingExp(userId, storyId, chapterNumber) {
  // 1. Ghi nhận vào chapter_reads (chỉ để lưu lịch sử các chương duy nhất đã đọc)
  const { error: insertErr } = await supabase
    .from('chapter_reads')
    .insert([{ user_id: userId, story_id: storyId, chapter_number: chapterNumber }]);

  // Mã lỗi 23505 = vi phạm UNIQUE constraint (đã đọc trước đó). Chúng ta vẫn tiếp tục cộng EXP!
  const alreadyCounted = insertErr && insertErr.code === '23505';
  if (insertErr && !alreadyCounted) {
    console.error('Lỗi ghi nhận chapter_reads:', insertErr);
    return;
  }

  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

  // 2. Lấy (hoặc tạo mới) user_stats hiện tại
  const { data: stats } = await supabase
    .from('user_stats')
    .select('*')
    .eq('user_id', userId)
    .single();

  let exp = stats ? (stats.exp || 0) : 0;
  let streak = stats ? (stats.streak_days || 0) : 0;
  let chaptersRead = stats ? (stats.chapters_read || 0) : 0;
  const lastDate = stats ? stats.last_read_date : null;
  const chaptersReadBefore = chaptersRead;

  // Luôn cộng EXP và Số chương đã đọc, bất kể đọc mới hay đọc lại!
  exp += EXP_PER_CHAPTER;
  chaptersRead += 1;

  // Cập nhật streak: nếu đã đọc hôm nay rồi thì giữ nguyên, nếu hôm qua thì +1, nếu không thì reset về 1
  if (lastDate !== todayStr) {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    if (lastDate === yesterdayStr) {
      streak += 1;
    } else {
      streak = 1;
    }
  }

  await supabase.from('user_stats').upsert(
    { user_id: userId, exp: exp, chapters_read: chaptersRead, streak_days: streak, last_read_date: todayStr, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  );

  // 3. Kiểm tra mở khóa thành tựu dựa trên tổng Số chương đã đọc (chaptersRead)
  if (chaptersRead >= 1) await unlockAchievement(userId, 'Độc giả mới');
  if (chaptersRead >= 20) await unlockAchievement(userId, 'Mọt sách thực thụ');
  if (chaptersRead >= 100) await unlockAchievement(userId, 'Đại học giả');
  if (chaptersRead >= 500) await unlockAchievement(userId, 'Huyền thoại độc giả');

  if (streak >= 7) {
    await unlockAchievement(userId, 'Kiên trì đọc sách');
  }

  // 4. Kiểm tra xem có "lên rank / đột phá cảnh giới" hay không (dựa trên rank_settings)
  // QUAN TRỌNG: mọi tên bậc, ngưỡng, và cả THỨ TỰ (#1, #2...) đều tính ĐỘNG hoàn toàn từ bảng
  // rank_settings - không hard-code bất kỳ tên bậc cụ thể nào. Nếu admin đổi tên/ngưỡng/thứ tự
  // trong trang quản trị, banner + logic lên rank sẽ tự động phản ánh đúng ngay lập tức.
  let rankUp = null;
  try {
    // Sort tăng dần theo count: bậc thấp nhất (count nhỏ nhất) đứng đầu mảng -> index 0 = "#1" (thấp nhất)
    const { data: rankSettingsAsc } = await supabase
      .from('rank_settings')
      .select('*')
      .order('count', { ascending: true });

    if (rankSettingsAsc && rankSettingsAsc.length > 0) {
      // Tìm bậc cao nhất mà user đã đạt được: duyệt từ cuối mảng (count lớn nhất) về đầu,
      // lấy bậc đầu tiên mà user đủ điều kiện.
      const findRankIndex = (chapCount) => {
        for (let i = rankSettingsAsc.length - 1; i >= 0; i--) {
          if (chapCount >= rankSettingsAsc[i].count) return i;
        }
        return -1; // Chưa đạt bậc nào (index -1 = "chưa xếp hạng")
      };

      const idxBefore = findRankIndex(chaptersReadBefore);
      const idxAfter = findRankIndex(chaptersRead);
      const labelBefore = idxBefore >= 0 ? rankSettingsAsc[idxBefore].label : null;
      const labelAfter = idxAfter >= 0 ? rankSettingsAsc[idxAfter].label : null;

      // Chỉ tính là "đột phá" khi thực sự tăng bậc (idxAfter > idxBefore), không phải chỉ đổi tên
      if (idxAfter > idxBefore && labelAfter) {
        const fallbackLabel = 'Chưa xếp hạng';
        rankUp = {
          from: labelBefore || fallbackLabel,
          to: labelAfter,
          rankBeforeNum: idxBefore + 1,  // +1 vì idx bắt đầu từ 0, "#1" = bậc thấp nhất
          rankAfterNum: idxAfter + 1
        };
        await supabase.from('notifications').insert([{
          user_id: userId,
          message: `⚡ Đột phá cảnh giới! Bạn đã tiến lên "${labelAfter}"!`,
          link: '/profile'
        }]);
        // Ghi lại sự kiện lên rank để hiện banner công khai trên trang chủ trong ngày hôm nay
        try {
          await supabase.from('rank_up_events').insert([{
            user_id: userId,
            from_rank: labelBefore || fallbackLabel,
            to_rank: labelAfter,
            rank_before_num: idxBefore + 1,
            rank_after_num: idxAfter + 1
          }]);
        } catch (e) {
          console.error('Lỗi ghi rank_up_events:', e);
        }
      }
    }
  } catch (err) {
    console.error('Lỗi kiểm tra lên rank:', err);
  }

  return { earnedExp: true, rankUp, chaptersRead };
}

// Hàm ghi nhận tiến độ đọc truyện cho Đấu Trường Nữ Thần (nhiệm vụ ngày)
async function awardReadingCardDrop(userId, chaptersRead) {
  try {
    // Chỉ cập nhật tiến độ đọc truyện vào user_card_quests cho nhiệm vụ ngày
    const todayStr = new Date().toISOString().slice(0, 10);
    const { data: qRow } = await supabase
      .from('user_card_quests')
      .select('id, read_chapters')
      .eq('user_id', userId)
      .eq('quest_date', todayStr)
      .maybeSingle();

    if (qRow) {
      await supabase.from('user_card_quests')
        .update({ read_chapters: (qRow.read_chapters || 0) + 1, updated_at: new Date().toISOString() })
        .eq('id', qRow.id);
    } else {
      await supabase.from('user_card_quests')
        .insert([{ user_id: userId, quest_date: todayStr, read_chapters: 1 }]);
    }

    // Không còn rơi hòm trực tiếp mỗi chương, người chơi nhận qua nhiệm vụ ngày
    return { questUpdated: true };
  } catch (err) {
    console.error('Lỗi cập nhật tiến độ nhiệm vụ đọc thẻ bài:', err);
    return null;
  }
}

// Hàm hỗ trợ upload file lên Supabase Storage
async function uploadToSupabase(file, bucketName = 'uploads') {
  if (!file) return null;
  try {
    // Tạo bucket nếu chưa có
    await supabase.storage.createBucket(bucketName, { public: true });
  } catch (e) {
    // Bỏ qua lỗi nếu đã tồn tại
  }

  const fileExt = path.extname(file.originalname);
  const fileName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExt}`;

  const { data, error } = await supabase.storage
    .from(bucketName)
    .upload(fileName, file.buffer, {
      contentType: file.mimetype,
      upsert: true
    });

  if (error) {
    console.error('Lỗi upload file lên Supabase Storage:', error);
    throw error;
  }

  const { data: { publicUrl } } = supabase.storage
    .from(bucketName)
    .getPublicUrl(fileName);

  return publicUrl;
}

// Hàm lấy danh sách BXH tác giả theo tổng lượt xem
async function fetchTopAuthors(limitCount = 20) {
  try {
    const { data, error } = await supabase
      .from('author_leaderboard')
      .select('*')
      .limit(limitCount);
        
    if (error) {
      console.error('Lỗi lấy BXH tác giả từ DB:', error);
      return [];
    }
    
    return (data || []).map(row => ({
      author: row.author,
      totalViews: parseInt(row.total_views) || 0,
      story_count: parseInt(row.story_count) || 0,
      hottestStoryName: row.hottest_story_name,
      hottestStoryViews: parseInt(row.hottest_story_views) || 0
    }));
  } catch (e) {
    console.error('Lỗi trong fetchTopAuthors:', e);
    return [];
  }
}

// TRANG CHỦ & BẢNG XẾP HẠNG
// build-tag: redeploy-supabase-migrated-2026-09-05-1740
router.get('/', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const status = req.query.status || ''; // '', 'ongoing', 'completed'
    // Tab lọc Truyện chữ / Truyện tranh - lọc THẬT ở tầng database (không phải ẩn/hiện client-side),
    // để mỗi tab có phân trang riêng, tách biệt hoàn toàn. Trước đây lọc bằng JS chỉ ẩn/hiện card
    // trong đúng 12 truyện của trang hiện tại, nên nếu 1 trang toàn truyện tranh thì tab "Truyện chữ"
    // sẽ rỗng dù toàn bộ danh mục vẫn còn rất nhiều truyện chữ ở các trang khác.
    const storyType = (req.query.type === 'comic') ? 'comic' : 'novel'; // mặc định 'novel'
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const fromRange = (page - 1) * limit;
    const toRange = fromRange + limit - 1;

    // 1. Query truyện — lọc theo story_type trực tiếp.
    // novel: match 'novel' hoặc NULL; comic: chỉ match 'comic'
    let query = supabase.from('stories_with_last_update').select('*', { count: 'exact' });
    if (storyType === 'comic') {
      query = query.eq('story_type', 'comic');
    } else {
      query = query.or('story_type.eq.novel,story_type.is.null');
    }
    if (status === 'ongoing' || status === 'completed') {
      query = query.eq('status', status);
    }

    // Chạy song song: stories + genres (critical) và BXH (non-critical, có thể timeout)
    const [
      storiesResult,
      genresResult
    ] = await Promise.allSettled([
      query.order('last_update_at', { ascending: false }).range(fromRange, toRange),
      supabase.from('genres').select('*')
    ]);

    if (storiesResult.status === 'rejected') {
      console.warn('Stories query timeout/lỗi (rejected):', storiesResult.reason?.message);
    } else if (storiesResult.value && storiesResult.value.error) {
      console.warn('Stories query lỗi (fulfilled nhưng có error):', JSON.stringify(storiesResult.value.error));
    }
    if (genresResult.status === 'rejected') {
      console.warn('Genres query timeout/lỗi:', genresResult.reason?.message);
    }

    // LƯU Ý: Supabase-js không throw khi query lỗi (vd. lỗi cú pháp filter/join) - nó resolve
    // bình thường (fulfilled) nhưng với { data: null, error: {...} }. allSettled chỉ bắt được
    // exception JS thật (network/timeout), KHÔNG bắt được lỗi PostgREST trả về trong "value.error".
    // Đây là lý do trước đây stories bị rỗng âm thầm dù không hề "rejected".
    const rawStories = (storiesResult.status === 'fulfilled' && !storiesResult.value.error) ? (storiesResult.value.data || []) : [];
    const totalCount = (storiesResult.status === 'fulfilled' && !storiesResult.value.error) ? (storiesResult.value.count || 0) : 0;
    const genres     = (genresResult.status  === 'fulfilled' && !genresResult.value.error)  ? (genresResult.value.data  || []) : [];

    // BXH chạy allSettled: timeout/lỗi thì fallback [] — không crash trang chủ
    const [
      rankingDailyRes,
      rankingWeeklyRes,
      rankingMonthlyRes,
      rankingYearlyRes,
      rankingRatedRes
    ] = await Promise.allSettled([
      supabase.from('views_ranking_daily').select('*').order('view_count', { ascending: false }).limit(100),
      supabase.from('views_ranking_weekly').select('*').order('view_count', { ascending: false }).limit(100),
      supabase.from('views_ranking_monthly').select('*').order('view_count', { ascending: false }).limit(100),
      supabase.from('views_ranking_yearly').select('*').order('view_count', { ascending: false }).limit(100),
      supabase.from('views_ranking_rated').select('*').limit(100)
    ]);

    const topDaily      = (rankingDailyRes.status   === 'fulfilled' && rankingDailyRes.value.data)   ? rankingDailyRes.value.data   : [];
    const topWeekly     = (rankingWeeklyRes.status  === 'fulfilled' && rankingWeeklyRes.value.data)  ? rankingWeeklyRes.value.data  : [];
    const topMonthly    = (rankingMonthlyRes.status === 'fulfilled' && rankingMonthlyRes.value.data) ? rankingMonthlyRes.value.data : [];
    const topYearly     = (rankingYearlyRes.status  === 'fulfilled' && rankingYearlyRes.value.data)  ? rankingYearlyRes.value.data  : [];
    const topRatedData  = (rankingRatedRes.status   === 'fulfilled' && rankingRatedRes.value.data)   ? rankingRatedRes.value.data   : [];

    if (rankingDailyRes.status === 'rejected')   console.warn('BXH Daily timeout/lỗi:', rankingDailyRes.reason?.message);
    if (rankingWeeklyRes.status === 'rejected')  console.warn('BXH Weekly timeout/lỗi:', rankingWeeklyRes.reason?.message);
    if (rankingMonthlyRes.status === 'rejected') console.warn('BXH Monthly timeout/lỗi:', rankingMonthlyRes.reason?.message);
    if (rankingYearlyRes.status === 'rejected')  console.warn('BXH Yearly timeout/lỗi:', rankingYearlyRes.reason?.message);
    if (rankingRatedRes.status === 'rejected')   console.warn('BXH Rated timeout/lỗi:', rankingRatedRes.reason?.message);

    // Lấy số chương thực tế + map last_chapter_number, avg_score, rating_count, bookmark_count, view_count
    const storyIdsOnPage = (rawStories || []).map(s => s.id);
    let lastChapterMap = {};
    let ratingsMap = {};
    let bookmarksMap = {};
    let chapterCountMap = {};
    let viewsMap = {};

    if (storyIdsOnPage.length > 0) {
      const [chaptersSummaryResult, ratingsData, bookmarksData, viewsData] = await Promise.all([
        supabase
          .from('story_chapters_summary')
          .select('*')
          .in('story_id', storyIdsOnPage),
        supabase
          .from('story_ratings_summary')
          .select('*')
          .in('story_id', storyIdsOnPage),
        supabase
          .from('stories_bookmarks_count')
          .select('id, bookmark_count')
          .in('id', storyIdsOnPage),
        supabase
          .from('story_alltime_views')
          .select('story_id, view_count')
          .in('story_id', storyIdsOnPage)
      ]);

      for (const row of (chaptersSummaryResult.data || [])) {
        chapterCountMap[row.story_id] = row.chapter_count;
        lastChapterMap[row.story_id] = row.last_chapter_number;
      }
      for (const r of (ratingsData.data || [])) {
        ratingsMap[r.story_id] = { avg_score: r.avg_score, rating_count: r.rating_count };
      }
      for (const b of (bookmarksData.data || [])) {
        bookmarksMap[b.id] = b.bookmark_count;
      }
      for (const v of (viewsData?.data || [])) {
        viewsMap[v.story_id] = v.view_count || 0;
      }
    }

    const stories = (rawStories || []).map(s => {
      const rating = ratingsMap[s.id] || { avg_score: 0, rating_count: 0 };
      return {
        ...s,
        chapter_count: chapterCountMap[s.id] || 0,
        last_chapter_number: lastChapterMap[s.id] || null,
        avg_score: rating.avg_score,
        rating_count: rating.rating_count,
        bookmark_count: bookmarksMap[s.id] || 0,
        view_count: viewsMap[s.id] || 0
      };
    });

    // Lấy song song dữ liệu phụ
    const [
      rankSettingsRes,
      readersRes,
      bookmarksRes,
      bannersRes,
      historyRes
    ] = await Promise.allSettled([
      supabase.from('rank_settings').select('*').order('count', { ascending: false }),
      supabase.from('leaderboard_by_exp').select('*').order('chapters_read', { ascending: false }).order('exp', { ascending: false }).limit(10),
      supabase.from('stories_bookmarks_count').select('*').order('bookmark_count', { ascending: false }).limit(100),
      supabase.from('banners').select('*').order('created_at', { ascending: false }),
      req.user && req.user.id ? supabase.from('reading_history').select('chapter_number, story_id, stories(title)').eq('user_id', req.user.id).order('updated_at', { ascending: false }).limit(1) : Promise.resolve({ data: null })
    ]);

    // BXH Độc giả
    let topReaders = [];
    if (readersRes.status === 'fulfilled' && readersRes.value.data) {
      const rankSettings = (rankSettingsRes.status === 'fulfilled' && rankSettingsRes.value.data) ? rankSettingsRes.value.data : [];
      topReaders = readersRes.value.data.map(r => ({ ...r, badge: getBadgeForCount(r.chapters_read || 0, rankSettings) }));
    }

    // BXH Bookmarks
    let topBookmarks = (bookmarksRes.status === 'fulfilled' && bookmarksRes.value.data) ? bookmarksRes.value.data : [];

    // Danh sách banner
    let banners = (bannersRes.status === 'fulfilled' && bannersRes.value.data) ? bannersRes.value.data : [];

    // Lịch sử đọc
    let lastRead = null;
    if (historyRes.status === 'fulfilled' && historyRes.value.data && historyRes.value.data.length > 0) {
      lastRead = {
        story_id: historyRes.value.data[0].story_id,
        story_title: historyRes.value.data[0].stories ? historyRes.value.data[0].stories.title : '',
        chapter_number: historyRes.value.data[0].chapter_number
      };
    }

    // Bình luận mới
    let recentComments = [];
    try {
      const { data: commentsData, error: commentsErr } = await supabase
        .from('comments')
        .select('id, content, created_at, user_id, story_id, chapter_number, users!comments_user_id_fkey(display_name, avatar, equipped_frame, equipped_badge), stories(title)')
        .order('created_at', { ascending: false })
        .limit(5);
      if (!commentsErr && commentsData) recentComments = commentsData;
    } catch (e) {
      console.error('Lỗi lấy bình luận mới nhất:', e);
    }

    // Top tác giả
    const topAuthors = await fetchTopAuthors(5);

    // Sự kiện Đột Phá Cảnh Giới hôm nay
    let rankUpEventsToday = [];
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data: eventsData } = await supabase
        .from('rank_up_events')
        .select('id, from_rank, to_rank, rank_before_num, rank_after_num, created_at, users(display_name, avatar, equipped_frame, equipped_badge)')
        .gte('created_at', todayStart.toISOString())
        .order('created_at', { ascending: false })
        .limit(30);
      const rankSettingsForFilter = (rankSettingsRes.status === 'fulfilled' && rankSettingsRes.value.data) ? rankSettingsRes.value.data : [];
      const lowestRankLabel = rankSettingsForFilter.length > 0
        ? rankSettingsForFilter.reduce((lowest, r) => (r.count < lowest.count ? r : lowest), rankSettingsForFilter[0]).label
        : null;
      if (eventsData) {
        rankUpEventsToday = eventsData
          .filter(ev => ev.from_rank !== ev.to_rank && (!lowestRankLabel || ev.to_rank !== lowestRankLabel))
          .slice(0, 10);
      }
    } catch (e) {
      console.error('Lỗi lấy rank_up_events hôm nay:', e);
    }

    if (rankUpEventsToday.length > 0) {
      banners = [
        { id: 'rankup-board-slide', type: 'rankup_board', created_at: new Date().toISOString() },
        ...banners
      ];
    }

    const { getStoryTypesMap } = require('../services/storyClassifier');
    const { comicIds, novelIds } = await getStoryTypesMap().catch(() => ({ comicIds: new Set(), novelIds: new Set() }));

    // Hàm tách dữ liệu bxh thành 2 nhóm: truyện tranh và truyện chữ
    function splitRanking(data) {
      const comic = [], novel = [];
      for (const item of (data || [])) {
        if (comicIds.has(item.id) && comic.length < 5) comic.push(item);
        else if (!comicIds.has(item.id) && novel.length < 5) novel.push(item);
      }
      return { comic, novel };
    }

    const dailySplit    = splitRanking(topDaily);
    const weeklySplit   = splitRanking(topWeekly);
    const monthlySplit  = splitRanking(topMonthly);
    const alltimeSplit  = splitRanking(topYearly);
    const ratedSplit    = splitRanking(topRatedData);
    const bookmarksSplit = splitRanking(topBookmarks);

    const totalPages = Math.ceil((totalCount || 0) / limit);

    res.render('home', {
      title: 'Trang chủ - Web Đọc Truyện',
      user: req.user,
      stories: stories || [],
      // Loại truyện đang lọc ở trang chủ ('novel' hoặc 'comic') - dùng để tab hiển thị đúng
      // trạng thái active và giữ nguyên khi chuyển trang phân trang.
      storyType,
      genres,
      // BXH gốc (tất cả)
      topDaily: topDaily || [],
      topWeekly: topWeekly || [],
      topMonthly: topMonthly || [],
      topYearly: topYearly || [],
      topRated: topRatedData || [],
      topBookmarks,
      // BXH Truyện tranh
      topComicDaily: dailySplit.comic,
      topComicWeekly: weeklySplit.comic,
      topComicMonthly: monthlySplit.comic,
      topComicAlltime: alltimeSplit.comic,
      topComicRated: ratedSplit.comic,
      topComicBookmarks: bookmarksSplit.comic,
      // BXH Truyện chữ
      topNovelDaily: dailySplit.novel,
      topNovelWeekly: weeklySplit.novel,
      topNovelMonthly: monthlySplit.novel,
      topNovelAlltime: alltimeSplit.novel,
      topNovelRated: ratedSplit.novel,
      topNovelBookmarks: bookmarksSplit.novel,
      topReaders,
      topAuthors,
      banners,
      lastRead,
      recentComments,
      rankUpEventsToday,
      activeGenre: null,
      searchQuery: null,
      currentPage: page,
      totalPages,
      filters: { genre: '', status: status || '', minChapters: '', year: '', sort: 'newest', view_sort: '' }
    });

  } catch (err) {
    console.error('Lỗi trang chủ chi tiết:', JSON.stringify({ code: err.code, message: err.message, detail: err.details }));
    console.error('Stack:', err.stack);
    res.status(500).send('Đã xảy ra lỗi hệ thống.');
  }
});

// ROUTE DEBUG TẠM - kiểm tra trực tiếp qua URL xem query lọc story_type có đúng không trên
// đúng môi trường Vercel đang chạy, không cần vào Vercel Dashboard. Sẽ xoá sau khi hết bug.
router.get('/debug-storytype', async (req, res) => {
  try {
    const results = {};
    const { data: novelData, count: novelCount, error: novelErr } = await supabase
      .from('stories_with_last_update')
      .select('id, title, story_type', { count: 'exact' })
      .or('story_type.eq.novel,story_type.is.null')
      .limit(5);
    results.novelCount = novelCount;
    results.novelSample = novelData;
    results.novelErr = novelErr ? novelErr.message : null;

    const { data: comicData, count: comicCount, error: comicErr } = await supabase
      .from('stories_with_last_update')
      .select('id, title, story_type', { count: 'exact' })
      .eq('story_type', 'comic')
      .limit(5);
    results.comicCount = comicCount;
    results.comicSample = comicData;
    results.comicErr = comicErr ? comicErr.message : null;

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// PARTIAL HTML (dùng cho fetch AJAX khi bấm tab Truyện chữ/Truyện tranh ở trang chủ) - CHỈ trả
// về đúng đoạn grid truyện + phân trang (render bằng partials/stories-grid.ejs), KHÔNG kèm toàn
// bộ layout/BXH/banner như route "/" để nhẹ và nhanh hơn, tránh phải load lại cả trang chỉ để
// đổi 1 khu vực nhỏ.
router.get('/api/stories-partial', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  try {
    const status = req.query.status || '';
    const storyType = (req.query.type === 'comic') ? 'comic' : 'novel';
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const fromRange = (page - 1) * limit;
    const toRange = fromRange + limit - 1;

    let hasStoryTypeColumn = true;
    try {
      const { error: testErr } = await supabase.from('stories').select('story_type').limit(1);
      if (testErr) hasStoryTypeColumn = false;
    } catch (e) {
      hasStoryTypeColumn = false;
    }

    let query = supabase.from('stories_with_last_update').select('*', { count: 'exact' });
    if (hasStoryTypeColumn) {
      if (storyType === 'comic') {
        query = query.eq('story_type', 'comic');
      } else {
        query = query.or('story_type.eq.novel,story_type.is.null');
      }
    }
    if (status === 'ongoing' || status === 'completed') {
      query = query.eq('status', status);
    }

    const { data: rawStories, count: totalCount, error: storiesError } = await query
      .order('last_update_at', { ascending: false })
      .range(fromRange, toRange);

    if (storiesError) throw storiesError;

    // Lấy số chương thực tế + map last_chapter_number, avg_score, rating_count, bookmark_count
    const storyIdsOnPage = (rawStories || []).map(s => s.id);
    let lastChapterMap = {};
    let ratingsMap = {};
    let bookmarksMap = {};
    let chapterCountMap = {};
    let viewsMap = {};

    if (storyIdsOnPage.length > 0) {
      const [chaptersSummaryResult, ratingsData, bookmarksData, viewsData] = await Promise.all([
        supabase
          .from('story_chapters_summary')
          .select('*')
          .in('story_id', storyIdsOnPage),
        supabase
          .from('story_ratings_summary')
          .select('*')
          .in('story_id', storyIdsOnPage),
        supabase
          .from('stories_bookmarks_count')
          .select('id, bookmark_count')
          .in('id', storyIdsOnPage),
        supabase
          .from('story_alltime_views')
          .select('story_id, view_count')
          .in('story_id', storyIdsOnPage)
      ]);

      for (const row of (chaptersSummaryResult.data || [])) {
        chapterCountMap[row.story_id] = row.chapter_count;
        lastChapterMap[row.story_id] = row.last_chapter_number;
      }
      for (const r of (ratingsData.data || [])) {
        ratingsMap[r.story_id] = { avg_score: r.avg_score, rating_count: r.rating_count };
      }
      for (const b of (bookmarksData.data || [])) {
        bookmarksMap[b.id] = b.bookmark_count;
      }
      for (const v of (viewsData?.data || [])) {
        viewsMap[v.story_id] = v.view_count || 0;
      }
    }

    const stories = (rawStories || []).map(s => {
      const rating = ratingsMap[s.id] || { avg_score: 0, rating_count: 0 };
      return {
        ...s,
        chapter_count: chapterCountMap[s.id] || 0,
        last_chapter_number: lastChapterMap[s.id] || null,
        avg_score: rating.avg_score,
        rating_count: rating.rating_count,
        bookmark_count: bookmarksMap[s.id] || 0,
        view_count: viewsMap[s.id] || 0
      };
    });

    const totalPages = Math.ceil((totalCount || 0) / limit);

    // Render partial thành chuỗi HTML (không res.render trực tiếp vì cần trả JSON kèm URL mới
    // để phía client cập nhật history.pushState đúng)
    res.render('partials/stories-grid', {
      stories: stories || [],
      storyType,
      searchQuery: null,
      activeGenre: null,
      currentPage: page,
      totalPages,
      filters: { status: status || '' }
    }, (err, html) => {
      if (err) {
        console.error('Lỗi render partial stories-grid:', err);
        return res.status(500).json({ success: false, error: 'Lỗi render.' });
      }
      res.json({ success: true, html });
    });
  } catch (err) {
    console.error('Lỗi /api/stories-partial:', err);
    res.status(500).json({ success: false, error: 'Lỗi hệ thống.' });
  }
});

// TÌM KIẾM TRUYỆN (HỖ TRỢ LỌC NÂNG CAO KẾT HỢP NHIỀU TIÊU CHÍ)
router.get('/search', async (req, res) => {
  const query = req.query.q ? req.query.q.trim() : '';
  const genreSlug = req.query.genre || '';
  const status = req.query.status || ''; // '', 'ongoing', 'completed'
  const minChapters = req.query.min_chapters ? parseInt(req.query.min_chapters) : 0;
  const year = req.query.year ? parseInt(req.query.year) : null;
  const sort = req.query.sort || 'newest'; // newest | oldest | most_chapters | title_az
  const viewSort = req.query.view_sort || ''; // '', 'daily', 'monthly', 'all'

  try {
    const { data: genres } = await supabase.from('genres').select('*');

    // 1. Nếu lọc theo thể loại: lấy danh sách story_id thuộc thể loại đó trước
    let genreStoryIds = null;
    let activeGenre = null;
    if (genreSlug) {
      const { data: genreRow } = await supabase.from('genres').select('*').eq('slug', genreSlug).single();
      activeGenre = genreRow || null;
      if (activeGenre) {
        const { data: rel } = await supabase.from('story_genres').select('story_id').eq('genre_id', activeGenre.id);
        genreStoryIds = (rel || []).map(r => r.story_id);
      } else {
        genreStoryIds = [];
      }
    }

    // 2. Xây dựng câu truy vấn chính trên bảng stories (kèm số lượng chương qua chapters(count))
    let q = supabase.from('stories').select('*');

    if (query) {
      q = q.or(`title.ilike.%${query}%,author.ilike.%${query}%`);
    }
    if (status === 'ongoing' || status === 'completed') {
      q = q.eq('status', status);
    }
    if (year) {
      q = q.eq('year', year);
    }
    if (genreStoryIds !== null) {
      if (genreStoryIds.length === 0) {
        // Không có truyện nào thuộc thể loại này -> trả về rỗng ngay
        return res.render('home', {
          title: `Kết quả tìm kiếm`,
          user: req.user,
          stories: [],
          storyType: 'novel',
          genres,
          banners: [],
          rankUpEventsToday: [],
          topDaily: [], topWeekly: [], topMonthly: [], topYearly: [], topRated: [], topBookmarks: [],
          topComicDaily: [], topComicWeekly: [], topComicMonthly: [], topComicRated: [], topComicBookmarks: [], topComicAlltime: [],
          topNovelDaily: [], topNovelWeekly: [], topNovelMonthly: [], topNovelRated: [], topNovelBookmarks: [], topNovelAlltime: [],
          topReaders: [],
          topAuthors: [],
          lastRead: null,
          recentComments: [],
          currentPage: 1,
          totalPages: 1,
          activeGenre,
          searchQuery: query,
          filters: { genre: genreSlug, status, minChapters: req.query.min_chapters || '', year: req.query.year || '', sort, view_sort: viewSort }
        });
      }
      q = q.in('id', genreStoryIds);
    }

    // Sắp xếp cơ bản ở tầng database (số chương cần lọc/sắp ở tầng ứng dụng vì là quan hệ đếm)
    if (sort === 'oldest') {
      q = q.order('created_at', { ascending: true });
    } else if (sort === 'title_az') {
      q = q.order('title', { ascending: true });
    } else {
      q = q.order('created_at', { ascending: false }); // newest mặc định
    }

    const { data: rawStories, error } = await q;
    if (error) throw error;

    // Lấy số chương thực tế + map last_chapter_number, avg_score, rating_count, bookmark_count
    const storyIdsOnPage = (rawStories || []).map(s => s.id);
    let lastChapterMap = {};
    let ratingsMap = {};
    let bookmarksMap = {};
    let chapterCountMap = {};
    let viewsMap = {};

    if (storyIdsOnPage.length > 0) {
      // QUAN TRỌNG: KHÔNG order('chapter_number', {ascending:false}) trên toàn bộ chapters của
      // nhiều truyện cùng lúc rồi lấy "bản ghi đầu tiên gặp mỗi story_id" - Supabase giới hạn
      // mặc định 1000 dòng/query, nên nếu có truyện với chapter_number rất lớn (vd 3752, 4375)
      // trong danh sách, các dòng đó chiếm hết top 1000 theo thứ tự global DESC, đẩy chapters
      // của truyện ít chương hơn (vd chỉ tới chương 48) ra khỏi 1000 dòng đầu và bị cắt mất
      // => lastChapterMap không có story đó => hiển thị sai "Chưa có chương". Sửa bằng cách
      // tính max chapter_number cho TỪNG story_id bằng vòng lặp JS trên toàn bộ dữ liệu lấy về.
      const [chaptersSummaryResult, ratingsData, bookmarksData, viewsData] = await Promise.all([
        supabase
          .from('story_chapters_summary')
          .select('*')
          .in('story_id', storyIdsOnPage),
        supabase
          .from('story_ratings_summary')
          .select('*')
          .in('story_id', storyIdsOnPage),
        supabase
          .from('stories_bookmarks_count')
          .select('id, bookmark_count')
          .in('id', storyIdsOnPage),
        supabase
          .from('story_alltime_views')
          .select('story_id, view_count')
          .in('story_id', storyIdsOnPage)
      ]);

      for (const row of (chaptersSummaryResult.data || [])) {
        chapterCountMap[row.story_id] = row.chapter_count;
        lastChapterMap[row.story_id] = row.last_chapter_number;
      }
      for (const r of (ratingsData.data || [])) {
        ratingsMap[r.story_id] = { avg_score: r.avg_score, rating_count: r.rating_count };
      }
      for (const b of (bookmarksData.data || [])) {
        bookmarksMap[b.id] = b.bookmark_count;
      }
      for (const v of (viewsData?.data || [])) {
        viewsMap[v.story_id] = v.view_count || 0;
      }
    }

    let stories = (rawStories || []).map(s => {
      const rating = ratingsMap[s.id] || { avg_score: 0, rating_count: 0 };
      return {
        ...s,
        chapter_count: chapterCountMap[s.id] || 0,
        last_chapter_number: lastChapterMap[s.id] || null,
        avg_score: rating.avg_score,
        rating_count: rating.rating_count,
        bookmark_count: bookmarksMap[s.id] || 0,
        view_count: viewsMap[s.id] || 0
      };
    });

    if (minChapters > 0) {
      stories = stories.filter(s => s.chapter_count >= minChapters);
    }

    if (sort === 'most_chapters') {
      stories = stories.sort((a, b) => b.chapter_count - a.chapter_count);
    }

    if (viewSort === 'daily' || viewSort === 'monthly' || viewSort === 'all') {
      const viewCounts = {};
      try {
        if (viewSort === 'all') {
          const { data: viewsData, error: viewErr } = await supabase
            .from('story_alltime_views')
            .select('story_id, view_count');
          if (viewErr) throw viewErr;
          (viewsData || []).forEach(v => {
            viewCounts[v.story_id] = v.view_count || 0;
          });
        } else {
          const viewTable = viewSort === 'daily' ? 'views_ranking_daily' : 'views_ranking_monthly';
          const { data: viewsData, error: viewErr } = await supabase
            .from(viewTable)
            .select('id, view_count');
          if (viewErr) throw viewErr;
          (viewsData || []).forEach(v => {
            viewCounts[v.id] = v.view_count || 0;
          });
        }
      } catch (err) {
        console.error(`Lỗi khi query BXH views trong search (${viewSort}):`, err);
      }

      stories = stories.sort((a, b) => {
        const vA = viewCounts[a.id] || 0;
        const vB = viewCounts[b.id] || 0;
        return vB - vA;
      });
    }

    res.render('home', {
      title: query ? `Kết quả tìm kiếm cho: "${query}"` : 'Tìm kiếm nâng cao',
      user: req.user,
      stories,
      storyType: 'novel',
      genres,
      banners: [],
      rankUpEventsToday: [],
      topDaily: [], topWeekly: [], topMonthly: [], topYearly: [], topRated: [], topBookmarks: [],
      topComicDaily: [], topComicWeekly: [], topComicMonthly: [], topComicRated: [], topComicBookmarks: [], topComicAlltime: [],
      topNovelDaily: [], topNovelWeekly: [], topNovelMonthly: [], topNovelRated: [], topNovelBookmarks: [], topNovelAlltime: [],
      topReaders: [],
      topAuthors: [],
      lastRead: null,
      recentComments: [],
      currentPage: 1,
      totalPages: 1,
      activeGenre,
      searchQuery: query,
      filters: { genre: genreSlug, status, minChapters: req.query.min_chapters || '', year: req.query.year || '', sort, view_sort: viewSort }
    });
  } catch (err) {
    console.error('Lỗi tìm kiếm:', err);
    res.status(500).send('Lỗi tìm kiếm.');
  }
});

// Tuyến đường API lấy gợi ý tìm kiếm truyện hoặc tác giả
router.get('/api/search-suggestions', async (req, res) => {
  const q = req.query.q ? req.query.q.trim() : '';
  if (!q) {
    return res.json({ success: true, results: [] });
  }
  try {
    const { data, error } = await supabase
      .from('stories')
      .select('id, title, author, cover_url')
      .or(`title.ilike.%${q}%,author.ilike.%${q}%`)
      .limit(6);
    if (error) throw error;
    res.json({ success: true, results: data || [] });
  } catch (err) {
    console.error('Lỗi gợi ý tìm kiếm:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// LỌC THEO THỂ LOẠI
router.get('/genre/:slug', async (req, res) => {
  const slug = req.params.slug;
  try {
    const { data: genres } = await supabase.from('genres').select('*');
    
    // 1. Tìm thông tin thể loại hiện tại
    const { data: activeGenre, error: genreErr } = await supabase
      .from('genres')
      .select('*')
      .eq('slug', slug)
      .single();

    if (genreErr || !activeGenre) {
      return res.status(404).send('Không tìm thấy thể loại này.');
    }

    // 2. Tìm danh sách ID truyện thuộc thể loại này
    const { data: storyIdsData, error: relErr } = await supabase
      .from('story_genres')
      .select('story_id')
      .eq('genre_id', activeGenre.id);

    if (relErr) throw relErr;

    const storyIds = (storyIdsData || []).map(r => r.story_id);

    // 3. Lấy chi tiết các truyện từ ID
    let rawStories = [];
    if (storyIds.length > 0) {
      const { data: storiesData, error: storiesErr } = await supabase
        .from('stories')
        .select('*')
        .in('id', storyIds)
        .order('created_at', { ascending: false });
      
      if (storiesErr) throw storiesErr;
      rawStories = storiesData || [];
    }

    // Lấy số chương thực tế + map last_chapter_number, avg_score, rating_count, bookmark_count
    const storyIdsOnPage = rawStories.map(s => s.id);
    let lastChapterMap = {};
    let ratingsMap = {};
    let bookmarksMap = {};
    let chapterCountMap = {};
    let viewsMap = {};

    if (storyIdsOnPage.length > 0) {
      const [chaptersSummaryResult, ratingsData, bookmarksData, viewsData] = await Promise.all([
        supabase
          .from('story_chapters_summary')
          .select('*')
          .in('story_id', storyIdsOnPage),
        supabase
          .from('story_ratings_summary')
          .select('*')
          .in('story_id', storyIdsOnPage),
        supabase
          .from('stories_bookmarks_count')
          .select('id, bookmark_count')
          .in('id', storyIdsOnPage),
        supabase
          .from('story_alltime_views')
          .select('story_id, view_count')
          .in('story_id', storyIdsOnPage)
      ]);

      for (const row of (chaptersSummaryResult.data || [])) {
        chapterCountMap[row.story_id] = row.chapter_count;
        lastChapterMap[row.story_id] = row.last_chapter_number;
      }
      for (const r of (ratingsData.data || [])) {
        ratingsMap[r.story_id] = { avg_score: r.avg_score, rating_count: r.rating_count };
      }
      for (const b of (bookmarksData.data || [])) {
        bookmarksMap[b.id] = b.bookmark_count;
      }
      for (const v of (viewsData?.data || [])) {
        viewsMap[v.story_id] = v.view_count || 0;
      }
    }

    const stories = rawStories.map(s => {
      const rating = ratingsMap[s.id] || { avg_score: 0, rating_count: 0 };
      return {
        ...s,
        chapter_count: chapterCountMap[s.id] || 0,
        last_chapter_number: lastChapterMap[s.id] || null,
        avg_score: rating.avg_score,
        rating_count: rating.rating_count,
        bookmark_count: bookmarksMap[s.id] || 0,
        view_count: viewsMap[s.id] || 0
      };
    });

    res.render('home', {
      title: `Thể loại: ${activeGenre.name}`,
      user: req.user,
      stories,
      storyType: 'novel',
      genres,
      banners: [],
      rankUpEventsToday: [],
      topDaily: [], topWeekly: [], topMonthly: [], topYearly: [], topRated: [], topBookmarks: [],
      topComicDaily: [], topComicWeekly: [], topComicMonthly: [], topComicRated: [], topComicBookmarks: [], topComicAlltime: [],
      topNovelDaily: [], topNovelWeekly: [], topNovelMonthly: [], topNovelRated: [], topNovelBookmarks: [], topNovelAlltime: [],
      topReaders: [],
      topAuthors: [],
      lastRead: null,
      recentComments: [],
      currentPage: 1,
      totalPages: 1,
      activeGenre,
      searchQuery: null,
      filters: { genre: slug, status: '', minChapters: '', year: '', sort: 'newest', view_sort: '' }
    });
  } catch (err) {
    console.error('Lỗi lọc thể loại:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// LỌC THEO TÁC GIẢ
router.get('/author/:name', async (req, res) => {
  const authorName = req.params.name ? req.params.name.trim() : '';
  try {
    const { data: genres } = await supabase.from('genres').select('*');
    
    // Lấy tất cả truyện của tác giả này (kèm số lượng chương)
    const { data: rawStories, error } = await supabase
      .from('stories')
      .select('*')
      .ilike('author', authorName)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Lấy số chương thực tế + map last_chapter_number, avg_score, rating_count, bookmark_count
    const storyIdsOnPage = (rawStories || []).map(s => s.id);
    let lastChapterMap = {};
    let ratingsMap = {};
    let bookmarksMap = {};
    let chapterCountMap = {};
    let viewsMap = {};

    if (storyIdsOnPage.length > 0) {
      const [chaptersSummaryResult, ratingsData, bookmarksData, viewsData] = await Promise.all([
        supabase
          .from('story_chapters_summary')
          .select('*')
          .in('story_id', storyIdsOnPage),
        supabase
          .from('story_ratings_summary')
          .select('*')
          .in('story_id', storyIdsOnPage),
        supabase
          .from('stories_bookmarks_count')
          .select('id, bookmark_count')
          .in('id', storyIdsOnPage),
        supabase
          .from('story_alltime_views')
          .select('story_id, view_count')
          .in('story_id', storyIdsOnPage)
      ]);

      for (const row of (chaptersSummaryResult.data || [])) {
        chapterCountMap[row.story_id] = row.chapter_count;
        lastChapterMap[row.story_id] = row.last_chapter_number;
      }
      for (const r of (ratingsData.data || [])) {
        ratingsMap[r.story_id] = { avg_score: r.avg_score, rating_count: r.rating_count };
      }
      for (const b of (bookmarksData.data || [])) {
        bookmarksMap[b.id] = b.bookmark_count;
      }
      for (const v of (viewsData?.data || [])) {
        viewsMap[v.story_id] = v.view_count || 0;
      }
    }

    const stories = (rawStories || []).map(s => {
      const rating = ratingsMap[s.id] || { avg_score: 0, rating_count: 0 };
      return {
        ...s,
        chapter_count: chapterCountMap[s.id] || 0,
        last_chapter_number: lastChapterMap[s.id] || null,
        avg_score: rating.avg_score,
        rating_count: rating.rating_count,
        bookmark_count: bookmarksMap[s.id] || 0,
        view_count: viewsMap[s.id] || 0
      };
    });

    res.render('home', {
      title: `Tác giả: ${authorName}`,
      user: req.user,
      stories,
      storyType: 'novel',
      genres,
      banners: [],
      rankUpEventsToday: [],
      topDaily: [], topWeekly: [], topMonthly: [], topYearly: [], topRated: [], topBookmarks: [],
      topComicDaily: [], topComicWeekly: [], topComicMonthly: [], topComicRated: [], topComicBookmarks: [], topComicAlltime: [],
      topNovelDaily: [], topNovelWeekly: [], topNovelMonthly: [], topNovelRated: [], topNovelBookmarks: [], topNovelAlltime: [],
      topReaders: [],
      topAuthors: [],
      lastRead: null,
      recentComments: [],
      currentPage: 1,
      totalPages: 1,
      activeGenre: null,
      searchQuery: null,
      isAuthorPage: true,
      authorName,
      filters: { genre: '', status: '', minChapters: '', year: '', sort: 'newest', view_sort: '' }
    });
  } catch (err) {
    console.error('Lỗi lọc theo tác giả:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// RANDOM TRUYỆN ("HÔM NAY ĐỌC GÌ?")
router.get('/random', async (req, res) => {
  try {
    const { data: ids, error } = await supabase.from('stories').select('id');
    if (error) throw error;
    if (!ids || ids.length === 0) return res.redirect('/');

    const randomId = ids[Math.floor(Math.random() * ids.length)].id;
    res.redirect(`/story/${randomId}`);
  } catch (err) {
    console.error('Lỗi random truyện:', err);
    res.redirect('/');
  }
});

// TRANG CHI TIẾT TRUYỆN
router.get('/story/:id', async (req, res) => {
  const storyId = req.params.id;
  try {
    // 1. Lấy thông tin truyện
    const { data: story, error: storyErr } = await supabase
      .from('stories')
      .select('*')
      .eq('id', storyId)
      .single();

    if (storyErr || !story) {
      return res.status(404).send('Không tìm thấy truyện.');
    }

    // 2. Lấy danh sách thể loại của truyện này
    const { data: storyGenresData } = await supabase
      .from('story_genres')
      .select('genre_id, genres(name, slug)')
      .eq('story_id', storyId);

    const storyGenres = storyGenresData ? storyGenresData.map(g => g.genres) : [];

    // 3. Lấy danh sách chương của truyện
    // Supabase/PostgREST giới hạn tối đa 1000 dòng mỗi query - với truyện có >1000 chương phải
    // phân trang lấy nhiều lần rồi gộp lại, nếu không danh sách sẽ bị cắt cụt ở chương thứ 1000.
    let chapters = [];
    {
      const PAGE_SIZE = 1000;
      let from = 0;
      while (true) {
        const { data: pageData, error: pageErr } = await supabase
          .from('chapters')
          .select('id, chapter_number, title, created_at, views')
          .eq('story_id', storyId)
          .order('chapter_number', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (pageErr) throw pageErr;
        if (!pageData || pageData.length === 0) break;

        chapters = chapters.concat(pageData);
        if (pageData.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
    }

    // 4. Nếu người dùng đã đăng nhập: lấy tiến độ đọc + trạng thái bookmark + điểm đã chấm của truyện này
    let readingProgress = null;
    let bookmarkStatus = null;
    let myRating = null;
    if (req.user && req.user.id) {
      const { data: progress } = await supabase
        .from('reading_history')
        .select('chapter_number')
        .eq('user_id', req.user.id)
        .eq('story_id', storyId)
        .single();
      readingProgress = progress ? progress.chapter_number : null;

      const { data: bookmark } = await supabase
        .from('bookmarks')
        .select('status')
        .eq('user_id', req.user.id)
        .eq('story_id', storyId)
        .single();
      bookmarkStatus = bookmark ? bookmark.status : null;

      const { data: ratingRow } = await supabase
        .from('ratings')
        .select('score')
        .eq('user_id', req.user.id)
        .eq('story_id', storyId)
        .single();
      myRating = ratingRow ? ratingRow.score : null;
    }

    // 5. Lấy điểm trung bình + số lượt đánh giá của truyện
    const { data: ratingSummary } = await supabase
      .from('story_ratings_summary')
      .select('*')
      .eq('story_id', storyId)
      .single();

    // 6. Lấy danh sách bình luận (chỉ lấy bình luận ở cấp độ truyện, tức chapter_number IS NULL)
    let comments = [];
    try {
      const { data: commentsData } = await supabase
        .from('comments')
        .select('*, users!comments_user_id_fkey(display_name, avatar, equipped_badge, equipped_frame, user_stats(chapters_read))')
        .eq('story_id', storyId)
        .order('created_at', { ascending: false });
      
      comments = commentsData || [];
      for (const c of comments) {
        const { count } = await supabase.from('comment_likes').select('*', { count: 'exact', head: true }).eq('comment_id', c.id);
        c.likes_count = count || 0;
        
        c.user_liked = false;
        if (req.user && req.user.id) {
          const { data: liked } = await supabase.from('comment_likes').select('*').eq('comment_id', c.id).eq('user_id', req.user.id).single();
          if (liked) c.user_liked = true;
        }
      }
    } catch (e) {
      console.error('Lỗi lấy bình luận truyện:', e);
    }

    let totalViews = 0;
    try {
      const { data: vRow } = await supabase
        .from('story_alltime_views')
        .select('view_count')
        .eq('story_id', storyId)
        .maybeSingle();
      if (vRow) totalViews = vRow.view_count || 0;
    } catch (vErr) {
      console.error('Lỗi lấy tổng view truyện:', vErr);
    }

    res.render('story', {
      title: `${story.title} - Chi tiết truyện`,
      user: req.user,
      story,
      genres: storyGenres,
      chapters,
      readingProgress,
      bookmarkStatus,
      myRating,
      avgScore: ratingSummary ? ratingSummary.avg_score : null,
      ratingCount: ratingSummary ? ratingSummary.rating_count : 0,
      totalViews,
      comments
    });
  } catch (err) {
    console.error('Lỗi chi tiết truyện:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// TUYẾN ĐƯỜNG TẢI TRUYỆN DƯỚI DẠNG FILE EPUB
router.get('/story/download-epub/:id', async (req, res) => {
  const storyId = parseInt(req.params.id);
  try {
    const { data: story, error: storyErr } = await supabase
      .from('stories')
      .select('*')
      .eq('id', storyId)
      .single();

    if (storyErr || !story) {
      return res.status(404).send('Không tìm thấy truyện.');
    }

    let chapters = [];
    let page = 0;
    const limit = 1000;
    let hasMore = true;
    while (hasMore) {
      const { data: batch, error: chapErr } = await supabase
        .from('chapters')
        .select('*')
        .eq('story_id', storyId)
        .order('chapter_number', { ascending: true })
        .range(page * limit, (page + 1) * limit - 1);

      if (chapErr) {
        console.error('Lỗi lấy chương để tải EPUB:', chapErr);
        break;
      }

      if (!batch || batch.length === 0) {
        hasMore = false;
      } else {
        chapters = chapters.concat(batch);
        if (batch.length < limit) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }

    if (chapters.length === 0) {
      return res.status(400).send('Truyện chưa có chương nào để tải.');
    }

    const epubBuffer = await generateEpub(story, chapters);
    const safeTitle = story.title
      .replace(/[^a-zA-Z0-9ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯưẠ-ỹ]/g, '_')
      .substring(0, 100);

    res.setHeader('Content-Type', 'application/epub+zip');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeTitle)}.epub"`);
    res.send(epubBuffer);
  } catch (err) {
    console.error('Lỗi tải xuống EPUB:', err);
    res.status(500).send('Lỗi hệ thống khi tạo file EPUB.');
  }
});

// TRANG ĐỌC CHƯƠNG TRUYỆN
router.get('/story/:story_id/chapter/:chapter_number', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const storyId = parseInt(req.params.story_id);
  const chapterNumber = parseFloat(req.params.chapter_number);
  
  try {
    // 1. Lấy thông tin truyện (kèm story_type để phân biệt truyện tranh hay truyện chữ)
    const { data: story } = await supabase.from('stories').select('id, title, story_type').eq('id', storyId).single();
    if (!story) return res.status(404).send('Không tìm thấy truyện.');

    // 2. Lấy nội dung chương
    const { data: chapter, error: chapterErr } = await supabase
      .from('chapters')
      .select('*')
      .eq('story_id', storyId)
      .eq('chapter_number', chapterNumber)
      .single();

    if (chapterErr || !chapter) {
      return res.status(404).send('Không tìm thấy chương truyện.');
    }

    // 3. Ghi nhận lượt xem (Views) có chống buff ảo
    const ipAddress = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    const cooldownTime = new Date(Date.now() - 30 * 1000).toISOString();

    supabase
      .from('story_views')
      .select('id')
      .eq('story_id', storyId)
      .eq('ip_address', ipAddress)
      .gt('created_at', cooldownTime)
      .limit(1)
      .then(({ data: existingViews, error: checkError }) => {
        if (checkError) {
          console.error('Lỗi kiểm tra cooldown views:', checkError);
          return;
        }

        if (!existingViews || existingViews.length === 0) {
          supabase.from('story_views').insert([{ story_id: storyId, ip_address: ipAddress }]).then(({ error }) => {
            if (error) console.error('Lỗi khi ghi nhận views truyện:', error);
          });

          supabase.rpc('increment_chapter_views', { chap_id: chapter.id }).then(({ error }) => {
            if (error) console.error('Lỗi khi ghi nhận views chương:', error);
          });
        }
      });

    // 3b. Lưu lịch sử đọc (tiến độ đọc gần nhất) nếu người dùng đã đăng nhập
    if (req.user && req.user.id) {
      (async () => {
        try {
          const { data: existHist } = await supabase
            .from('reading_history')
            .select('id')
            .eq('user_id', req.user.id)
            .eq('story_id', storyId)
            .maybeSingle();

          if (existHist) {
            await supabase.from('reading_history').update({
              chapter_number: chapterNumber,
              updated_at: new Date().toISOString()
            }).eq('id', existHist.id);
          } else {
            await supabase.from('reading_history').insert([{
              user_id: req.user.id,
              story_id: storyId,
              chapter_number: chapterNumber,
              updated_at: new Date().toISOString()
            }]);
          }
        } catch (e) {
          console.error('Lỗi khi lưu lịch sử đọc:', e);
        }
      })();

      // 3c. Lưu thông tin bắt đầu đọc vào session để tính thời gian đọc (hỗ trợ nhiều tab và auto audio)
      if (!req.session.readings) req.session.readings = {};
      const readKey = `${storyId}_${chapterNumber}`;
      if (!req.session.readings[readKey] || req.session.readings[readKey].claimed) {
        req.session.readings[readKey] = {
          storyId: storyId,
          chapterNumber: chapterNumber,
          startTime: Date.now(),
          claimed: false
        };
      }
      req.session.reading = req.session.readings[readKey];
    }


    // 4. Lấy danh sách toàn bộ chương để hiển thị trong mục lục nhanh và tính toán điều hướng (hỗ trợ phân trang để vượt qua giới hạn 1000 dòng của PostgREST)
    let chaptersList = [];
    {
      const PAGE_SIZE = 1000;
      let from = 0;
      while (true) {
        const { data: pageData, error: pageErr } = await supabase
          .from('chapters')
          .select('id, chapter_number, title')
          .eq('story_id', storyId)
          .order('chapter_number', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (pageErr) throw pageErr;
        if (!pageData || pageData.length === 0) break;

        chaptersList = chaptersList.concat(pageData);
        if (pageData.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
    }

    // Tìm chương trước và chương sau dựa trên danh sách đã sắp xếp để hỗ trợ cả số thập phân và khoảng trống
    const currentIndex = (chaptersList || []).findIndex(ch => Number(ch.chapter_number) === Number(chapterNumber));
    const prevChapter = currentIndex > 0 ? chaptersList[currentIndex - 1] : null;
    const nextChapter = currentIndex !== -1 && currentIndex < (chaptersList || []).length - 1 ? chaptersList[currentIndex + 1] : null;

    // 5. Lấy danh sách bình luận của chương truyện này
    let comments = [];
    try {
      const { data: commentsData } = await supabase
        .from('comments')
        .select('*, users!comments_user_id_fkey(display_name, avatar, equipped_badge, equipped_frame, user_stats(chapters_read))')
        .eq('story_id', storyId)
        .eq('chapter_number', chapterNumber)
        .order('created_at', { ascending: false });
      
      comments = commentsData || [];
      for (const c of comments) {
        const { count } = await supabase.from('comment_likes').select('*', { count: 'exact', head: true }).eq('comment_id', c.id);
        c.likes_count = count || 0;
        
        c.user_liked = false;
        if (req.user && req.user.id) {
          const { data: liked } = await supabase.from('comment_likes').select('*').eq('comment_id', c.id).eq('user_id', req.user.id).single();
          if (liked) c.user_liked = true;
        }
      }
    } catch (e) {
      console.error('Lỗi lấy bình luận chương:', e);
    }

    // Tối ưu tốc độ tải ảnh truyện tranh:
    // 1. Khử triệt để ký tự xuống dòng thừa \r \n ở cuối URL ảnh (vd: .jpg\r)
    // 2. Xóa bỏ các div chứa ảnh rác tương đối (/wp-content/uploads/...)
    // 3. Thêm referrerpolicy="no-referrer" để chống CDN chặn Referer
    // 4. Xóa bỏ loading="lazy" (nếu có từ crawler) để trình duyệt tải song song toàn bộ ảnh ngay khi mở trang
    // 5. Thêm loading="eager" & decoding="async" & fetchpriority="high" cho các ảnh đầu tiên
    if (chapter && chapter.content) {
      // Làm sạch khoảng trắng/xuống dòng thừa giữa các thẻ HTML để tránh lỗi cách 2 dòng khi hiển thị
      if (/<p\b|<div\b/i.test(chapter.content)) {
        chapter.content = chapter.content
          .replace(/(<\/p>|<\/div>|<br\s*\/?>)\s*[\r\n]+/gi, '$1')
          .replace(/[\r\n]+\s*(<p\b|<div\b)/gi, '$1');
      }

      // Khử ký tự xuống dòng thừa \r \n hoặc khoảng trắng ở cuối URL ảnh (lỗi crawler Windows)
      chapter.content = chapter.content.replace(/src=["']([^"'>\r\n\s]+)[\r\n\s]*["']/gi, 'src="$1"');

      // Xóa các ảnh rác đường dẫn tương đối (/wp-content/...) gây lỗi 404
      chapter.content = chapter.content.replace(/<img[^>]*src=["']\/wp-content\/[^"']*["'][^>]*>/gi, '');
      chapter.content = chapter.content.replace(/<div[^>]*>\s*<img[^>]*src="\/wp-content\/[^"]*"[^>]*>\s*<\/div>/gi, '');

      chapter.content = chapter.content.replace(/\s*loading=["']?lazy["']?/gi, '');
      let imgIdx = 0;
      chapter.content = chapter.content.replace(/<img\b/gi, () => {
        imgIdx++;
        if (imgIdx <= 5) {
          return '<img fetchpriority="high" loading="eager" decoding="async"';
        }
        return '<img loading="eager" decoding="async"';
      });
    }

    // Tính toán thời gian đọc tối thiểu (seconds) để đồng bộ với backend
    let requiredSeconds = 90;
    if (chapter && chapter.content) {
      const cleanText = chapter.content.replace(/<[^>]*>/g, ' ').trim();
      const wordsCount = cleanText.split(/\s+/).filter(w => w.length > 0).length;
      if (wordsCount < 1500) {
        requiredSeconds = 60;
      }
    }

    res.render('read', {
      title: `Đọc truyện ${story.title} - Chương ${chapter.chapter_number}: ${chapter.title}`,
      user: req.user,
      story,
      chapter,
      hasPrev: !!prevChapter,
      hasNext: !!nextChapter,
      prevChapterNum: prevChapter ? prevChapter.chapter_number : null,
      nextChapterNum: nextChapter ? nextChapter.chapter_number : null,
      chaptersList: chaptersList || [],
      comments,
      requiredSeconds
    });
  } catch (err) {
    console.error('Lỗi đọc chương:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// Route xác nhận đọc chương truyện đủ thời gian để nhận EXP
router.post('/chapter/read-confirm', async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, error: 'Vui lòng đăng nhập để ghi nhận EXP.' });
  }
  
  if (req.user.is_banned) {
    return res.status(403).json({ success: false, error: 'Tài khoản của bạn đã bị khóa.' });
  }

  const { story_id, chapter_number } = req.body;
  const storyId = parseInt(story_id);
  const chapterNumber = parseFloat(chapter_number);

  if (!storyId || !chapterNumber) {
    return res.status(400).json({ success: false, error: 'Tham số chương hoặc truyện không hợp lệ.' });
  }

  const readKey = `${storyId}_${chapterNumber}`;
  if (!req.session.readings) req.session.readings = {};

  // 1. Nếu chương này đã được xác nhận EXP thành công trong phiên này -> Trả về thành công luôn
  if (req.session.readings[readKey]?.claimed) {
    return res.json({
      success: true,
      message: 'Đã hoàn thành chương này! (EXP đã được ghi nhận trước đó)',
      rankUp: null,
      cardDrop: null
    });
  }

  // 2. Tìm thời điểm bắt đầu đọc: Ưu tiên session, nếu mất session (do tab/cookie) thì tra cứu reading_history từ DB
  let startTime = null;
  if (req.session.readings[readKey]?.startTime) {
    startTime = req.session.readings[readKey].startTime;
  } else if (req.session.reading && req.session.reading.storyId === storyId && req.session.reading.chapterNumber === chapterNumber) {
    startTime = req.session.reading.startTime;
  } else {
    try {
      const { data: existHist } = await supabase
        .from('reading_history')
        .select('updated_at')
        .eq('user_id', req.user.id)
        .eq('story_id', storyId)
        .eq('chapter_number', chapterNumber)
        .maybeSingle();

      if (existHist && existHist.updated_at) {
        startTime = new Date(existHist.updated_at).getTime();
      }
    } catch (e) {
      console.error('Lỗi kiểm tra reading_history:', e);
    }
  }

  // 3. Nếu vẫn không tìm thấy thời điểm bắt đầu đọc
  if (!startTime) {
    // Khởi tạo thời gian đọc hiện tại để độc giả không bị lỗi ngắt quãng khi nghe audio tự chuyển chương
    req.session.readings[readKey] = {
      storyId,
      chapterNumber,
      startTime: Date.now(),
      claimed: false
    };
    req.session.reading = req.session.readings[readKey];
    return res.status(400).json({ 
      success: false, 
      error: 'Hệ thống đang bắt đầu tính giờ đọc chương này. Vui lòng đọc thêm ít giây nhé!' 
    });
  }

  const elapsedMs = Date.now() - startTime;
  
  // Truy vấn database để đếm số chữ của chương này
  let requiredMs = 90 * 1000; // Mặc định 1.5 phút
  try {
    const { data: chapterData } = await supabase
      .from('chapters')
      .select('content')
      .eq('story_id', storyId)
      .eq('chapter_number', chapterNumber)
      .single();

    if (chapterData && chapterData.content) {
      // Loại bỏ thẻ HTML trước khi đếm từ
      const cleanText = chapterData.content.replace(/<[^>]*>/g, ' ').trim();
      const wordsCount = cleanText.split(/\s+/).filter(w => w.length > 0).length;
      if (wordsCount < 1500) {
        requiredMs = 60 * 1000; // Dưới 1500 từ yêu cầu 60 giây
      }
    }
  } catch (err) {
    console.error('Lỗi khi tính số từ của chương:', err);
  }

  if (elapsedMs < requiredMs) {
    const remainingSeconds = Math.ceil((requiredMs - elapsedMs) / 1000);
    return res.status(400).json({ 
      success: false, 
      error: `Vui lòng đọc tiếp. Cần đọc thêm ${remainingSeconds} giây nữa để ghi nhận EXP!` 
    });
  }

  // Cộng EXP Đọc Truyện
  let earnedExp = false;
  let rankUp = null;
  try {
    const result = await awardReadingExp(req.user.id, storyId, chapterNumber);
    earnedExp = result ? result.earnedExp : false;
    rankUp = result ? result.rankUp : null;
    if (earnedExp) {
      await awardReadingCardDrop(req.user.id, result.chaptersRead || 1);
    }
  } catch (err) {
    console.error('Lỗi cộng EXP trong xác nhận:', err);
  }

  // Đánh dấu đã nhận EXP cho chương này trong session
  req.session.readings[readKey] = {
    storyId,
    chapterNumber,
    startTime: startTime,
    claimed: true
  };
  delete req.session.reading;

  const message = earnedExp ? 'Đã ghi nhận đọc chương thành công! +5 EXP' : 'Đã ghi nhận đọc chương. (Chương này đã tính EXP trước đó)';

  res.json({
    success: true,
    message,
    rankUp,
    cardDrop: null
  });
});

// CHẤM ĐIỂM ĐÁNH GIÁ TRUYỆN (1-10) - CẦN ĐĂNG NHẬP
router.post('/rate/:story_id', async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, error: 'Vui lòng đăng nhập để đánh giá truyện.' });
  }
  if (req.user.is_banned) {
    return res.status(403).json({ success: false, error: 'Tài khoản của bạn đã bị khóa bởi quản trị viên.' });
  }

  const storyId = parseInt(req.params.story_id);
  const score = parseInt(req.body.score);

  if (!score || score < 1 || score > 10) {
    return res.status(400).json({ success: false, error: 'Điểm đánh giá phải từ 1 đến 10.' });
  }

  try {
    const { data: existRating } = await supabase
      .from('ratings')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('story_id', storyId)
      .maybeSingle();

    if (existRating) {
      const { error } = await supabase
        .from('ratings')
        .update({ score })
        .eq('id', existRating.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('ratings')
        .insert([{ user_id: req.user.id, story_id: storyId, score }]);
      if (error) throw error;
    }

    const { data: summary } = await supabase
      .from('story_ratings_summary')
      .select('*')
      .eq('story_id', storyId)
      .single();

    res.json({
      success: true,
      message: 'Đã ghi nhận đánh giá của bạn!',
      avgScore: summary ? summary.avg_score : score,
      ratingCount: summary ? summary.rating_count : 1
    });
  } catch (err) {
    console.error('Lỗi khi chấm điểm:', err);
    res.status(500).json({ success: false, error: err.message || 'Lỗi hệ thống.' });
  }
});

// THÊM/CẬP NHẬT/GỠ BOOKMARK (THEO DÕI TRUYỆN) - CẦN ĐĂNG NHẬP
router.post('/bookmark/:story_id', async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, error: 'Vui lòng đăng nhập để sử dụng tính năng này.' });
  }

  const storyId = parseInt(req.params.story_id);
  const { status, remove } = req.body; // status: reading | plan_to_read | completed | favorite

  try {
    if (remove) {
      const { error } = await supabase
        .from('bookmarks')
        .delete()
        .eq('user_id', req.user.id)
        .eq('story_id', storyId);
      if (error) throw error;
      return res.json({ success: true, message: 'Đã bỏ theo dõi truyện.', status: null });
    }

    const validStatuses = ['reading', 'plan_to_read', 'completed', 'favorite'];
    const newStatus = validStatuses.includes(status) ? status : 'reading';

    const { data: existBookmark } = await supabase
      .from('bookmarks')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('story_id', storyId)
      .maybeSingle();

    if (existBookmark) {
      const { error } = await supabase
        .from('bookmarks')
        .update({ status: newStatus })
        .eq('id', existBookmark.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('bookmarks')
        .insert([{ user_id: req.user.id, story_id: storyId, status: newStatus }]);
      if (error) throw error;
    }

    res.json({ success: true, message: 'Đã cập nhật theo dõi truyện!', status: newStatus });
  } catch (err) {
    console.error('Lỗi khi cập nhật bookmark:', err);
    res.status(500).json({ success: false, error: err.message || 'Lỗi hệ thống.' });
  }
});

// Ngưỡng huy hiệu theo số chương đã đọc
const BADGE_THRESHOLDS = [
  { count: 1000, label: '👑 Huyền Thoại', badge: 'legend' },
  { count: 500, label: '🏆 Đại Cao Thủ', badge: 'grandmaster' },
  { count: 100, label: '🥇 Master Reader', badge: 'master' },
  { count: 20, label: '🥈 Mọt Sách', badge: 'bookworm' },
  { count: 1, label: '🥉 Người Mới', badge: 'newbie' }
];

function getBadgeForCount(count, rankSettings = null) {
  const thresholds = rankSettings && rankSettings.length > 0 ? rankSettings : BADGE_THRESHOLDS;
  for (const b of thresholds) {
    if (count >= b.count) return b;
  }
  return null;
}

// TRANG "TỦ TRUYỆN CỦA TÔI" (DANH SÁCH CÁ NHÂN) - CẦN ĐĂNG NHẬP
router.get('/my-library', async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.redirect('/auth/login');
  }

  try {
    const { data: bookmarks, error } = await supabase
      .from('bookmarks')
      .select('status, story_id, stories(*)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const storyIds = (bookmarks || []).map(b => b.story_id);
    let progressMap = {};
    if (storyIds.length > 0) {
      const { data: historyRows } = await supabase
        .from('reading_history')
        .select('story_id, chapter_number')
        .eq('user_id', req.user.id)
        .in('story_id', storyIds);
      (historyRows || []).forEach(h => { progressMap[h.story_id] = h.chapter_number; });
    }

    const stories = (bookmarks || []).map(b => {
      if (!b.stories) return null;
      return { ...b.stories, lastReadChapter: progressMap[b.story_id] || null };
    }).filter(Boolean);

    res.render('my-library', {
      title: 'Tủ truyện của tôi',
      user: req.user,
      stories
    });
  } catch (err) {
    console.error('Lỗi trang tủ truyện:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// ADMIN: PHÂN LOẠI TRUYỆN TRANH / TRUYỆN CHỮ (chạy 1 lần)
// Yêu cầu: bảng stories phải có cột story_type TEXT DEFAULT 'novel'
router.get('/admin/classify-stories', async (req, res) => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'sp_admin')) {
    return res.status(403).send('Không có quyền truy cập.');
  }
  try {
    const { classifyAndSaveAll } = require('../services/storyClassifier');
    const result = await classifyAndSaveAll();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// TRANG ỦNG HỘ ADMIN (DONATE QR)
router.get('/donate', (req, res) => {
  res.render('donate', {
    title: 'Ủng hộ Admin',
    user: req.user
  });
});


// TRANG LIÊN HỆ / ĐẶT VIẾT TRUYỆN
router.get('/contact', (req, res) => {
  res.render('contact', {
    title: 'Đặt viết truyện - Liên hệ Admin',
    user: req.user,
    success: null,
    error: null
  });
});

// GỬI YÊU CẦU LIÊN HỆ (ĐÍNH KÈM NHIỀU ẢNH)
router.post('/contact/submit', upload.array('attachments', 10), async (req, res) => {
  const { name, content } = req.body;
  
  if (!name || !content) {
    return res.render('contact', {
      title: 'Đặt viết truyện - Liên hệ Admin',
      user: req.user,
      success: null,
      error: 'Vui lòng điền đầy đủ Họ tên và Nội dung yêu cầu.'
    });
  }

  try {
    // Tải lên hàng loạt file ảnh lên Supabase Storage
    const filePaths = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const url = await uploadToSupabase(file, 'uploads');
        if (url) filePaths.push(url);
      }
    }

    // Lưu yêu cầu liên hệ vào database Supabase
    const { error } = await supabase
      .from('contact_requests')
      .insert([
        {
          name: name,
          content: content,
          attachments: filePaths
        }
      ]);

    if (error) throw error;

    res.render('contact', {
      title: 'Đặt viết truyện - Liên hệ Admin',
      user: req.user,
      success: 'Yêu cầu của bạn đã được gửi thành công đến Ban Quản trị! Chúng tôi sẽ xem xét và phản hồi sớm nhất.',
      error: null
    });

  } catch (err) {
    console.error('Lỗi gửi liên hệ:', err);
    res.render('contact', {
      title: 'Đặt viết truyện - Liên hệ Admin',
      user: req.user,
      success: null,
      error: 'Có lỗi xảy ra khi lưu yêu cầu của bạn. Vui lòng thử lại.'
    });
  }
});

// ==========================================
// HỆ THỐNG THÀNH TỰU & BÌNH LUẬN & THÔNG BÁO & AI GỢI Ý & LEADERBOARD

// Quét nhắc tên @mention trong bình luận
async function handleCommentMentions(commentContent, storyId, chapterNumber, senderName) {
  const mentionRegex = /@([a-zA-Z0-9_\sà-ỹÀ-Ỹ]+)/g;
  let match;
  const mentionedNames = [];
  while ((match = mentionRegex.exec(commentContent)) !== null) {
    mentionedNames.push(match[1].trim());
  }
  for (const name of mentionedNames) {
    const { data: u } = await supabase.from('users').select('id').ilike('display_name', name).single();
    if (u) {
      await supabase.from('notifications').insert([{
        user_id: u.id,
        message: `💬 ${senderName} đã nhắc đến bạn trong một bình luận!`,
        link: `/story/${storyId}${chapterNumber ? '/chapter/' + chapterNumber : ''}`
      }]);
    }
  }
}

// Route đăng bình luận
router.post('/story/:story_id/comment', async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, error: 'Vui lòng đăng nhập để bình luận.' });
  }
  if (req.user.is_banned) {
    return res.status(403).json({ success: false, error: 'Tài khoản của bạn đã bị khóa bởi quản trị viên.' });
  }
  const storyId = parseInt(req.params.story_id);
  const { content, chapter_number, parent_id } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ success: false, error: 'Bình luận không được để trống.' });
  }

  try {
    const commentData = {
      story_id: storyId,
      chapter_number: chapter_number ? parseFloat(chapter_number) : null,
      user_id: req.user.id,
      content: content.trim(),
      parent_id: parent_id ? parseInt(parent_id) : null
    };

    const { data: newComment, error } = await supabase
      .from('comments')
      .insert([commentData])
      .select('*, users!comments_user_id_fkey(display_name, avatar, equipped_badge, equipped_frame, user_stats(chapters_read))')
      .single();

    if (error) throw error;

    // Quét nhắc tên @mention
    await handleCommentMentions(content, storyId, chapter_number, req.user.display_name);

    // Gửi thông báo cho bình luận gốc nếu là phản hồi
    if (parent_id) {
      const { data: parentComment } = await supabase.from('comments').select('user_id').eq('id', parent_id).single();
      if (parentComment && parentComment.user_id !== req.user.id) {
        await supabase.from('notifications').insert([{
          user_id: parentComment.user_id,
          message: `💬 ${req.user.display_name} đã phản hồi bình luận của bạn!`,
          link: `/story/${storyId}${chapter_number ? '/chapter/' + chapter_number : ''}`
        }]);
      }
    }

    // Mở khóa thành tựu bình luận đầu tiên
    await unlockAchievement(req.user.id, 'Người đóng góp');

    res.json({ success: true, comment: newComment });
  } catch (err) {
    console.error('Lỗi khi thêm bình luận:', err);
    res.status(500).json({ success: false, error: err.message || 'Lỗi hệ thống.' });
  }
});

// Route thích bình luận
router.post('/comment/:id/like', async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, error: 'Vui lòng đăng nhập.' });
  }
  const commentId = parseInt(req.params.id);

  try {
    const { data: existing } = await supabase
      .from('comment_likes')
      .select('*')
      .eq('comment_id', commentId)
      .eq('user_id', req.user.id)
      .single();

    let liked = false;
    if (existing) {
      await supabase.from('comment_likes').delete().eq('comment_id', commentId).eq('user_id', req.user.id);
    } else {
      await supabase.from('comment_likes').insert([{ comment_id: commentId, user_id: req.user.id }]);
      liked = true;

      const { data: comment } = await supabase.from('comments').select('user_id, story_id, chapter_number').eq('id', commentId).single();
      if (comment && comment.user_id !== req.user.id) {
        await supabase.from('notifications').insert([{
          user_id: comment.user_id,
          message: `❤️ ${req.user.display_name} đã thích bình luận của bạn!`,
          link: `/story/${comment.story_id}${comment.chapter_number ? '/chapter/' + comment.chapter_number : ''}`
        }]);
      }
    }

    const { count } = await supabase.from('comment_likes').select('*', { count: 'exact', head: true }).eq('comment_id', commentId);
    res.json({ success: true, liked, likesCount: count || 0 });
  } catch (err) {
    console.error('Lỗi thích bình luận:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route xóa bình luận (User xóa của mình hoặc Admin xóa)
router.post('/comment/:id/delete', async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, error: 'Vui lòng đăng nhập.' });
  }
  const commentId = parseInt(req.params.id);
  try {
    const { data: comment, error: fetchErr } = await supabase
      .from('comments')
      .select('user_id')
      .eq('id', commentId)
      .single();
      
    if (fetchErr || !comment) {
      return res.status(404).json({ success: false, error: 'Bình luận không tồn tại.' });
    }
    
    const isOwner = comment.user_id === req.user.id;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'sp_admin';
    
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Bạn không có quyền xóa bình luận này.' });
    }
    
    const { error: deleteErr } = await supabase
      .from('comments')
      .delete()
      .eq('id', commentId);
      
    if (deleteErr) throw deleteErr;
    
    res.json({ success: true });
  } catch (err) {
    console.error('Lỗi khi xóa bình luận:', err);
    res.status(500).json({ success: false, error: 'Lỗi hệ thống khi xóa bình luận.' });
  }
});

// Route đọc tất cả thông báo
router.post('/notifications/read-all', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ success: false });
  try {
    await supabase.from('notifications').update({ is_read: true }).eq('user_id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Trang cá nhân người dùng
router.get('/profile', async (req, res) => {
  if (!req.user || !req.user.id) return res.redirect('/auth/login');

  try {
    const { data: stats } = await supabase
      .from('user_stats')
      .select('*')
      .eq('user_id', req.user.id)
      .single();

    const { data: userData } = await supabase
      .from('users')
      .select('display_name, avatar, bio, equipped_badge, equipped_avatar, equipped_frame')
      .eq('id', req.user.id)
      .single();

    if (userData) {
      req.user.display_name = userData.display_name;
      req.user.avatar = userData.avatar;
      req.user.bio = userData.bio;
      req.user.equipped_badge = userData.equipped_badge;
      req.user.equipped_avatar = userData.equipped_avatar;
      req.user.equipped_frame = userData.equipped_frame;
    }

    const exp = stats ? stats.exp : 0;
    const streak = stats ? stats.streak_days : 0;

    const level = Math.floor(exp / 100) + 1;
    const nextLevelExp = 100;
    const currentLevelExp = exp % 100;

    const { data: unlocked } = await supabase
      .from('user_achievements')
      .select('unlocked_at, achievements(*)')
      .eq('user_id', req.user.id);

    const achievements = (unlocked || []).map(ua => ({
      ...ua.achievements,
      unlocked_at: ua.unlocked_at
    }));

    const { data: notifications } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(30);

    // Dùng chapters_read từ user_stats (đồng bộ với BXH độc giả và logic lên rank) -
    // KHÔNG dùng chapter_reads (bảng chỉ đếm chương duy nhất, không tính đọc lại) để tránh 2 nơi hiển thị lệch nhau.
    const chaptersCount = stats ? (stats.chapters_read || 0) : 0;

    // Lấy cài đặt Rank từ database
    const { data: rankSettings } = await supabase
      .from('rank_settings')
      .select('*')
      .order('count', { ascending: false });

    const badge = getBadgeForCount(chaptersCount, rankSettings);

    const { data: inventory } = await supabase
      .from('user_inventory')
      .select('item_id, shop_items(*)')
      .eq('user_id', req.user.id);
      
    const ownedItems = (inventory || []).map(i => i.shop_items).filter(Boolean);

    // Tính toán Rank (Hạng trên BXH Độc Giả)
    // Sắp xếp BXH theo đúng logic chapters_read desc, exp desc để lấy index chuẩn xác của user
    const { data: leaderboardData } = await supabase
      .from('leaderboard_by_exp')
      .select('id')
      .order('chapters_read', { ascending: false })
      .order('exp', { ascending: false });

    let userRank = '-';
    if (leaderboardData) {
      const idx = leaderboardData.findIndex(item => item.id === req.user.id);
      if (idx !== -1) {
        userRank = idx + 1;
      }
    }

    res.render('profile', {
      title: 'Trang cá nhân của tôi',
      user: req.user,
      userData: userData || req.user,
      stats: {
        exp,
        streak,
        level,
        currentLevelExp,
        nextLevelExp,
        chaptersRead: chaptersCount || 0,
        badge: badge ? badge.label : 'Người mới',
        rank: userRank
      },
      achievements,
      notifications: notifications || [],
      ownedItems
    });
  } catch (err) {
    console.error('Lỗi khi tải trang cá nhân:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// Route cập nhật hồ sơ người dùng
router.post('/profile/update', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).send('Chưa đăng nhập');
  const { display_name, bio } = req.body;
  if (!display_name || !display_name.trim()) {
    return res.status(400).send('Tên hiển thị không được để trống.');
  }

  try {
    const { error } = await supabase
      .from('users')
      .update({ 
        display_name: display_name.trim(), 
        bio: (bio || '').trim() 
      })
      .eq('id', req.user.id);

    if (error) throw error;
    
    req.user.display_name = display_name.trim();
    req.user.bio = (bio || '').trim();

    res.redirect('/profile');
  } catch (err) {
    console.error('Lỗi cập nhật hồ sơ:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// Chuyển hướng nếu vào link cũ /ai-recommend
router.get('/ai-recommend', (req, res) => {
  res.redirect('/');
});

// Trang Bảng Xếp Hạng Độc Giả toàn diện
router.get('/leaderboard', async (req, res) => {
  try {
    const { data: rankSettings } = await supabase
      .from('rank_settings')
      .select('*')
      .order('count', { ascending: false });

    const { getTypeRankings } = require('../services/storyClassifier');

    // Lấy đủ 5 khoảng thời gian/tiêu chí (ngày/tuần/tháng/đánh giá/theo dõi) cho cả 2 loại
    // truyện tranh và truyện chữ - trước đây trang /leaderboard chỉ lấy mỗi bản 'daily', khiến
    // 2 tab "Truyện Tranh Top"/"Truyện Chữ Top" không có sub-tab lọc như bên trang chủ.
    const [
      { data: readers },
      topAuthors,
      topComicDaily,
      topNovelDaily,
      topComicWeekly,
      topNovelWeekly,
      topComicMonthly,
      topNovelMonthly,
      topComicRated,
      topNovelRated,
      topComicBookmarks,
      topNovelBookmarks,
      pvpLeaderboardData,
      combatLeaderboardData
    ] = await Promise.all([
      supabase.from('leaderboard_by_exp').select('*').order('chapters_read', { ascending: false }).order('exp', { ascending: false }).limit(20),
      fetchTopAuthors(20),
      getTypeRankings('comic', 'daily', 20),
      getTypeRankings('novel', 'daily', 20),
      getTypeRankings('comic', 'weekly', 20),
      getTypeRankings('novel', 'weekly', 20),
      getTypeRankings('comic', 'monthly', 20),
      getTypeRankings('novel', 'monthly', 20),
      getTypeRankings('comic', 'rated', 20),
      getTypeRankings('novel', 'rated', 20),
      getTypeRankings('comic', 'bookmarks', 20),
      getTypeRankings('novel', 'bookmarks', 20),
      supabase.from('arena_ranks').select('user_id, elo_points, tier, wins, losses, users(id, display_name, avatar)').order('elo_points', { ascending: false }).limit(30),
      supabase.from('user_card_teams').select('user_id, combat_power, slot_1, slot_2, slot_3, users(id, display_name, avatar), slot1:slot_1(id, name, avatar_url, rarity), slot2:slot_2(id, name, avatar_url, rarity), slot3:slot_3(id, name, avatar_url, rarity)').order('combat_power', { ascending: false }).limit(30)
    ]);

    const leaderboard = readers || [];
    const pvpLeaderboard = (pvpLeaderboardData && pvpLeaderboardData.data) ? pvpLeaderboardData.data : [];
    const combatLeaderboard = (combatLeaderboardData && combatLeaderboardData.data) ? combatLeaderboardData.data : [];

    res.render('leaderboard', {
      title: 'Bảng xếp hạng',
      user: req.user,
      leaderboard,
      pvpLeaderboard,
      combatLeaderboard,
      topAuthors,
      topComicDaily,
      topNovelDaily,
      topComicWeekly,
      topNovelWeekly,
      topComicMonthly,
      topNovelMonthly,
      topComicRated,
      topNovelRated,
      topComicBookmarks,
      topNovelBookmarks,
      rankSettings
    });
  } catch (err) {
    console.error('Lỗi lấy BXH độc giả:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// ==================== CỬA HÀNG VẬT PHẨM (AVATAR & HUY HIỆU BẰNG EXP) ====================
// Trang danh sách cửa hàng
router.get('/shop', async (req, res) => {
  if (!req.user || !req.user.id) return res.redirect('/auth/login');

  try {
    // 1. Lấy tất cả vật phẩm bán trong shop
    const { data: items, error: itemsErr } = await supabase
      .from('shop_items')
      .select('*')
      .order('price_exp', { ascending: true });

    if (itemsErr) throw itemsErr;

    // 2. Lấy EXP hiện tại của người dùng
    const { data: stats } = await supabase
      .from('user_stats')
      .select('exp')
      .eq('user_id', req.user.id)
      .single();

    const exp = stats ? stats.exp : 0;

    // 3. Lấy danh sách các vật phẩm người dùng đã mua
    const { data: inventory } = await supabase
      .from('user_inventory')
      .select('item_id')
      .eq('user_id', req.user.id);

    const ownedItemIds = (inventory || []).map(inv => inv.item_id);

    // 4. Lấy live info của user (để xem avatar & huy hiệu đang trang bị)
    const { data: userData } = await supabase
      .from('users')
      .select('equipped_badge, equipped_avatar, equipped_frame')
      .eq('id', req.user.id)
      .single();

    res.render('shop', {
      title: 'Cửa hàng EXP - Gắn Huy hiệu & Thay Avatar',
      user: req.user,
      userData: userData || req.user,
      items: items || [],
      exp,
      ownedItemIds,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Lỗi khi tải cửa hàng:', err);
    res.status(500).send('Lỗi hệ thống khi tải cửa hàng.');
  }
});

// Mua vật phẩm từ shop
router.post('/shop/buy/:id', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ success: false, error: 'Vui lòng đăng nhập.' });
  if (req.user.is_banned) return res.status(403).json({ success: false, error: 'Tài khoản đã bị khóa.' });

  const itemId = parseInt(req.params.id);

  try {
    // 1. Kiểm tra vật phẩm tồn tại
    const { data: item, error: itemErr } = await supabase
      .from('shop_items')
      .select('*')
      .eq('id', itemId)
      .single();

    if (itemErr || !item) {
      return res.status(404).json({ success: false, error: 'Vật phẩm không tồn tại.' });
    }

    // 2. Kiểm tra xem người dùng đã sở hữu vật phẩm chưa
    const { data: alreadyOwn } = await supabase
      .from('user_inventory')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('item_id', itemId)
      .maybeSingle();

    if (alreadyOwn) {
      return res.status(400).json({ success: false, error: 'Bạn đã sở hữu vật phẩm này rồi.' });
    }

    // 3. Lấy EXP của người dùng
    const { data: stats } = await supabase
      .from('user_stats')
      .select('exp')
      .eq('user_id', req.user.id)
      .single();

    const userExp = stats ? stats.exp : 0;
    if (userExp < item.price_exp) {
      return res.status(400).json({ success: false, error: `Bạn không đủ EXP. Cần ${item.price_exp} EXP (Hiện có: ${userExp} EXP).` });
    }

    // 4. Trừ EXP và thêm vật phẩm vào túi đồ (inventory)
    const newExp = userExp - item.price_exp;
    
    // Cập nhật EXP
    const { error: updateErr } = await supabase
      .from('user_stats')
      .update({ exp: newExp })
      .eq('user_id', req.user.id);

    if (updateErr) throw updateErr;

    // Thêm vào inventory
    const { error: invErr } = await supabase
      .from('user_inventory')
      .insert([{ user_id: req.user.id, item_id: itemId }]);

    if (invErr) throw invErr;

    res.json({ success: true, message: `Đã mua thành công ${item.name}!`, remainingExp: newExp });
  } catch (err) {
    console.error('Lỗi khi mua vật phẩm:', err);
    res.status(500).json({ success: false, error: 'Lỗi hệ thống khi mua vật phẩm.' });
  }
});

// Trang bị/Tháo vật phẩm
router.post('/shop/equip/:id', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ success: false, error: 'Vui lòng đăng nhập.' });

  const itemId = parseInt(req.params.id);
  const action = req.body.action; // 'equip' hoặc 'unequip'

  try {
    // 1. Lấy vật phẩm
    const { data: item } = await supabase
      .from('shop_items')
      .select('*')
      .eq('id', itemId)
      .single();

    if (!item) {
      return res.status(404).json({ success: false, error: 'Vật phẩm không tồn tại.' });
    }

    // 2. Nếu là trang bị, kiểm tra xem người dùng có sở hữu trong inventory không
    if (action === 'equip' && req.user.role !== 'admin' && req.user.role !== 'sp_admin') {
      const { data: own } = await supabase
        .from('user_inventory')
        .select('id')
        .eq('user_id', req.user.id)
        .eq('item_id', itemId)
        .maybeSingle();

      if (!own) {
        return res.status(400).json({ success: false, error: 'Bạn chưa sở hữu vật phẩm này.' });
      }
    }

    // 3. Thực hiện trang bị/tháo dựa trên type
    const updateData = {};
    if (item.type === 'badge') {
      updateData.equipped_badge = action === 'equip' ? item.value : null;
    } else if (item.type === 'avatar') {
      updateData.equipped_avatar = action === 'equip' ? item.value : null;
      if (action === 'equip') {
        updateData.avatar = item.value;
      } else {
        updateData.avatar = '/css/silly_duck.png';
      }
    } else if (item.type === 'frame') {
      updateData.equipped_frame = action === 'equip' ? item.value : null;
    }

    const { error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', req.user.id);

    if (error) throw error;

    // Cập nhật session
    if (item.type === 'badge') {
      req.user.equipped_badge = action === 'equip' ? item.value : null;
    } else if (item.type === 'avatar') {
      req.user.equipped_avatar = action === 'equip' ? item.value : null;
      req.user.avatar = action === 'equip' ? item.value : '/css/silly_duck.png';
    } else if (item.type === 'frame') {
      req.user.equipped_frame = action === 'equip' ? item.value : null;
    }

    res.json({ success: true, message: action === 'equip' ? 'Đã trang bị vật phẩm!' : 'Đã tháo trang bị!' });
  } catch (err) {
    console.error('Lỗi khi trang bị vật phẩm:', err);
    res.status(500).json({ success: false, error: 'Lỗi hệ thống.' });
  }
});

// XEM THÔNG TIN CÁ NHÂN CỦA USER BẤT KỲ (PUBLIC PROFILE)
router.get('/user/:id', async (req, res) => {
  const userId = req.params.id;
  try {
    // 1. Lấy thông tin user
    const { data: targetUserData, error: userErr } = await supabase
      .from('users')
      .select('id, display_name, avatar, bio, equipped_badge, equipped_avatar, equipped_frame, role, created_at')
      .eq('id', userId)
      .single();

    if (userErr || !targetUserData) {
      return res.status(404).send('Không tìm thấy người dùng.');
    }

    // 2. Lấy thông tin chỉ số stats từ user_stats
    const { data: statsData } = await supabase
      .from('user_stats')
      .select('*')
      .eq('user_id', userId)
      .single();

    const exp = statsData ? statsData.exp : 0;
    const streak = statsData ? statsData.streak_days : 0;

    const level = Math.floor(exp / 100) + 1;
    const nextLevelExp = 100;
    const currentLevelExp = exp % 100;

    // Dùng chapters_read từ user_stats (đồng bộ với /profile, BXH độc giả và logic lên rank) -
    // KHÔNG dùng chapter_reads (bảng chỉ đếm chương duy nhất, không tính đọc lại) để tránh 2 nơi hiển thị lệch nhau.
    const chaptersRead = statsData ? (statsData.chapters_read || 0) : 0;

    // Tính toán Rank (Hạng trên BXH Độc Giả)
    const { data: leaderboardData } = await supabase
      .from('leaderboard_by_exp')
      .select('id')
      .order('chapters_read', { ascending: false })
      .order('exp', { ascending: false });

    let userRank = '-';
    if (leaderboardData) {
      const idx = leaderboardData.findIndex(item => item.id === userId);
      if (idx !== -1) {
        userRank = idx + 1;
      }
    }

    // Tính badge (Cảnh giới / Tu vi) dựa trên chaptersRead
    const { data: rankSettings } = await supabase.from('rank_settings').select('*').order('count', { ascending: false });
    const calculatedBadge = (rankSettings || []).find(r => chaptersRead >= r.count);

    const stats = {
      level,
      exp,
      currentLevelExp,
      nextLevelExp,
      streak,
      chaptersRead: chaptersRead || 0,
      badge: calculatedBadge ? calculatedBadge.label : 'Người mới',
      equipped_badge: targetUserData.equipped_badge,
      rank: userRank
    };

    // 4. Lấy danh sách thành tựu đã mở khóa
    const { data: unlocked } = await supabase
      .from('user_achievements')
      .select('unlocked_at, achievements(*)')
      .eq('user_id', userId);

    const achievements = (unlocked || []).map(ua => ({
      ...ua.achievements,
      unlocked_at: ua.unlocked_at
    }));

    res.render('user-profile', {
      title: `Hồ sơ của ${targetUserData.display_name}`,
      user: req.user || null,
      targetUser: targetUserData,
      stats,
      achievements
    });
  } catch (err) {
    console.error('Lỗi khi xem hồ sơ độc giả:', err);
    res.status(500).send('Lỗi máy chủ.');
  }
});

// TRANG BỊ DANH HIỆU TỪ THÀNH TỰU ĐÃ MỞ KHÓA
router.post('/profile/equip-achievement', async (req, res) => {
  if (!req.user || !req.user.id) return res.status(401).json({ success: false, error: 'Chưa đăng nhập.' });
  const { name, action } = req.body;
  
  try {
    let equippedBadge = null;
    if (action === 'equip') {
      // Kiểm tra xem user thực sự đã mở khóa thành tựu này chưa
      const { data: unlocked } = await supabase
        .from('user_achievements')
        .select('*, achievements(*)')
        .eq('user_id', req.user.id);
        
      const hasAch = (unlocked || []).some(ua => ua.achievements && ua.achievements.name === name);
      if (!hasAch) {
        return res.status(400).json({ success: false, error: 'Bạn chưa mở khóa thành tựu này.' });
      }
      
      const achRecord = (unlocked || []).find(ua => ua.achievements && ua.achievements.name === name).achievements;
      const emoji = achRecord.badge_class === 'legend' ? '👑' : achRecord.badge_class === 'gold' ? '🥇' : achRecord.badge_class === 'silver' ? '🥈' : '🥉';
      equippedBadge = `${emoji} ${name}`;
    }
    
    // Cập nhật users table
    const { error } = await supabase
      .from('users')
      .update({ equipped_badge: equippedBadge })
      .eq('id', req.user.id);
      
    if (error) throw error;
    
    // Cập nhật session
    req.user.equipped_badge = equippedBadge;
    
    res.json({ success: true, message: action === 'equip' ? 'Đã gắn danh hiệu thành tựu!' : 'Đã tháo danh hiệu!' });
  } catch (err) {
    console.error('Lỗi trang bị thành tựu:', err);
    res.status(500).json({ success: false, error: 'Lỗi hệ thống.' });
  }
});

// PROXY ẢNH ĐỂ TRÁNH LỖI REFERER CHẶN HOTLINK (403 FORBIDDEN)
router.get('/api/proxy-image', async (req, res) => {
  const imageUrl = req.query.url;
  const referer = req.query.referer || 'https://truyenqq.com.vn/';

  if (!imageUrl) {
    return res.status(400).send('Thiếu tham số url.');
  }

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 8000);

    const imgRes = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': referer
      }
    });

    clearTimeout(id);

    if (!imgRes.ok) {
      return res.status(imgRes.status).send(`Failed to fetch image. Status: ${imgRes.status}`);
    }

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache trong 24 giờ

    const buffer = await imgRes.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[PROXY-IMAGE] Error proxying image:', err.message);
    res.status(500).send('Lỗi hệ thống khi tải ảnh.');
  }
});

// TỪ ĐIỂN PHIÊN ÂM TIẾNG ANH SANG TIẾNG VIỆT CHO TRUYỆN CHỮ
// Giúp Chị Google đọc cực kỳ chuẩn, không bị nuốt chữ hay đánh vần đúp-lờ-vê (W)
const NOVEL_PHONETIC_DICT = [
  // Nhân vật & Thuật ngữ truyện đặc thù (như truyện Thao Túng tác giả Niken)
  [/\bCharles\s+Darwin\b/gi, 'Sác-lơ Đác-uyn'],
  [/\bDarwin\b/gi, 'Đác-uyn'],
  [/\bCharles\b/gi, 'Sác-lơ'],
  [/\bWin\b/gi, 'Uyn'],
  [/\bWinner\b/gi, 'Uyn-nơ'],
  [/\bDrone\b/gi, 'Đờ-rôn'],
  [/\bBlackjack\b/gi, 'Blách-giắc'],
  [/\bCasino\b/gi, 'Ca-si-nô'],
  [/\bDealer\b/gi, 'Đi-lơ'],
  [/\bPoker\b/gi, 'Pô-kơ'],
  [/\bRoulette\b/gi, 'Ru-lét'],
  [/\bVIP\b/gi, 'Víp'],
  [/\bChips?\b/gi, 'Chíp'],
  [/\bJackpot\b/gi, 'Giắc-pót'],

  // Thuật ngữ Hệ Thống / Game / Dị Năng / Đô Thị
  [/\bSystem\b/gi, 'Xít-tầm'],
  [/\bStatus\b/gi, 'Xì-ta-tớt'],
  [/\bSkill\b/gi, 'X-kin'],
  [/\bLevel\b/gi, 'Le-vồ'],
  [/\bItem\b/gi, 'Ai-tầm'],
  [/\bQuest\b/gi, 'Quét'],
  [/\bBoss\b/gi, 'Bót'],
  [/\bGame\b/gi, 'Gêm'],
  [/\bPlayer\b/gi, 'Pờ-lây-ơ'],
  [/\bAdmin\b/gi, 'Át-min'],
  [/\bHack\b/gi, 'Hách'],
  [/\bHacker\b/gi, 'Hắc-cơ'],
  [/\bBug\b/gi, 'Bắc'],
  [/\bBuff\b/gi, 'Bắp'],
  [/\bNerf\b/gi, 'Nớp'],
  [/\bTop\b/gi, 'Tóp'],
  [/\bPro\b/gi, 'Pờ-rô'],
  [/\bNoob\b/gi, 'Núp'],
  [/\bSolo\b/gi, 'Sô-lô'],
  [/\bTeam\b/gi, 'Tim'],
  [/\bGuild\b/gi, 'Giu-lờ'],
  [/\bDamage\b|\bDame\b/gi, 'Đam'],
  [/\bTanker\b|\bTank\b/gi, 'Teng-kơ'],
  [/\bSupport\b/gi, 'Súp-pót'],
  [/\bCombo\b/gi, 'Com-bô'],
  [/\bRank\b/gi, 'Ranh'],
  [/\bPass\b/gi, 'Pát'],
  [/\bPassword\b/gi, 'Pát-uốt'],

  // Đời sống, Công nghệ & Từ mượn phổ biến
  [/\bBar\b/gi, 'Ba'],
  [/\bClub\b/gi, 'Cờ-lắp'],
  [/\bShow\b/gi, 'Sô'],
  [/\bView\b/gi, 'Viu'],
  [/\bReview\b/gi, 'Rê-viu'],
  [/\bFollow\b/gi, 'Phô-lâu'],
  [/\bOK\b|\bOk\b|\bok\b/g, 'Ô kê'],
  [/\bAI\b/g, 'A-I'],
  [/\bIQ\b/g, 'I-Q'],
  [/\bEQ\b/g, 'E-Q'],
  [/\bNPC\b/g, 'N-P-C'],
  [/\bPK\b/g, 'P-K'],
  [/\bHP\b/g, 'H-P'],
  [/\bMP\b/g, 'M-P'],
  [/\bEXP\b/g, 'E-X-P'],
  [/\bFPS\b/g, 'F-P-S'],
  [/\bPC\b/g, 'P-C'],
  [/\bGoogle\b/gi, 'Gúc-gồ'],
  [/\bFacebook\b/gi, 'Phây-xơ-búc'],
  [/\bInternet\b/gi, 'In-tơ-nét'],
  [/\bOnline\b/gi, 'On-lai'],
  [/\bOffline\b/gi, 'Óp-lai'],
  [/\bRobot\b/gi, 'Rô-bốt'],
  [/\bSecurity\b/gi, 'Bảo vệ'],
  [/\bClick\b/gi, 'Clích'],
  [/\bCode\b/gi, 'Cốt'],
  [/\bData\b/gi, 'Đa-ta'],
  [/\bLink\b/gi, 'Linh'],
  [/\bFile\b/gi, 'Phai'],
  [/\bApp\b/gi, 'Áp'],
  [/\bShip\b/gi, 'Síp'],
  [/\bShop\b/gi, 'Sóp'],
  [/\bSale\b/gi, 'Seo'],
  [/\bOrder\b/gi, 'O-đơ'],
  [/\bHot\b/gi, 'Hót'],
  [/\bFan\b/gi, 'Phan'],
  [/\bIdol\b/gi, 'Ai-đần'],
  [/\bLive\b|\bLivestream\b/gi, 'Lai-x-trim'],
  [/\bVideo\b/gi, 'Vi-đê-ô'],
  [/\bCheck\b/gi, 'Chếch'],
  [/\bCard\b/gi, 'Cạc'],
  [/\bSmartphone\b/gi, 'Điện thoại thông minh'],
  [/\bLaptop\b/gi, 'Láp-tóp']
];

function cleanTtsSpeechText(text) {
  if (!text) return '';
  let str = text;

  // 1. Loại bỏ các emoji & ký hiệu trang trí (hoa lá, nốt nhạc, ngôi sao, icon...)
  str = str.replace(/[\u2600-\u26FF\u2700-\u27BF\uFE00-\uFE0F★☆♥❤♦♣♠►◄♪♫✿❀©®™]/gu, ' ');

  // 2. Xóa bỏ dấu thăng '#' và dấu sao '*'
  str = str.replace(/[#*]+/g, ' ');

  // 3. Chuỗi gạch ngang, gạch dưới, dấu bằng (dividers: ---, ===, ___)
  str = str.replace(/[-=_]{2,}/g, ', ');

  // 4. Dấu ngã kéo dài (đi mà~~~ -> đi mà)
  str = str.replace(/~+/g, ' ');

  // 5. Dấu chấm lửng (..., …) -> chuyển thành dấu phẩy để tạo quãng nghỉ ngắt giọng tự nhiên, không đọc 'chấm chấm chấm'
  str = str.replace(/[.…]{2,}/g, ', ');
  str = str.replace(/…/g, ', ');

  // 6. Nhiều dấu hỏi, than liên tiếp (???, !!!, ?!) -> gộp thành 1 dấu
  str = str.replace(/\?+/g, '?');
  str = str.replace(/!+/g, '!');
  str = str.replace(/\?!+|\?!+/g, '?');

  // 7. Dấu ngoặc các loại: bỏ dấu ngoặc giữ nguyên chữ bên trong để không đọc 'mở ngoặc', 'đóng ngoặc'
  str = str.replace(/[()\[\]{}<>]/g, ' ');

  // 8. Các ký tự đặc biệt khác: |, \, /, ^, @, `, ~
  str = str.replace(/[|\\\/^@`~]/g, ' ');

  // 9. Dấu gạch nối đơn lẻ giữa các từ hoặc đứng một mình
  str = str.replace(/\s+-\s+/g, ', ');

  // 10. Thu gọn khoảng trắng và dấu phẩy liên tiếp
  str = str.replace(/\s*,\s*,+/g, ', ');
  str = str.replace(/\s+/g, ' ').trim();

  // 11. Xóa dấu phẩy, gạch thừa ở đầu hoặc cuối câu
  str = str.replace(/^[\s,;:\-]+|[\s,;:\-]+$/g, '').trim();

  // 12. Nếu chỉ còn toàn dấu câu đơn độc (, . - : ;) thì xóa sạch
  if (/^[,.\-;:!?\s]+$/.test(str)) return '';

  return str;
}

function normalizeTtsText(text) {
  let result = cleanTtsSpeechText(text);
  for (const [pattern, replacement] of NOVEL_PHONETIC_DICT) {
    result = result.replace(pattern, replacement);
  }
  // Khử chữ 'w' và 'W' còn sót lại để tránh Google đọc thành "đúp-lờ-vê" / "vê-kép"
  result = result.replace(/\bw([aeiou])/gi, 'u$1');
  result = result.replace(/([aeiou])w\b/gi, '$1u');
  result = result.replace(/w/gi, 'u');
  return result;
}

// Kiểm tra đoạn văn có phải thuần tiếng Anh không (để chuyển hẳn sang giọng đọc bản ngữ en)
function isPredominantlyEnglish(text) {
  const vietDiacritics = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
  if (vietDiacritics.test(text)) return false;

  const words = text.toLowerCase().match(/\b[a-z]{2,}\b/g) || [];
  if (words.length < 3) return false;
  const enStops = new Set(['the', 'and', 'is', 'in', 'it', 'you', 'that', 'he', 'was', 'for', 'on', 'are', 'as', 'with', 'his', 'they', 'at', 'be', 'this', 'have', 'from', 'or', 'one', 'had', 'by', 'word', 'but', 'not', 'what', 'all', 'were', 'we', 'when', 'your', 'can', 'said', 'there', 'use', 'an', 'each', 'which', 'she', 'do', 'how', 'their', 'if', 'will', 'up', 'other', 'about', 'out', 'many', 'then', 'them', 'these', 'so', 'some', 'her', 'would', 'make', 'like', 'him', 'into', 'time', 'has', 'look', 'two', 'more', 'write', 'go', 'see', 'number', 'no', 'way', 'could', 'people', 'my', 'than', 'first', 'water', 'been', 'call', 'who', 'oil', 'its', 'now', 'find']);
  const enCount = words.filter(w => enStops.has(w)).length;
  return (enCount / words.length) >= 0.35 || enCount >= 3;
}

// API STREAM AUDIO GIỌNG NỮ GOOGLE (MIỄN PHÍ, HOẠT ĐỘNG 100% TRÊN CHROME VÀ MỌI TRÌNH DUYỆT)
function splitTtsChunks(text, maxLen = 175) {
  const sentences = text.split(/(?<=[.!?,\n;:])\s+/);
  const chunks = [];
  let cur = '';

  for (const s of sentences) {
    if ((cur + ' ' + s).trim().length <= maxLen) {
      cur = (cur + ' ' + s).trim();
    } else {
      if (cur) chunks.push(cur);
      if (s.length <= maxLen) {
        cur = s;
      } else {
        const words = s.split(/\s+/);
        cur = '';
        for (const w of words) {
          if ((cur + ' ' + w).trim().length <= maxLen) {
            cur = (cur + ' ' + w).trim();
          } else {
            if (cur) chunks.push(cur);
            cur = w;
          }
        }
      }
    }
  }
  if (cur && cur.trim()) chunks.push(cur.trim());
  return chunks;
}

router.get('/api/tts', async (req, res) => {
  const rawText = (req.query.text || '').trim();
  if (!rawText) return res.status(400).send('Missing text');

  try {
    const isEnglish = isPredominantlyEnglish(rawText);
    const targetLang = isEnglish ? 'en' : 'vi';
    const processedText = isEnglish ? rawText : normalizeTtsText(rawText);

    const chunks = splitTtsChunks(processedText, 175);
    const audioBuffers = await Promise.all(
      chunks.map(async (c) => {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${targetLang}&client=tw-ob&q=${encodeURIComponent(c)}`;
        const r = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        if (!r.ok) return Buffer.alloc(0);
        return Buffer.from(await r.arrayBuffer());
      })
    );

    const validBuffers = audioBuffers.filter(b => b.length > 0);
    if (validBuffers.length === 0) {
      return res.status(500).send('Failed to generate audio');
    }

    const combined = Buffer.concat(validBuffers);
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': combined.length,
      'Cache-Control': 'public, max-age=86400'
    });
    res.send(combined);
  } catch (err) {
    console.error('[API-TTS] Error generating TTS:', err);
    res.status(500).send('TTS error');
  }
});

module.exports = router;

