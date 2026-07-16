const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Sử dụng Memory Storage để chạy không đĩa (tương thích Vercel Serverless)
const upload = multer({ storage: multer.memoryStorage() });

// Middleware nạp thông tin người dùng và số thông báo chưa đọc vào res.locals cho mọi template EJS
router.use(async (req, res, next) => {
  res.locals.user = req.user;
  res.locals.unreadNotificationsCount = 0;
  if (req.user && req.user.id) {
    try {
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', req.user.id)
        .eq('is_read', false);
      res.locals.unreadNotificationsCount = count || 0;
    } catch (e) {
      console.error('Lỗi lấy số thông báo chưa đọc:', e);
    }
  }
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

  return { earnedExp: true, rankUp };
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
    const { data: stories, error: storyErr } = await supabase
      .from('stories')
      .select('id, title, author');
        
    if (storyErr) {
      console.error('Lỗi lấy danh sách truyện cho BXH tác giả:', storyErr);
      return [];
    }
    
    const { data: chapters, error: chaptersErr } = await supabase
      .from('chapters')
      .select('story_id, views');
        
    if (chaptersErr) {
      console.error('Lỗi lấy lượt xem chương cho BXH tác giả:', chaptersErr);
      return [];
    }
    
    const storyViews = {};
    chapters.forEach(c => {
      storyViews[c.story_id] = (storyViews[c.story_id] || 0) + (c.views || 0);
    });
    
    const authorMap = {};
    stories.forEach(s => {
      const author = s.author ? s.author.trim() : '';
      if (!author || 
          author === 'Ẩn danh' || 
          author.toLowerCase() === 'an danh' || 
          author === 'Đang cập nhật' || 
          author.toLowerCase() === 'dang cap nhat') {
        return;
      }
      
      const viewsCount = storyViews[s.id] || 0;
      
      if (!authorMap[author]) {
        authorMap[author] = {
          author: author,
          totalViews: 0,
          stories: []
        };
      }
      
      authorMap[author].totalViews += viewsCount;
      authorMap[author].stories.push({
        title: s.title,
        views: viewsCount
      });
    });
    
    const leaderboard = Object.values(authorMap).map(a => {
      let hottestStory = null;
      if (a.stories.length > 0) {
        a.stories.sort((x, y) => y.views - x.views);
        hottestStory = a.stories[0];
      }
      return {
        author: a.author,
        totalViews: a.totalViews,
        story_count: a.stories.length,
        hottestStoryName: hottestStory ? hottestStory.title : 'N/A',
        hottestStoryViews: hottestStory ? hottestStory.views : 0
      };
    }).sort((x, y) => y.totalViews - x.totalViews);
    
    return leaderboard.slice(0, limitCount);
  } catch (e) {
    console.error('Lỗi trong fetchTopAuthors:', e);
    return [];
  }
}

// TRANG CHỦ & BẢNG XẾP HẠNG
router.get('/', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  try {
    const status = req.query.status || ''; // '', 'ongoing', 'completed'
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const fromRange = (page - 1) * limit;
    const toRange = fromRange + limit - 1;

    // 1. Lấy danh sách truyện phân trang, sắp xếp theo truyện có chương MỚI CẬP NHẬT gần nhất lên đầu
    let query = supabase.from('stories_with_last_update').select('*', { count: 'exact' });
    if (status === 'ongoing' || status === 'completed') {
      query = query.eq('status', status);
    }
    
    // Gộp tất cả các truy vấn độc lập vào chung một Promise.all để lấy dữ liệu song song (tối đa tốc độ)
    const [
      { data: stories, count: totalCount, error: storiesError },
      { data: genres, error: genresError },
      { data: topDaily },
      { data: topWeekly },
      { data: topMonthly },
      { data: topYearly },
      { data: topRatedData }
    ] = await Promise.all([
      query.order('last_update_at', { ascending: false }).range(fromRange, toRange),
      supabase.from('genres').select('*'),
      supabase.from('views_ranking_daily').select('*').order('view_count', { ascending: false }).limit(5),
      supabase.from('views_ranking_weekly').select('*').order('view_count', { ascending: false }).limit(5),
      supabase.from('views_ranking_monthly').select('*').order('view_count', { ascending: false }).limit(5),
      supabase.from('views_ranking_yearly').select('*').order('view_count', { ascending: false }).limit(5),
      supabase.from('views_ranking_rated').select('*').limit(5)
    ]);

    if (storiesError) throw storiesError;
    if (genresError) throw genresError;

    // 3a. Lấy bảng xếp hạng đánh giá
    const topRated = topRatedData || [];

    // Tối ưu hoá: Lấy song song các dữ liệu phụ (không quan trọng) bằng Promise.allSettled
    const [
      rankSettingsRes,
      readersRes,
      bookmarksRes,
      bannersRes,
      historyRes
    ] = await Promise.allSettled([
      supabase.from('rank_settings').select('*').order('count', { ascending: false }),
      supabase.from('leaderboard_by_exp').select('*').order('chapters_read', { ascending: false }).order('exp', { ascending: false }).limit(5),
      supabase.from('stories_bookmarks_count').select('*').order('bookmark_count', { ascending: false }).limit(5),
      supabase.from('banners').select('*').order('created_at', { ascending: false }),
      req.user && req.user.id ? supabase.from('reading_history').select('chapter_number, story_id, stories(title)').eq('user_id', req.user.id).order('updated_at', { ascending: false }).limit(1) : Promise.resolve({ data: null })
    ]);

    // 3b. Bảng xếp hạng độc giả
    let topReaders = [];
    if (readersRes.status === 'fulfilled' && readersRes.value.data) {
      const rankSettings = (rankSettingsRes.status === 'fulfilled' && rankSettingsRes.value.data) ? rankSettingsRes.value.data : [];
      topReaders = readersRes.value.data.map(r => ({ ...r, badge: getBadgeForCount(r.chapters_read || 0, rankSettings) }));
    }

    // 3c. Bảng xếp hạng Top Bookmark
    let topBookmarks = (bookmarksRes.status === 'fulfilled' && bookmarksRes.value.data) ? bookmarksRes.value.data : [];

    // 3d. Danh sách banner
    let banners = (bannersRes.status === 'fulfilled' && bannersRes.value.data) ? bannersRes.value.data : [];

    // 3e. Lịch sử đọc gần nhất
    let lastRead = null;
    if (historyRes.status === 'fulfilled' && historyRes.value.data && historyRes.value.data.length > 0) {
      lastRead = {
        story_id: historyRes.value.data[0].story_id,
        story_title: historyRes.value.data[0].stories ? historyRes.value.data[0].stories.title : '',
        chapter_number: historyRes.value.data[0].chapter_number
      };
    }

    // 3f. Lấy các bình luận mới nhất
    let recentComments = [];
    try {
      const { data: commentsData, error: commentsErr } = await supabase
        .from('comments')
        .select('id, content, created_at, user_id, story_id, chapter_number, users!comments_user_id_fkey(display_name, avatar, equipped_frame, equipped_badge), stories(title)')
        .order('created_at', { ascending: false })
        .limit(5);
      if (!commentsErr && commentsData) {
        recentComments = commentsData;
      }
    } catch (e) {
      console.error('Lỗi lấy bình luận mới nhất:', e);
    }

    // 3g. Lấy top tác giả
    const topAuthors = await fetchTopAuthors(5);

    // 3h. Lấy các sự kiện "Đột Phá Cảnh Giới" xảy ra trong hôm nay, để hiện banner công khai trên trang chủ
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
      // Chỉ giữ lại các sự kiện đột phá THẬT: bậc sau phải khác bậc trước, VÀ bậc sau không được
      // là bậc THẤP NHẤT hiện có (lấy động từ rank_settings, không hard-code tên cụ thể như
      // "Xuất sớm" - vì admin có thể đổi tên/thứ tự bậc bất kỳ lúc nào trong trang quản trị).
      // Phòng trường hợp dữ liệu cũ/backfill lỡ ghi nhầm record không có đột phá thực sự.
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

    // Gộp bảng "Đột Phá Cảnh Giới Hôm Nay" làm 1 slide trong CHUNG carousel banner admin -
    // dùng chung cơ chế trượt tự động/kéo tay đã có sẵn, thay vì hiển thị tách riêng như trước.
    // Chỉ chèn slide này khi thực sự có ít nhất 1 sự kiện đột phá trong ngày hôm nay.
    if (rankUpEventsToday.length > 0) {
      banners = [
        { id: 'rankup-board-slide', type: 'rankup_board', created_at: new Date().toISOString() },
        ...banners
      ];
    }

    const totalPages = Math.ceil((totalCount || 0) / limit);

    res.render('home', {
      title: 'Trang chủ - Web Đọc Truyện',
      user: req.user,
      stories: stories || [],
      genres,
      topDaily: topDaily || [],
      topWeekly: topWeekly || [],
      topMonthly: topMonthly || [],
      topYearly: topYearly || [],
      topRated,
      topReaders,
      topBookmarks,
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
    console.error('Lỗi trang chủ:', err);
    res.status(500).send('Đã xảy ra lỗi hệ thống.');
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
    let q = supabase.from('stories').select('*, chapters(count)');

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
          genres,
          topDaily: [], topWeekly: [], topMonthly: [], topYearly: [], topBookmarks: [],
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

    // 3. Tính số chương thực tế + lọc theo số chương tối thiểu (xử lý ở tầng ứng dụng)
    let stories = (rawStories || []).map(s => ({
      ...s,
      chapter_count: (s.chapters && s.chapters[0] && s.chapters[0].count) || 0
    }));

    if (minChapters > 0) {
      stories = stories.filter(s => s.chapter_count >= minChapters);
    }

    if (sort === 'most_chapters') {
      stories = stories.sort((a, b) => b.chapter_count - a.chapter_count);
    }

    if (viewSort === 'daily' || viewSort === 'monthly' || viewSort === 'all') {
      const viewCounts = {};
      if (viewSort === 'all') {
        const { data: chapters } = await supabase.from('chapters').select('story_id, views');
        if (chapters) {
          chapters.forEach(c => {
            viewCounts[c.story_id] = (viewCounts[c.story_id] || 0) + (c.views || 0);
          });
        }
      } else {
        let viewQuery = supabase.from('story_views').select('story_id');
        if (viewSort === 'daily') {
          const dailyStart = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          viewQuery = viewQuery.gte('created_at', dailyStart);
        } else if (viewSort === 'monthly') {
          const monthlyStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          viewQuery = viewQuery.gte('created_at', monthlyStart);
        }
        const { data: viewsData } = await viewQuery;
        if (viewsData) {
          viewsData.forEach(v => {
            viewCounts[v.story_id] = (viewCounts[v.story_id] || 0) + 1;
          });
        }
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
      genres,
      topDaily: [], topWeekly: [], topMonthly: [], topYearly: [], topBookmarks: [], // ẩn bảng xếp hạng khi tìm kiếm
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

    const storyIds = storyIdsData.map(item => item.story_id);
    let stories = [];

    // 3. Lấy chi tiết các truyện từ ID
    if (storyIds.length > 0) {
      const { data: storiesData, error: storiesErr } = await supabase
        .from('stories')
        .select('*')
        .in('id', storyIds)
        .order('created_at', { ascending: false });
      
      if (storiesErr) throw storiesErr;
      stories = storiesData;
    }

    res.render('home', {
      title: `Thể loại: ${activeGenre.name}`,
      user: req.user,
      stories,
      genres,
      topDaily: [], topWeekly: [], topMonthly: [], topYearly: [], // ẩn bảng xếp hạng khi lọc
      activeGenre,
      searchQuery: null,
      filters: { genre: slug, status: '', minChapters: '', year: '', sort: 'newest', view_sort: '' }
    });
  } catch (err) {
    console.error('Lỗi lọc thể loại:', err);
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
      comments
    });
  } catch (err) {
    console.error('Lỗi chi tiết truyện:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// TRANG ĐỌC CHƯƠNG TRUYỆN
router.get('/story/:story_id/chapter/:chapter_number', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const storyId = parseInt(req.params.story_id);
  const chapterNumber = parseInt(req.params.chapter_number);
  
  try {
    // 1. Lấy thông tin truyện
    const { data: story } = await supabase.from('stories').select('id, title').eq('id', storyId).single();
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
      supabase.from('reading_history').upsert(
        { user_id: req.user.id, story_id: storyId, chapter_number: chapterNumber, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,story_id' }
      ).then(({ error }) => {
        if (error) console.error('Lỗi khi lưu lịch sử đọc:', error);
      });

      // 3c. Lưu thông tin bắt đầu đọc vào session để tính thời gian đọc (tránh hack/buff EXP)
      req.session.reading = {
        storyId: storyId,
        chapterNumber: chapterNumber,
        startTime: Date.now()
      };
    }

    // 4. Kiểm tra chương trước và chương sau để điều hướng
    const { data: prevChapter } = await supabase
      .from('chapters')
      .select('chapter_number')
      .eq('story_id', storyId)
      .eq('chapter_number', chapterNumber - 1)
      .single();

    const { data: nextChapter } = await supabase
      .from('chapters')
      .select('chapter_number')
      .eq('story_id', storyId)
      .eq('chapter_number', chapterNumber + 1)
      .single();

    // 5. Lấy danh sách toàn bộ chương để hiển thị trong mục lục nhanh
    const { data: chaptersList } = await supabase
      .from('chapters')
      .select('id, chapter_number, title')
      .eq('story_id', storyId)
      .order('chapter_number', { ascending: true });

    // 6. Lấy danh sách bình luận của chương truyện này
    let comments = [];
    try {
      const { data: commentsData } = await supabase
        .from('comments')
        .select('*, users!comments_user_id_fkey(display_name, avatar, equipped_badge, equipped_frame, user_stats(chapters_read))')
        .eq('story_id', storyId)
        .eq('chapter_number', chapterNumber)
        .order('created_at', { ascending: true });
      
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

    res.render('read', {
      title: `Đọc truyện ${story.title} - Chương ${chapter.chapter_number}: ${chapter.title}`,
      user: req.user,
      story,
      chapter,
      hasPrev: !!prevChapter,
      hasNext: !!nextChapter,
      chaptersList: chaptersList || [],
      comments
    });
  } catch (err) {
    console.error('Lỗi đọc chương:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// Route xác nhận đọc chương truyện đủ thời gian (2.5 phút) để nhận EXP
router.post('/chapter/read-confirm', async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, error: 'Vui lòng đăng nhập.' });
  }
  
  if (req.user.is_banned) {
    return res.status(403).json({ success: false, error: 'Tài khoản của bạn đã bị khóa.' });
  }

  const { story_id, chapter_number } = req.body;
  const storyId = parseInt(story_id);
  const chapterNumber = parseInt(chapter_number);

  if (!storyId || !chapterNumber) {
    return res.status(400).json({ success: false, error: 'Tham số không hợp lệ.' });
  }

  const reading = req.session.reading;
  if (!reading || reading.storyId !== storyId || reading.chapterNumber !== chapterNumber) {
    console.error('[Read-Confirm Mismatch]:', {
      sessionReading: reading,
      requestedStoryId: storyId,
      requestedChapterNumber: chapterNumber
    });
    return res.status(400).json({ success: false, error: 'Yêu cầu không hợp lệ hoặc lượt đọc chưa được bắt đầu.' });
  }

  const elapsedMs = Date.now() - reading.startTime;
  const requiredMs = 90 * 1000; // 1.5 phút (90 giây)

  if (elapsedMs < requiredMs) {
    const remainingSeconds = Math.ceil((requiredMs - elapsedMs) / 1000);
    return res.status(400).json({ 
      success: false, 
      error: `Vui lòng đọc tiếp. Cần đọc thêm ${remainingSeconds} giây nữa để ghi nhận EXP!` 
    });
  }

  // Cộng EXP
  let earnedExp = false;
  let rankUp = null;
  try {
    const result = await awardReadingExp(req.user.id, storyId, chapterNumber);
    earnedExp = result ? result.earnedExp : false;
    rankUp = result ? result.rankUp : null;
  } catch (err) {
    console.error('Lỗi cộng EXP trong xác nhận:', err);
  }

  // Xóa thông tin đọc trong session để tránh gửi lại nhiều lần
  delete req.session.reading;

  res.json({
    success: true,
    message: earnedExp ? 'Đã ghi nhận đọc chương thành công! +5 EXP' : 'Đã ghi nhận đọc chương. (Chương này đã tính EXP trước đó)',
    rankUp
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
    const { error } = await supabase
      .from('ratings')
      .upsert(
        { user_id: req.user.id, story_id: storyId, score },
        { onConflict: 'user_id,story_id' }
      );
    if (error) throw error;

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

    const { error } = await supabase
      .from('bookmarks')
      .upsert(
        { user_id: req.user.id, story_id: storyId, status: newStatus },
        { onConflict: 'user_id,story_id' }
      );
    if (error) throw error;

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

// Thuật toán AI gợi ý truyện dựa trên thể loại đọc nhiều nhất
async function getAiRecommendations(userId) {
  try {
    const { data: reads } = await supabase.from('chapter_reads').select('story_id');
    const readStoryIds = (reads || []).map(r => r.story_id);
    
    if (readStoryIds.length === 0) {
      const { data: popular } = await supabase.from('stories_bookmarks_count').select('*').order('bookmark_count', { ascending: false }).limit(6);
      return popular || [];
    }

    const { data: readGenres } = await supabase.from('story_genres').select('genre_id').in('story_id', readStoryIds);
    const genreCounts = {};
    (readGenres || []).forEach(g => {
      genreCounts[g.genre_id] = (genreCounts[g.genre_id] || 0) + 1;
    });

    const topGenres = Object.keys(genreCounts).map(Number).sort((a, b) => genreCounts[b] - genreCounts[a]).slice(0, 3);
    if (topGenres.length === 0) {
      const { data: popular } = await supabase.from('stories_bookmarks_count').select('*').order('bookmark_count', { ascending: false }).limit(6);
      return popular || [];
    }

    const { data: bookmarks } = await supabase.from('bookmarks').select('story_id').eq('user_id', userId);
    const bookmarkedIds = (bookmarks || []).map(b => b.story_id);
    const excludeIds = [...new Set([...readStoryIds, ...bookmarkedIds])];

    const { data: candidateStoryGenres } = await supabase
      .from('story_genres')
      .select('story_id, genre_id')
      .in('genre_id', topGenres);

    const scores = {};
    (candidateStoryGenres || []).forEach(sg => {
      if (excludeIds.includes(sg.story_id)) return;
      scores[sg.story_id] = (scores[sg.story_id] || 0) + 1;
    });

    const sortedIds = Object.keys(scores).map(Number).sort((a, b) => scores[b] - scores[a]).slice(0, 6);
    if (sortedIds.length === 0) {
      const { data: popular } = await supabase.from('stories_bookmarks_count').select('*').order('bookmark_count', { ascending: false }).limit(6);
      return popular || [];
    }

    const { data: recs } = await supabase.from('stories').select('*, chapters(count)').in('id', sortedIds);
    return (recs || []).map(r => ({
      ...r,
      chapter_count: (r.chapters && r.chapters[0] && r.chapters[0].count) || 0,
      match_score: Math.round((scores[r.id] / topGenres.length) * 100)
    }));
  } catch (e) {
    console.error('Lỗi thuật toán AI gợi ý:', e);
    return [];
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
      chapter_number: chapter_number ? parseInt(chapter_number) : null,
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
    const { count: higherExpCount } = await supabase
      .from('user_stats')
      .select('user_id', { count: 'exact', head: true })
      .gt('exp', exp);
    const userRank = higherExpCount !== null ? higherExpCount + 1 : '-';

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

// AI gợi ý truyện cho độc giả
router.get('/ai-recommend', async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.redirect('/auth/login');
  }
  try {
    const recs = await getAiRecommendations(req.user.id);
    res.render('ai-recommend', {
      title: 'AI Gợi Ý Truyện Dành Cho Bạn',
      user: req.user,
      stories: recs
    });
  } catch (err) {
    console.error('Lỗi gợi ý AI:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// Trang Bảng Xếp Hạng Độc Giả toàn diện
router.get('/leaderboard', async (req, res) => {
  try {
    const { data: rankSettings } = await supabase
      .from('rank_settings')
      .select('*')
      .order('count', { ascending: false });

    const { data: readers } = await supabase.from('leaderboard_by_exp').select('*').order('chapters_read', { ascending: false }).order('exp', { ascending: false }).limit(20);
    const leaderboard = readers || [];
    
    const topAuthors = await fetchTopAuthors(20);

    res.render('leaderboard', {
      title: 'Bảng xếp hạng',
      user: req.user,
      leaderboard,
      topAuthors,
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
    const { count: higherExpCount } = await supabase
      .from('user_stats')
      .select('user_id', { count: 'exact', head: true })
      .gt('exp', exp);
    const userRank = higherExpCount !== null ? higherExpCount + 1 : '-';

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

module.exports = router;
