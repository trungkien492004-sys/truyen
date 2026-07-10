const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Sử dụng Memory Storage để chạy không đĩa (tương thích Vercel Serverless)
const upload = multer({ storage: multer.memoryStorage() });

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

    res.render('home', {
      title: 'Trang chủ - Web Đọc Truyện',
      user: req.user,
      stories,
      genres,
      topDaily: topDaily || [],
      topWeekly: topWeekly || [],
      topMonthly: topMonthly || [],
      topYearly: topYearly || [],
      activeGenre: null,
      searchQuery: null
    });
  } catch (err) {
    console.error('Lỗi trang chủ:', err);
    res.status(500).send('Đã xảy ra lỗi hệ thống.');
  }
});

// TÌM KIẾM TRUYỆN
router.get('/search', async (req, res) => {
  const query = req.query.q ? req.query.q.trim() : '';
  try {
    const { data: genres } = await supabase.from('genres').select('*');
    
    // Tìm truyện theo tên hoặc tác giả
    const { data: stories, error } = await supabase
      .from('stories')
      .select('*')
      .or(`title.ilike.%${query}%,author.ilike.%${query}%`)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.render('home', {
      title: `Kết quả tìm kiếm cho: "${query}"`,
      user: req.user,
      stories,
      genres,
      topDaily: [], topWeekly: [], topMonthly: [], topYearly: [], // ẩn bảng xếp hạng khi tìm kiếm
      activeGenre: null,
      searchQuery: query
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

    // 4. Nếu người dùng đã đăng nhập: lấy tiến độ đọc + trạng thái bookmark của truyện này
    let readingProgress = null;
    let bookmarkStatus = null;
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
    }

    res.render('story', {
      title: `${story.title} - Chi tiết truyện`,
      user: req.user,
      story,
      genres: storyGenres,
      chapters,
      readingProgress,
      bookmarkStatus
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
