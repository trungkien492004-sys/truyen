const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const multer = require('multer');
const path = require('path');
const mammoth = require('mammoth');
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

// Hàm phân tích file (Word/Txt) thành danh sách các chương truyện
async function parseFileToChapters(file, storyId) {
  const isDocx = file.originalname.endsWith('.docx') || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  let html = '';

  if (isDocx) {
    const options = {
      convertImage: mammoth.images.inline(function(element) {
        return element.read("base64").then(async function(imageBuffer) {
          const buffer = Buffer.from(imageBuffer, 'base64');
          const fileExt = element.contentType === 'image/jpeg' ? '.jpg' : '.png';
          const fileName = `word-img-${Date.now()}-${Math.round(Math.random() * 1E9)}${fileExt}`;
          
          const { error: uploadErr } = await supabase.storage
            .from('uploads')
            .upload(fileName, buffer, {
              contentType: element.contentType,
              upsert: true
            });

          if (uploadErr) throw uploadErr;

          const { data: { publicUrl } } = supabase.storage
            .from('uploads')
            .getPublicUrl(fileName);

          return { src: publicUrl };
        });
      })
    };

    const result = await mammoth.convertToHtml({ buffer: file.buffer }, options);
    html = result.value;
  } else {
    const text = file.buffer.toString('utf-8');
    html = text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => `<p>${line}</p>`)
      .join('');
  }

  // Regex cực kỳ linh hoạt để quét tiêu đề chương trong bất kỳ thẻ HTML nào (h1-h6, p, div)
  const regex = /<(h[1-6]|p)[^>]*?>\s*?(?:<strong>|<em>|<span>|style|class)*?\b(Chương|Chap|Chapter)\s+(\d+(?:\.\d+)?)\s*[:.-]?\s*(.*?)(?:<\/strong>|<\/em>|<\/span>)*?<\/h[1-6]|p>/gim;
  
  let matches = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    const cleanTitle = match[4] ? match[4].replace(/<\/?[^>]+(>|$)/g, "").trim() : `Chương ${match[3]}`;
    matches.push({
      index: match.index,
      fullText: match[0],
      number: parseFloat(match[3]),
      title: cleanTitle
    });
  }

  let chapters = [];
  if (matches.length > 0) {
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index + matches[i].fullText.length;
      const end = (i + 1 < matches.length) ? matches[i + 1].index : html.length;
      const body = html.substring(start, end).trim();

      chapters.push({
        story_id: parseInt(storyId),
        chapter_number: matches[i].number,
        title: matches[i].title,
        content: body
      });
    }
  } else {
    // Không tìm thấy tiêu đề chương nào -> Coi cả tệp tin là 1 chương
    const cleanFileName = path.basename(file.originalname, path.extname(file.originalname));
    chapters.push({
      story_id: parseInt(storyId),
      chapter_number: null, // sẽ tự động gán ở ngoài
      title: cleanFileName,
      content: html
    });
  }

  return chapters;
}

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
    // Lấy ảnh bìa nếu có upload lên Supabase Storage, nếu không để mặc định
    let coverUrl = '/css/default-cover.jpg';
    if (req.file) {
      coverUrl = await uploadToSupabase(req.file, 'uploads');
    }

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
    try {
      const { data: allGenres } = await supabase.from('genres').select('*');
      res.render('admin/add-story', {
        title: 'Đăng bộ truyện mới',
        user: req.user,
        genres: allGenres || [],
        success: null,
        error: `Lỗi thêm truyện: ${err.message || err}`
      });
    } catch (renderErr) {
      res.status(500).send(`Lỗi hệ thống: ${err.message || err}`);
    }
  }
});

// 3. TRANG ĐĂNG CHƯƠNG TRUYỆN MỚI (TÍCH HỢP)
router.get('/chapter/add', async (req, res) => {
  try {
    const { data: stories } = await supabase.from('stories').select('id, title').order('title');
    res.render('admin/add-chapter', {
      title: 'Đăng chương truyện mới',
      user: req.user,
      stories: stories || [],
      success: null,
      error: null
    });
  } catch (err) {
    console.error('Lỗi trang đăng chương:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// THỰC HIỆN ĐĂNG CHƯƠNG (HỖ TRỢ CẢ MANUAL VÀ BULK - UPLOAD NHIỀU FILE)
router.post('/chapter/add', upload.array('txtfile', 100), async (req, res) => {
  const { story_id, publish_method, chapter_number, title, content } = req.body;
  const files = req.files;

  if (!story_id) {
    return res.status(400).send('Vui lòng chọn bộ truyện.');
  }

  try {
    let chaptersToInsert = [];
    let successMessage = '';

    if (publish_method === 'manual') {
      // ĐĂNG THỦ CÔNG (NHẬP TAY)
      if (!chapter_number || !title || !content) {
        if (req.body.redirect_to) {
          return res.redirect(`${req.body.redirect_to}?error=${encodeURIComponent('Vui lòng điền đầy đủ tất cả thông tin chương.')}`);
        }
        const { data: stories } = await supabase.from('stories').select('id, title').order('title');
        return res.render('admin/add-chapter', {
          title: 'Đăng chương truyện mới',
          user: req.user,
          stories: stories || [],
          success: null,
          error: 'Vui lòng điền đầy đủ tất cả thông tin chương.'
        });
      }

      chaptersToInsert.push({
        story_id: parseInt(story_id),
        chapter_number: parseFloat(chapter_number),
        title: title.trim(),
        content: content
      });
      successMessage = `Đã đăng Chương ${chapter_number}: "${title}" thành công!`;

    } else {
      // ĐĂNG TỰ ĐỘNG (HỖ TRỢ UPLOAD HÀNG LOẠT NHIỀU FILE)
      if (!files || files.length === 0) {
        if (req.body.redirect_to) {
          return res.redirect(`${req.body.redirect_to}?error=${encodeURIComponent('Vui lòng chọn file tải lên (.txt hoặc .docx).')}`);
        }
        const { data: stories } = await supabase.from('stories').select('id, title').order('title');
        return res.render('admin/add-chapter', {
          title: 'Đăng chương truyện mới',
          user: req.user,
          stories: stories || [],
          success: null,
          error: 'Vui lòng chọn file tải lên (.txt hoặc .docx).'
        });
      }

      // Quét từng file để tách chương
      for (const file of files) {
        const parsed = await parseFileToChapters(file, story_id);
        chaptersToInsert.push(...parsed);
      }

      // Xử lý các chương không có số (mặc định Ngoại truyện và đánh số tự động tăng)
      const hasNullNumber = chaptersToInsert.some(c => c.chapter_number === null);
      if (hasNullNumber) {
        // Lấy số chương lớn nhất hiện tại của bộ truyện
        let nextNum = 1;
        const { data: maxChapterData } = await supabase
          .from('chapters')
          .select('chapter_number')
          .eq('story_id', story_id)
          .order('chapter_number', { ascending: false })
          .limit(1);

        if (maxChapterData && maxChapterData.length > 0) {
          nextNum = Math.floor(maxChapterData[0].chapter_number) + 1;
        }

        for (const chapter of chaptersToInsert) {
          if (chapter.chapter_number === null) {
            // Đặt tên tiêu đề mặc định Ngoại truyện
            if (!chapter.title.toLowerCase().startsWith('ngoại truyện')) {
              chapter.title = `Ngoại truyện - ${chapter.title}`;
            }
            chapter.chapter_number = nextNum++;
          }
        }
      }

      successMessage = `Đã tải lên thành công và nhập ${chaptersToInsert.length} chương mới vào hệ thống!`;
    }

    // Ghi vào Supabase (upsert)
    const { error: upsertErr } = await supabase
      .from('chapters')
      .upsert(chaptersToInsert, { onConflict: 'story_id,chapter_number' });

    if (upsertErr) throw upsertErr;

    if (req.body.redirect_to) {
      return res.redirect(`${req.body.redirect_to}?success=${encodeURIComponent(successMessage)}`);
    }
    const { data: stories } = await supabase.from('stories').select('id, title').order('title');
    res.render('admin/add-chapter', {
      title: 'Đăng chương truyện mới',
      user: req.user,
      stories: stories || [],
      success: successMessage,
      error: null
    });

  } catch (err) {
    console.error('Lỗi khi đăng chương:', err);
    if (req.body.redirect_to) {
      return res.redirect(`${req.body.redirect_to}?error=${encodeURIComponent(err.message || 'Lỗi hệ thống trong quá trình đăng chương.')}`);
    }
    res.status(500).send(`Lỗi hệ thống: ${err.message || err}`);
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

// 7. TRANG CHỈNH SỬA THÔNG TIN TRUYỆN
router.get('/story/edit/:id', async (req, res) => {
  const storyId = parseInt(req.params.id);
  try {
    // Lấy thông tin truyện
    const { data: story, error: storyErr } = await supabase
      .from('stories')
      .select('*')
      .eq('id', storyId)
      .single();

    if (storyErr || !story) {
      return res.status(404).send('Không tìm thấy truyện.');
    }

    // Lấy tất cả thể loại truyện
    const { data: genres } = await supabase.from('genres').select('*').order('name');

    // Lấy danh sách ID thể loại của truyện hiện tại
    const { data: linkedGenres } = await supabase
      .from('story_genres')
      .select('genre_id')
      .eq('story_id', storyId);

    const linkedGenreIds = linkedGenres ? linkedGenres.map(g => g.genre_id) : [];

    const success = req.query.success || null;
    const error = req.query.error || null;

    res.render('admin/edit-story', {
      title: `Chỉnh sửa truyện: ${story.title}`,
      user: req.user,
      story,
      genres: genres || [],
      linkedGenreIds,
      success,
      error
    });

  } catch (err) {
    console.error('Lỗi trang sửa truyện:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// THỰC HIỆN CẬP NHẬT TRUYỆN
router.post('/story/edit/:id', upload.single('cover'), async (req, res) => {
  const storyId = parseInt(req.params.id);
  const { title, author, description, commissioned_by, genres } = req.body;

  if (!title) {
    return res.status(400).send('Tên truyện không được để trống.');
  }

  try {
    // 1. Lấy thông tin truyện hiện tại để lấy ảnh bìa cũ
    const { data: currentStory } = await supabase
      .from('stories')
      .select('cover_url')
      .eq('id', storyId)
      .single();

    // Xác định ảnh bìa mới từ Supabase Storage
    let coverUrl = currentStory.cover_url;
    if (req.file) {
      coverUrl = await uploadToSupabase(req.file, 'uploads');
    }

    // 2. Cập nhật bảng `stories`
    const { error: updateStoryErr } = await supabase
      .from('stories')
      .update({
        title,
        author: author || 'Ẩn danh',
        description,
        cover_url: coverUrl,
        commissioned_by: commissioned_by ? commissioned_by.trim() : null
      })
      .eq('id', storyId);

    if (updateStoryErr) throw updateStoryErr;

    // 3. Đồng bộ lại thể loại trong bảng `story_genres`
    // Xóa liên kết thể loại cũ
    await supabase.from('story_genres').delete().eq('story_id', storyId);

    // Chèn liên kết thể loại mới nếu có chọn
    if (genres && genres.length > 0) {
      const genreArray = Array.isArray(genres) ? genres : [genres];
      const storyGenresInsert = genreArray.map(genreId => ({
        story_id: storyId,
        genre_id: parseInt(genreId)
      }));

      const { error: genreLinkErr } = await supabase
        .from('story_genres')
        .insert(storyGenresInsert);

      if (genreLinkErr) throw genreLinkErr;
    }

    res.redirect('/admin');

  } catch (err) {
    console.error('Lỗi cập nhật truyện:', err);
    res.redirect(`/admin/story/edit/${storyId}?error=${encodeURIComponent(err.message || 'Lỗi cập nhật truyện.')}`);
  }
});

// THỰC HIỆN XÓA TRUYỆN (VÀ CÁC THÔNG TIN LIÊN QUAN CASCADE)
router.post('/story/delete/:id', async (req, res) => {
  const storyId = parseInt(req.params.id);
  try {
    const { error } = await supabase
      .from('stories')
      .delete()
      .eq('id', storyId);

    if (error) throw error;
    res.redirect('/admin');
  } catch (err) {
    console.error('Lỗi xóa truyện:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// CHUYỂN HƯỚNG CÁC ĐƯỜNG DẪN CŨ VỀ ĐƯỜNG DẪN TÍCH HỢP MỚI
router.get('/chapter/add-manual', (req, res) => res.redirect('/admin/chapter/add'));
router.post('/chapter/add-manual', (req, res) => res.redirect('/admin/chapter/add'));
router.get('/chapter/add-bulk', (req, res) => res.redirect('/admin/chapter/add'));
router.post('/chapter/add-bulk', (req, res) => res.redirect('/admin/chapter/add'));

module.exports = router;


