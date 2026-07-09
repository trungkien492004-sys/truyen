const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Cấu hình Multer lưu file text tải lên để tách chương
const upload = multer({ dest: 'public/uploads/' });

// Middleware kiểm tra quyền Admin
function isAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.role === 'admin') {
    return next();
  }
  res.status(403).send('Bị từ chối truy cập: Quyền quản trị viên yêu cầu.');
}

// Áp dụng middleware kiểm tra Admin cho toàn bộ các tuyến ở đây
router.use(isAdmin);

// 1. TRANG DASHBOARD ADMIN (Thống kê & Quản lý)
router.get('/', async (req, res) => {
  try {
    // Thống kê tổng số lượng
    const { count: storiesCount } = await supabase.from('stories').select('*', { count: 'exact', head: true });
    const { count: chaptersCount } = await supabase.from('chapters').select('*', { count: 'exact', head: true });
    const { count: viewsCount } = await supabase.from('story_views').select('*', { count: 'exact', head: true });
    const { count: requestsCount } = await supabase.from('contact_requests').select('*', { count: 'exact', head: true });

    // Lấy danh sách truyện hiện có
    const { data: stories } = await supabase.from('stories').select('*').order('created_at', { ascending: false });

    res.render('admin/dashboard', {
      title: 'Trang quản trị (Admin Panel)',
      user: req.user,
      stats: {
        stories: storiesCount || 0,
        chapters: chaptersCount || 0,
        views: viewsCount || 0,
        requests: requestsCount || 0
      },
      stories: stories || []
    });
  } catch (err) {
    console.error('Lỗi dashboard admin:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// 2. TRANG ĐĂNG TRUYỆN MỚI
router.get('/story/add', async (req, res) => {
  try {
    const { data: genres } = await supabase.from('genres').select('*');
    res.render('admin/add-story', {
      title: 'Đăng bộ truyện mới',
      user: req.user,
      genres: genres || [],
      success: null,
      error: null
    });
  } catch (err) {
    console.error('Lỗi tải thể loại:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// THỰC HIỆN ĐĂNG TRUYỆN MỚI
router.post('/story/add', upload.single('cover'), async (req, res) => {
  const { title, author, description, commissioned_by, genres } = req.body;
  
  if (!title) {
    return res.status(400).send('Tên truyện không được để trống.');
  }

  try {
    // Lấy ảnh bìa nếu có upload, nếu không để mặc định
    const coverUrl = req.file ? `/uploads/${req.file.filename}` : '/css/default-cover.jpg';

    // 1. Thêm truyện vào bảng `stories`
    const { data: newStory, error: storyErr } = await supabase
      .from('stories')
      .insert([
        {
          title,
          author: author || 'Ẩn danh',
          description,
          cover_url: coverUrl,
          commissioned_by: commissioned_by ? commissioned_by.trim() : null
        }
      ])
      .select('*')
      .single();

    if (storyErr) throw storyErr;

    // 2. Thêm liên kết thể loại truyện vào bảng `story_genres` nếu được chọn
    if (genres && genres.length > 0) {
      const genreArray = Array.isArray(genres) ? genres : [genres];
      const storyGenresInsert = genreArray.map(genreId => ({
        story_id: newStory.id,
        genre_id: parseInt(genreId)
      }));

      const { error: genreLinkErr } = await supabase
        .from('story_genres')
        .insert(storyGenresInsert);

      if (genreLinkErr) throw genreLinkErr;
    }

    const { data: allGenres } = await supabase.from('genres').select('*');
    res.render('admin/add-story', {
      title: 'Đăng bộ truyện mới',
      user: req.user,
      genres: allGenres || [],
      success: `Đã thêm bộ truyện "${title}" thành công!`,
      error: null
    });

  } catch (err) {
    console.error('Lỗi thêm truyện:', err);
    res.status(500).send('Lỗi thêm truyện.');
  }
});

// 3. TRANG ĐĂNG CHƯƠNG THỦ CÔNG
router.get('/chapter/add-manual', async (req, res) => {
  try {
    const { data: stories } = await supabase.from('stories').select('id, title').order('title');
    res.render('admin/add-manual', {
      title: 'Đăng chương thủ công',
      user: req.user,
      stories: stories || [],
      success: null,
      error: null
    });
  } catch (err) {
    console.error('Lỗi trang đăng chương thủ công:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// THỰC HIỆN ĐĂNG CHƯƠNG THỦ CÔNG
router.post('/chapter/add-manual', async (req, res) => {
  const { story_id, chapter_number, title, content } = req.body;
  
  if (!story_id || !chapter_number || !title || !content) {
    return res.status(400).send('Vui lòng điền đầy đủ tất cả thông tin chương.');
  }

  try {
    // Chèn chương mới vào Supabase, sử dụng upsert để ghi đè nếu trùng số chương của bộ truyện đó
    const { error } = await supabase
      .from('chapters')
      .upsert([
        {
          story_id: parseInt(story_id),
          chapter_number: parseInt(chapter_number),
          title: title,
          content: content
        }
      ], { onConflict: 'story_id,chapter_number' });

    if (error) throw error;

    const { data: stories } = await supabase.from('stories').select('id, title').order('title');
    res.render('admin/add-manual', {
      title: 'Đăng chương thủ công',
      user: req.user,
      stories: stories || [],
      success: `Đăng chương ${chapter_number}: "${title}" thành công!`,
      error: null
    });
  } catch (err) {
    console.error('Lỗi đăng chương tay:', err);
    res.status(500).send('Lỗi đăng chương.');
  }
});

// 4. TRANG ĐĂNG CHƯƠNG TỰ ĐỘNG (BULK IMPORT)
router.get('/chapter/add-bulk', async (req, res) => {
  try {
    const { data: stories } = await supabase.from('stories').select('id, title').order('title');
    res.render('admin/add-bulk', {
      title: 'Tự động tách chương từ File văn bản',
      user: req.user,
      stories: stories || [],
      success: null,
      error: null
    });
  } catch (err) {
    console.error('Lỗi trang add-bulk:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// THỰC HIỆN TỰ ĐỘNG TÁCH CHƯƠNG VÀ LƯU
router.post('/chapter/add-bulk', upload.single('txtfile'), async (req, res) => {
  const { story_id } = req.body;
  const file = req.file;

  if (!story_id || !file) {
    return res.status(400).send('Vui lòng chọn bộ truyện và upload file văn bản (.txt).');
  }

  try {
    // Đọc nội dung tệp văn bản
    const text = fs.readFileSync(file.path, 'utf-8');
    
    // Xóa file tạm thời sau khi đọc xong
    fs.unlinkSync(file.path);

    // Regular Expression để tìm dòng bắt đầu bằng: Chương X, Chap X, Chapter X
    // Hỗ trợ số nguyên hoặc số thập phân (ví dụ: Chương 1.5)
    // Dạng: Chương 1: Tên chương hoặc Chap 2 - Tên chương
    const regex = /^(Chương|Chap|Chapter)\s+(\d+(?:\.\d+)?)\s*[:.-]?\s*(.*)$/gim;

    let matches = [];
    let match;

    // Tìm tất cả các tiêu đề chương
    while ((match = regex.exec(text)) !== null) {
      matches.push({
        index: match.index,
        fullText: match[0],
        prefix: match[1],
        number: parseFloat(match[2]),
        title: match[3] ? match[3].trim() : `Chương ${match[2]}`
      });
    }

    if (matches.length === 0) {
      const { data: stories } = await supabase.from('stories').select('id, title').order('title');
      return res.render('admin/add-bulk', {
        title: 'Tự động tách chương từ File văn bản',
        user: req.user,
        stories: stories || [],
        success: null,
        error: 'Không tìm thấy chương truyện nào trong file. Đảm bảo file chứa các từ khóa đầu dòng như "Chương 1:", "Chap 2:", ...'
      });
    }

    let chaptersToInsert = [];
    
    // Cắt nội dung văn bản dựa trên khoảng vị trí giữa các tiêu đề chương
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index + matches[i].fullText.length;
      const end = (i + 1 < matches.length) ? matches[i + 1].index : text.length;
      
      const rawContent = text.substring(start, end).trim();
      
      // Chuyển đổi ký tự ngắt dòng (\n) thành thẻ <p> để hiển thị tốt trên trang web
      const formattedContent = rawContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => `<p>${line}</p>`)
        .join('');

      chaptersToInsert.push({
        story_id: parseInt(story_id),
        chapter_number: matches[i].number,
        title: matches[i].title,
        content: formattedContent
      });
    }

    // Ghi hàng loạt vào Supabase, sử dụng upsert để ghi đè chương cũ nếu trùng số
    const { error: upsertErr } = await supabase
      .from('chapters')
      .upsert(chaptersToInsert, { onConflict: 'story_id,chapter_number' });

    if (upsertErr) throw upsertErr;

    const { data: stories } = await supabase.from('stories').select('id, title').order('title');
    res.render('admin/add-bulk', {
      title: 'Tự động tách chương từ File văn bản',
      user: req.user,
      stories: stories || [],
      success: `Đã phân tích file thành công và nhập ${chaptersToInsert.length} chương mới vào hệ thống!`,
      error: null
    });

  } catch (err) {
    console.error('Lỗi khi tách chương:', err);
    res.status(500).send('Có lỗi xảy ra trong quá trình xử lý tệp tin.');
  }
});

// 5. XEM YÊU CẦU ĐẶT VIẾT TRUYỆN CỦA ĐỘC GIẢ
router.get('/requests', async (req, res) => {
  try {
    const { data: requests, error } = await supabase
      .from('contact_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.render('admin/requests', {
      title: 'Danh sách yêu cầu độc giả',
      user: req.user,
      requests: requests || []
    });
  } catch (err) {
    console.error('Lỗi lấy danh sách yêu cầu:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// 6. QUẢN LÝ THỂ LOẠI (HIỂN THỊ DANH SÁCH)
router.get('/genres', async (req, res) => {
  try {
    const { data: genres, error } = await supabase
      .from('genres')
      .select('*')
      .order('name');
    
    if (error) throw error;
    
    res.render('admin/genres', {
      title: 'Quản lý thể loại',
      user: req.user,
      genres: genres || [],
      success: null,
      error: null
    });
  } catch (err) {
    console.error('Lỗi lấy danh sách thể loại:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// THÊM THỂ LOẠI MỚI
router.post('/genres/add', async (req, res) => {
  const { name } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).send('Tên thể loại không được để trống.');
  }

  // Hàm chuyển tiếng Việt có dấu thành slug không dấu
  function slugify(text) {
    return text.toString().toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .replace(/([^a-z0-9\s-]|_)+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  const slug = slugify(name);

  try {
    const { error } = await supabase
      .from('genres')
      .insert([{ name: name.trim(), slug: slug }]);

    if (error) {
      // Trường hợp trùng lặp tên/slug
      if (error.code === '23505' || error.code === '23505_CONFLICT') { 
        const { data: genres } = await supabase.from('genres').select('*').order('name');
        return res.render('admin/genres', {
          title: 'Quản lý thể loại',
          user: req.user,
          genres: genres || [],
          success: null,
          error: 'Thể loại này đã tồn tại!'
        });
      }
      throw error;
    }

    res.redirect('/admin/genres');
  } catch (err) {
    console.error('Lỗi thêm thể loại:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// XÓA THỂ LOẠI
router.post('/genres/delete/:id', async (req, res) => {
  const genreId = parseInt(req.params.id);
  try {
    const { error } = await supabase
      .from('genres')
      .delete()
      .eq('id', genreId);

    if (error) throw error;
    res.redirect('/admin/genres');
  } catch (err) {
    console.error('Lỗi xóa thể loại:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

module.exports = router;

