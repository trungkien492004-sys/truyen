const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Sử dụng Memory Storage để chạy không đĩa (tương thích Vercel Serverless)
const upload = multer({ storage: multer.memoryStorage() });

const EXP_PER_CHAPTER = 5;

// Hàm gamification: ghi nhận lượt đọc chương (tính EXP 1 lần/chương) + cập nhật streak đọc liên tục
async function awardReadingExp(userId, storyId, chapterNumber) {
  // 1. Thử ghi nhận vào chapter_reads - nếu đã tồn tại (đọc lại chương cũ) thì bỏ qua, không cộng EXP nữa
  const { error: insertErr } = await supabase
    .from('chapter_reads')
    .insert([{ user_id: userId, story_id: storyId, chapter_number: chapterNumber }]);

  // Mã lỗi 23505 = vi phạm UNIQUE constraint -> nghĩa là chương này đã được tính EXP trước đó rồi
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

  let exp = stats ? stats.exp : 0;
  let streak = stats ? stats.streak_days : 0;
  const lastDate = stats ? stats.last_read_date : null;

  // Cộng EXP chỉ khi đây là lượt đọc MỚI (chương chưa từng tính EXP trước đó)
  if (!alreadyCounted) {
    exp += EXP_PER_CHAPTER;
  }

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
    { user_id: userId, exp, streak_days: streak, last_read_date: todayStr, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  );
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

// TRANG CHỦ & BẢNG XẾP HẠNG
router.get('/', async (req, res) => {
  try {
    // 1. Lấy tất cả danh sách truyện, sắp xếp theo truyện có chương MỚI CẬP NHẬT gần nhất lên đầu
    const { data: stories, error: storiesError } = await supabase
      .from('stories_with_last_update')
      .select('*')
      .order('last_update_at', { ascending: false });

    if (storiesError) throw storiesError;

    // 2. Lấy danh sách thể loại để hiển thị menu
    const { data: genres, error: genresError } = await supabase
      .from('genres')
      .select('*');

    if (genresError) throw genresError;

    // 3. Lấy bảng xếp hạng theo ngày, tuần, tháng, năm từ database views
    const { data: topDaily } = await supabase.from('views_ranking_daily').select('*').order('view_count', { ascending: false }).limit(5);
    const { data: topWeekly } = await supabase.from('views_ranking_weekly').select('*').order('view_count', { ascending: false }).limit(5);
    const { data: topMonthly } = await supabase.from('views_ranking_monthly').select('*').order('view_count', { ascending: false }).limit(5);
    const { data: topYearly } = await supabase.from('views_ranking_yearly').select('*').order('view_count', { ascending: false }).limit(5);

    // 3b. Lấy bảng xếp hạng độc giả (top người đọc nhiều nhất theo EXP) - không chặn trang chủ nếu lỗi/chưa có bảng
    let topReaders = [];
    try {
      const { data: readers } = await supabase.from('leaderboard_by_exp').select('*').limit(5);
      topReaders = (readers || []).map(r => ({ ...r, badge: getBadgeForCount(r.chapters_read || 0) }));
    } catch (e) {
      console.error('Lỗi lấy BXH độc giả (bỏ qua, không chặn trang chủ):', e);
    }

    res.render('home', {
      title: 'Trang chủ - Web Đọc Truyện',
      user: req.user,
      stories,
      genres,
      topDaily: topDaily || [],
      topWeekly: topWeekly || [],
      topMonthly: topMonthly || [],
      topYearly: topYearly || [],
      topReaders,
      activeGenre: null,
      searchQuery: null
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
  const sort = req.query.sort || 'newest'; // newest | oldest | most_chapters | title_az

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
    if (genreStoryIds !== null) {
      if (genreStoryIds.length === 0) {
        // Không có truyện nào thuộc thể loại này -> trả về rỗng ngay
        return res.render('home', {
          title: `Kết quả tìm kiếm`,
          user: req.user,
          stories: [],
          genres,
          topDaily: [], topWeekly: [], topMonthly: [], topYearly: [],
          activeGenre,
          searchQuery: query,
          filters: { genre: genreSlug, status, minChapters: req.query.min_chapters || '', sort }
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

    res.render('home', {
      title: query ? `Kết quả tìm kiếm cho: "${query}"` : 'Tìm kiếm nâng cao',
      user: req.user,
      stories,
      genres,
      topDaily: [], topWeekly: [], topMonthly: [], topYearly: [], // ẩn bảng xếp hạng khi tìm kiếm
      activeGenre,
      searchQuery: query,
      filters: { genre: genreSlug, status, minChapters: req.query.min_chapters || '', sort }
    });
  } catch (err) {
    console.error('Lỗi tìm kiếm:', err);
    res.status(500).send('Lỗi tìm kiếm.');
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
      searchQuery: null
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
    const { data: chapters, error: chaptersErr } = await supabase
      .from('chapters')
      .select('id, chapter_number, title, created_at')
      .eq('story_id', storyId)
      .order('chapter_number', { ascending: true });

    if (chaptersErr) throw chaptersErr;

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
      ratingCount: ratingSummary ? ratingSummary.rating_count : 0
    });
  } catch (err) {
    console.error('Lỗi chi tiết truyện:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// TRANG ĐỌC CHƯƠNG TRUYỆN
router.get('/story/:story_id/chapter/:chapter_number', async (req, res) => {
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

    // 3. Ghi nhận lượt xem (Views) vào bảng story_views
    // Bấm xem chương nào thì chèn 1 bản ghi với story_id của truyện đó (không đồng bộ, không block trang)
    supabase.from('story_views').insert([{ story_id: storyId }]).then(({ error }) => {
      if (error) console.error('Lỗi khi ghi nhận views:', error);
    });

    // 3b. Lưu lịch sử đọc (tiến độ đọc gần nhất) nếu người dùng đã đăng nhập
    if (req.user && req.user.id) {
      supabase.from('reading_history').upsert(
        { user_id: req.user.id, story_id: storyId, chapter_number: chapterNumber, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,story_id' }
      ).then(({ error }) => {
        if (error) console.error('Lỗi khi lưu lịch sử đọc:', error);
      });

      // 3c. Gamification: ghi nhận lượt đọc chương (mỗi chương chỉ tính EXP 1 lần/người dùng) + cập nhật streak
      awardReadingExp(req.user.id, storyId, chapterNumber).catch(err => {
        console.error('Lỗi khi tính EXP/streak:', err);
      });
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

    res.render('read', {
      title: `Đọc truyện ${story.title} - Chương ${chapter.chapter_number}: ${chapter.title}`,
      user: req.user,
      story,
      chapter,
      hasPrev: !!prevChapter,
      hasNext: !!nextChapter,
      chaptersList: chaptersList || []
    });
  } catch (err) {
    console.error('Lỗi đọc chương:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// CHẤM ĐIỂM ĐÁNH GIÁ TRUYỆN (1-10) - CẦN ĐĂNG NHẬP
router.post('/rate/:story_id', async (req, res) => {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, error: 'Vui lòng đăng nhập để đánh giá truyện.' });
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

function getBadgeForCount(count) {
  for (const b of BADGE_THRESHOLDS) {
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

    const grouped = { reading: [], plan_to_read: [], completed: [], favorite: [] };
    (bookmarks || []).forEach(b => {
      if (!b.stories) return;
      const item = { ...b.stories, lastReadChapter: progressMap[b.story_id] || null };
      if (grouped[b.status]) grouped[b.status].push(item);
    });

    res.render('my-library', {
      title: 'Tủ truyện của tôi',
      user: req.user,
      grouped
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

module.exports = router;
