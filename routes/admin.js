const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const multer = require('multer');
const path = require('path');
const mammoth = require('mammoth');
const fs = require('fs');
const PDFParser = require('pdf2json');

// Sử dụng Memory Storage để chạy không đĩa (tương thích Vercel Serverless)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit cho PDF

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



// Hàm phân tích file PDF thành nhiều chương (tự động tách dựa theo đầu dòng "Chương X" / "Chapter X")
async function parsePdfToChapters(buffer, storyId) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser(this, 1);
    
    pdfParser.on('pdfParser_dataError', errData => reject(errData.parserError));
    pdfParser.on('pdfParser_dataReady', pdfData => {
      try {
        const rawText = pdfParser.getRawTextContent().replace(/\r\n/g, '\n').replace(/-{3,}Page \(\d+\) Break-{3,}/g, '');
        
        const chapterHeaderRegex = /^(?:Chương|CHƯƠNG|Chap|CHAP|Chapter|CHAPTER|Phần|PHẦN|Part|PART)\s*\.?\s*(\d+(?:\.\d+)?)(?:[:\s,\-–]+(.*))?$/im;

        const lines = rawText.split('\n');
        const chapters = [];
        let currentChapter = null;
        let currentLines = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          const match = line.match(chapterHeaderRegex);

          if (match) {
            if (currentChapter !== null) {
              chapters.push({
                ...currentChapter,
                content: currentLines.filter(l => l.trim()).map(l => `<p>${l.trim()}</p>`).join('')
              });
            }
            const chapNum = parseFloat(match[1]);
            const chapTitle = match[2] ? match[2].trim() : '';
            currentChapter = {
              story_id: parseInt(storyId),
              chapter_number: chapNum,
              title: chapTitle ? `Chương ${chapNum}: ${chapTitle}` : `Chương ${chapNum}`
            };
            currentLines = [];
          } else if (currentChapter !== null) {
            currentLines.push(line);
          }
        }

        if (currentChapter !== null && currentLines.length > 0) {
          chapters.push({
            ...currentChapter,
            content: currentLines.filter(l => l.trim()).map(l => `<p>${l.trim()}</p>`).join('')
          });
        }

        resolve(chapters);
      } catch (err) {
        reject(err);
      }
    });

    pdfParser.parseBuffer(buffer);
  });
}

// Hàm phân tích 1 tệp tin (Word/Txt) thành đúng 1 chương duy nhất (1 file = 1 chương)
function normalizeChapterNumber(num) {
  return Number.isFinite(num) ? Math.floor(num) : null;
}

function syncPdfChapterNumbers(chapters, existingMaxChapter) {
  const numberedChapters = chapters.filter(ch => Number.isFinite(ch.chapter_number));
  if (numberedChapters.length === 0) {
    return chapters;
  }

  const minParsed = Math.min(...numberedChapters.map(ch => Math.floor(ch.chapter_number)));
  const targetStart = Number.isFinite(existingMaxChapter) && existingMaxChapter > 0
    ? Math.floor(existingMaxChapter) + 1
    : minParsed;
  const offset = targetStart - minParsed;

  if (offset === 0) {
    return chapters;
  }

  return chapters.map(chapter => {
    if (!Number.isFinite(chapter.chapter_number)) {
      return chapter;
    }

    const nextNumber = Math.floor(chapter.chapter_number) + offset;
    const nextTitle = chapter.title
      ? chapter.title.replace(/^Chương\s+\d+(?::\s*)?/i, `Chương ${nextNumber}: `).replace(/:\s*$/, '')
      : `Chương ${nextNumber}`;

    return {
      ...chapter,
      chapter_number: nextNumber,
      title: nextTitle
    };
  });
}
async function parseSingleFileToChapter(file, storyId) {
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

  // Phân tích tên tệp tin để trích xuất số chương và tiêu đề chương
  const fileName = path.basename(file.originalname, path.extname(file.originalname)).trim();
  let chapter_number = null;
  let title = '';

  // 1. Kiểm tra định dạng 3 phần phân cách bởi _ hoặc -
  const parts = fileName.split(/[_-]/).map(p => p.trim());
  if (parts.length >= 3) {
    const chapNumStr = parts[1];
    const numMatch = chapNumStr.match(/(?:Chương|Chap|Chapter|Phần|Part|P|chuong|phan)?\s*?\.?\s*?(\d+(?:\.\d+)?)/i);
    if (numMatch) {
      chapter_number = parseFloat(numMatch[1]);
    } else {
      const standaloneNumMatch = chapNumStr.match(/(\d+(?:\.\d+)?)/);
      if (standaloneNumMatch) {
        chapter_number = parseFloat(standaloneNumMatch[1]);
      }
    }
    title = parts[2];
  } else {
    // Không khớp định dạng 3 phần -> Tìm số chương trong toàn bộ tên file
    // Hỗ trợ Chương 1, Chap 2, Chapter 3, Phần 4, Part 5, P6, p.7, p 8, chuong 9, phan 10, chuong10, p10...
    const numMatch = fileName.match(/(?:Chương|Chap|Chapter|Phần|Part|P|chuong|phan)\s*?\.?\s*?(\d+(?:\.\d+)?)/i);
    if (numMatch) {
      chapter_number = parseFloat(numMatch[1]);
    } else {
      // Tìm số chương viết dính liền không dấu: chuong1, phan2, p3...
      const dínhMatch = fileName.match(/(?:chuong|phan|p|chap|part)(\d+(?:\.\d+)?)/i);
      if (dínhMatch) {
        chapter_number = parseFloat(dínhMatch[1]);
      } else {
        // Tìm bất kỳ số đơn lẻ nào trong tên file
        const standaloneNumMatch = fileName.match(/(\d+(?:\.\d+)?)/);
        if (standaloneNumMatch) {
          standaloneNumMatch
          chapter_number = parseFloat(standaloneNumMatch[1]);
        }
      }
    }
    // Thông minh: Giữ lại toàn bộ tên file gốc làm tiêu đề chương nếu không đúng định dạng 3 phần
    title = fileName;
  }

  return {
    story_id: parseInt(storyId),
    chapter_number: chapter_number,
    title: title || null,
    content: html
  };
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
  const { title, author, description, commissioned_by, genres, status } = req.body;
  
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
          commissioned_by: commissioned_by ? commissioned_by.trim() : null,
          status: status === 'completed' ? 'completed' : 'ongoing'
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

      // Quét từng file để tách chương (1 file = 1 chương)
      for (const file of files) {
        const parsed = await parseSingleFileToChapter(file, story_id);
        chaptersToInsert.push(parsed);
      }

      // Lấy tất cả số chương hiện có của bộ truyện này trong database để đối chiếu
      const { data: existingChapters } = await supabase
        .from('chapters')
        .select('chapter_number')
        .eq('story_id', story_id);
      
      const existingNumbers = new Set(existingChapters ? existingChapters.map(c => c.chapter_number) : []);
      const usedNumbers = new Set();

      // Bước 1: Xử lý các chương có số cụ thể trước để tránh bị trùng lặp
      for (const chapter of chaptersToInsert) {
        if (chapter.chapter_number !== null && chapter.chapter_number !== undefined && !isNaN(chapter.chapter_number)) {
          let num = chapter.chapter_number;
          // Nếu số chương bị trùng trong lô upload này, tự động tăng lên
          while (usedNumbers.has(num)) {
            num++;
          }
          chapter.chapter_number = num;
          usedNumbers.add(num);
        }
      }

      // Bước 2: Tìm nextNum cho các chương không có số
      let nextNum = 1;
      const sortedExisting = Array.from(existingNumbers).sort((a, b) => b - a);
      if (sortedExisting.length > 0) {
        nextNum = Math.floor(sortedExisting[0]) + 1;
      }

      // Bước 3: Xử lý các chương chưa có số (mặc định gán số tăng dần)
      for (const chapter of chaptersToInsert) {
        if (chapter.chapter_number === null || chapter.chapter_number === undefined || isNaN(chapter.chapter_number)) {
          while (existingNumbers.has(nextNum) || usedNumbers.has(nextNum)) {
            nextNum++;
          }
          chapter.chapter_number = nextNum++;
          usedNumbers.add(chapter.chapter_number);
        }
        // Đặt tiêu đề chương thông minh nếu thiếu
        if (!chapter.title) {
          chapter.title = `Chương ${chapter.chapter_number}`;
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

// ĐĂNG CHƯƠNG QUA JSON (HỖ TRỢ GIẢI QUYẾT LỖI PAYLOAD 413 VERCEL)
router.post('/chapter/add-json', async (req, res) => {
  const { story_id, files } = req.body;

  if (!story_id || !files || files.length === 0) {
    return res.status(400).json({ error: 'Thiếu thông tin truyện hoặc tệp tin.' });
  }

  try {
    let chaptersToInsert = [];

    for (const file of files) {
      let content = file.content;
      if (file.type !== 'docx') {
        // Định dạng file Text thành thẻ <p>
        content = file.content
          .split('\n')
          .map(line => line.trim())
          .filter(line => line.length > 0)
          .map(line => `<p>${line}</p>`)
          .join('');
      }

      // Phân tích tên tệp tin để lấy số chương và tiêu đề chương
      const fileName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
      let chapter_number = null;
      let title = '';

      // 1. Kiểm tra định dạng 3 phần: [Tên truyện]_[Số chương]_[Tiêu đề] hoặc [Tên truyện]-[Số chương]-[Tiêu đề]
      const parts = fileName.split(/[_-]/).map(p => p.trim());
      if (parts.length >= 3) {
        const chapNumStr = parts[1];
        const numMatch = chapNumStr.match(/(?:Chương|Chap|Chapter|Phần|Part|P|chuong|phan)?\s*?\.?\s*?(\d+(?:\.\d+)?)/i);
        if (numMatch) {
          chapter_number = parseFloat(numMatch[1]);
        } else {
          const standaloneNumMatch = chapNumStr.match(/(\d+(?:\.\d+)?)/);
          if (standaloneNumMatch) {
            chapter_number = parseFloat(standaloneNumMatch[1]);
          }
        }
        title = parts[2];
      } else {
        // Hỗ trợ Chương 1, Chap 2, Chapter 3, Phần 4, Part 5, P6, p.7, p 8, chuong 9, phan 10, chuong10, p10...
        const numMatch = fileName.match(/(?:Chương|Chap|Chapter|Phần|Part|P|chuong|phan)\s*?\.?\s*?(\d+(?:\.\d+)?)/i);
        if (numMatch) {
          chapter_number = parseFloat(numMatch[1]);
        } else {
          // Tìm số chương viết dính liền không dấu: chuong1, phan2, p3...
          const dínhMatch = fileName.match(/(?:chuong|phan|p|chap|part)(\d+(?:\.\d+)?)/i);
          if (dínhMatch) {
            chapter_number = parseFloat(dínhMatch[1]);
          } else {
            // Tìm bất kỳ số đơn lẻ nào trong tên file
            const standaloneNumMatch = fileName.match(/(\d+(?:\.\d+)?)/);
            if (standaloneNumMatch) {
              chapter_number = parseFloat(standaloneNumMatch[1]);
            }
          }
        }
      }

      chaptersToInsert.push({
        story_id: parseInt(story_id),
        chapter_number: chapter_number,
        title: title || null,
        content: content
      });
    }

    // Lấy tất cả số chương hiện có của bộ truyện này trong database để đối chiếu
    const { data: existingChapters } = await supabase
      .from('chapters')
      .select('chapter_number')
      .eq('story_id', story_id);
    
    const existingNumbers = new Set(existingChapters ? existingChapters.map(c => c.chapter_number) : []);
    const usedNumbers = new Set();

    // Bước 1: Xử lý các chương có số cụ thể trước để tránh bị trùng lặp
    for (const chapter of chaptersToInsert) {
      if (chapter.chapter_number !== null && chapter.chapter_number !== undefined && !isNaN(chapter.chapter_number)) {
        let num = chapter.chapter_number;
        // Nếu số chương bị trùng trong lô upload này, tự động tăng lên
        while (usedNumbers.has(num)) {
          num++;
        }
        chapter.chapter_number = num;
        usedNumbers.add(num);
      }
    }

    // Bước 2: Tìm nextNum cho các chương không có số
    let nextNum = 1;
    const sortedExisting = Array.from(existingNumbers).sort((a, b) => b - a);
    if (sortedExisting.length > 0) {
      nextNum = Math.floor(sortedExisting[0]) + 1;
    }

    // Bước 3: Xử lý các chương chưa có số (mặc định gán số tăng dần)
    for (const chapter of chaptersToInsert) {
      if (chapter.chapter_number === null || chapter.chapter_number === undefined || isNaN(chapter.chapter_number)) {
        while (existingNumbers.has(nextNum) || usedNumbers.has(nextNum)) {
          nextNum++;
        }
        chapter.chapter_number = nextNum++;
        usedNumbers.add(chapter.chapter_number);
      }
      // Đặt tiêu đề chương thông minh nếu thiếu
      if (!chapter.title) {
        chapter.title = `Chương ${chapter.chapter_number}`;
      }
    }

    const { error: upsertErr } = await supabase
      .from('chapters')
      .upsert(chaptersToInsert, { onConflict: 'story_id,chapter_number' });

    if (upsertErr) throw upsertErr;

    res.json({ success: true, message: `Đã tải lên thành công và nhập ${chaptersToInsert.length} chương mới vào hệ thống!` });

  } catch (err) {
    console.error('Lỗi khi đăng chương qua JSON:', err);
    res.status(500).json({ error: err.message || 'Lỗi hệ thống.' });
  }
});

// ĐĂNG CHƯƠNG QUA UPLOAD PDF (TỰ ĐỘNG TÁCH CHƯƠNG)
router.post('/chapter/add-pdf', upload.single('pdffile'), async (req, res) => {
  try {
    const { story_id } = req.body;
    if (!req.file || !story_id) {
      return res.json({ success: false, error: 'Thiếu file hoặc story_id' });
    }

    let chapters = await parsePdfToChapters(req.file.buffer, story_id);
    const { data: existingChapters } = await supabase
      .from('chapters')
      .select('chapter_number')
      .eq('story_id', story_id);

    const normalizedExisting = (existingChapters || [])
      .map(c => normalizeChapterNumber(c.chapter_number))
      .filter(Number.isFinite);
    const existingMaxChapter = normalizedExisting.length > 0
      ? Math.max(...normalizedExisting)
      : null;

    chapters = syncPdfChapterNumbers(chapters, existingMaxChapter);

    // Nếu PDF không có từ khóa chương nào được nhận diện -> đăng toàn bộ nội dung thành 1 chương duy nhất
    if (chapters.length === 0) {
      const pdfData = await pdfParse(req.file.buffer);
      const rawText = pdfData.text;
      const html = rawText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => `<p>${line}</p>`)
        .join('');

      if (!html) {
        return res.json({ success: false, error: 'Không tìm thấy chương nào trong PDF' });
      }

      const nextNum = Number.isFinite(existingMaxChapter) ? Math.floor(existingMaxChapter) + 1 : 1;

      chapters = [{
        story_id: parseInt(story_id),
        chapter_number: nextNum,
        title: `Chương ${nextNum}`,
        content: html
      }];
    }
    const { error } = await supabase.from('chapters')
      .upsert(chapters, { onConflict: 'story_id,chapter_number' });
    if (error) throw error;

    res.json({ success: true, message: `Đã tách và đăng ${chapters.length} chương từ PDF!` });
  } catch (err) {
    console.error('Lỗi khi đăng chương từ PDF:', err);
    res.json({ success: false, error: err.message || 'Lỗi hệ thống khi xử lý PDF.' });
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

    // Lấy danh sách chương của truyện
    const { data: chapters } = await supabase
      .from('chapters')
      .select('id, chapter_number, title')
      .eq('story_id', storyId)
      .order('chapter_number', { ascending: true });

    const success = req.query.success || null;
    const error = req.query.error || null;

    res.render('admin/edit-story', {
      title: `Chỉnh sửa truyện: ${story.title}`,
      user: req.user,
      story,
      genres: genres || [],
      linkedGenreIds,
      chapters: chapters || [],
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
  const { title, author, description, commissioned_by, genres, status } = req.body;

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
        commissioned_by: commissioned_by ? commissioned_by.trim() : null,
        status: status === 'completed' ? 'completed' : 'ongoing'
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

// 8. TRANG CHỈNH SỬA CHI TIẾT CHƯƠNG TRUYỆN
router.get('/chapter/edit/:id', async (req, res) => {
  const chapterId = parseInt(req.params.id);
  const redirectTo = req.query.redirect_to || '/admin';

  try {
    // Lấy thông tin chi tiết chương
    const { data: chapter, error: chapErr } = await supabase
      .from('chapters')
      .select('*')
      .eq('id', chapterId)
      .single();

    if (chapErr || !chapter) {
      return res.status(404).send('Không tìm thấy chương truyện.');
    }

    // Lấy tên bộ truyện để hiển thị ngữ cảnh
    const { data: story } = await supabase
      .from('stories')
      .select('title')
      .eq('id', chapter.story_id)
      .single();

    res.render('admin/edit-chapter', {
      title: `Sửa chương: ${chapter.title}`,
      user: req.user,
      chapter,
      storyTitle: story ? story.title : 'Không rõ',
      redirect_to: redirectTo,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Lỗi tải trang sửa chương:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// THỰC HIỆN CẬP NHẬT CHƯƠNG TRUYỆN
router.post('/chapter/edit/:id', async (req, res) => {
  const chapterId = parseInt(req.params.id);
  const { chapter_number, title, content, redirect_to } = req.body;

  if (!chapter_number || !content) {
    return res.redirect(`/admin/chapter/edit/${chapterId}?redirect_to=${encodeURIComponent(redirect_to)}&error=${encodeURIComponent('Vui lòng nhập số chương và nội dung.')}`);
  }

  try {
    const targetChapterNumber = Math.max(1, parseInt(chapter_number) || 1);
    const newTitle = title ? title.trim() : '';

    // Lấy thông tin chương hiện tại
    const { data: currentChap, error: fetchErr } = await supabase.from('chapters').select('story_id, chapter_number').eq('id', chapterId).single();
    if (fetchErr || !currentChap) throw new Error('Không tìm thấy chương.');

    // Cập nhật nội dung và tiêu đề trước
    const { error: updateContentErr } = await supabase.from('chapters').update({ title: newTitle, content: content }).eq('id', chapterId);
    if (updateContentErr) throw updateContentErr;

    // Nếu thay đổi số thứ tự chương, tiến hành sắp xếp lại
    if (currentChap.chapter_number !== targetChapterNumber) {
        // Lấy tất cả các chương, sắp xếp theo chapter_number
        const { data: allChapters, error: allErr } = await supabase.from('chapters').select('id, chapter_number').eq('story_id', currentChap.story_id).order('chapter_number', { ascending: true });
        if (allErr) throw allErr;

        const currentIndex = allChapters.findIndex(c => c.id === chapterId);
        if (currentIndex !== -1) {
            const targetChap = allChapters.splice(currentIndex, 1)[0];
            
            let newIndex = targetChapterNumber - 1;
            if (newIndex < 0) newIndex = 0;
            if (newIndex > allChapters.length) newIndex = allChapters.length;
            
            allChapters.splice(newIndex, 0, targetChap);
            
            const changedChapters = [];
            allChapters.forEach((ch, idx) => {
                const expectedNumber = idx + 1;
                if (ch.chapter_number !== expectedNumber) {
                    changedChapters.push({ id: ch.id, newNumber: expectedNumber });
                }
            });
            
            if (changedChapters.length > 0) {
                // Đổi thành số âm để né UNIQUE constraint
                for (const ch of changedChapters) {
                    await supabase.from('chapters').update({ chapter_number: -ch.id }).eq('id', ch.id);
                }
                // Đổi thành số đúng
                for (const ch of changedChapters) {
                    await supabase.from('chapters').update({ chapter_number: ch.newNumber }).eq('id', ch.id);
                }
            }
        }
    }

    res.redirect(`${redirect_to}?success=${encodeURIComponent('Đã cập nhật chương thành công!')}`);
  } catch (err) {
    console.error('Lỗi cập nhật chương:', err);
    res.redirect(`/admin/chapter/edit/${chapterId}?redirect_to=${encodeURIComponent(redirect_to)}&error=${encodeURIComponent(err.message || 'Lỗi hệ thống.')}`);
  }
});

// XÓA CHƯƠNG HÀNG LOẠT HOẶC XÓA TẤT CẢ CHƯƠNG
router.post('/chapter/delete-bulk', async (req, res) => {
  const { ids, action, story_id } = req.body;

  try {
    if (action === 'all') {
      if (!story_id) {
        return res.status(400).json({ error: 'Thiếu ID bộ truyện để xóa tất cả.' });
      }
      const { error } = await supabase
        .from('chapters')
        .delete()
        .eq('story_id', parseInt(story_id));

      if (error) throw error;
      return res.json({ success: true, message: 'Đã xóa tất cả các chương của bộ truyện này!' });
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Vui lòng chọn ít nhất một chương để xóa.' });
    }

    const { error } = await supabase
      .from('chapters')
      .delete()
      .in('id', ids.map(id => parseInt(id)));

    if (error) throw error;
    res.json({ success: true, message: `Đã xóa thành công ${ids.length} chương được chọn!` });

  } catch (err) {
    console.error('Lỗi khi xóa chương hàng loạt:', err);
    res.status(500).json({ error: err.message || 'Lỗi hệ thống khi xóa chương.' });
  }
});

// THỰC HIỆN XÓA MỘT CHƯƠNG ĐƠN LẺ TRỰC TIẾP
router.post('/chapter/delete/:id', async (req, res) => {
  const chapterId = parseInt(req.params.id);
  const redirectTo = req.body.redirect_to || '/admin';

  try {
    const { error } = await supabase
      .from('chapters')
      .delete()
      .eq('id', chapterId);

    if (error) throw error;

    res.redirect(`${redirectTo}?success=${encodeURIComponent('Đã xóa chương thành công!')}`);
  } catch (err) {
    console.error('Lỗi xóa chương:', err);
    res.redirect(`${redirectTo}?error=${encodeURIComponent(err.message || 'Lỗi hệ thống khi xóa chương.')}`);
  }
});

// QUẢN LÝ BANNER TRANG CHỦ
router.get('/banners', async (req, res) => {
  try {
    const { data: banners } = await supabase.from('banners').select('*').order('created_at', { ascending: false });
    res.render('admin/banners', {
      title: 'Quản lý Banner trang chủ',
      user: req.user,
      banners: banners || [],
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Lỗi trang quản lý banner:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// THỰC HIỆN THÊM BANNER MỚI (HỖ TRỢ CẢ HÌNH ẢNH VÀ VIDEO)
router.post('/banners/add', upload.single('media'), async (req, res) => {
  const { description, link_url } = req.body;
  if (!req.file) {
    return res.redirect('/admin/banners?error=' + encodeURIComponent('Vui lòng chọn tệp hình ảnh hoặc video để tải lên.'));
  }

  try {
    const mediaUrl = await uploadToSupabase(req.file, 'uploads');
    const isVideo = req.file.mimetype.startsWith('video/');
    const mediaType = isVideo ? 'video' : 'image';

    const { error } = await supabase.from('banners').insert([{
      media_url: mediaUrl,
      media_type: mediaType,
      description: description ? description.trim() : '',
      link_url: link_url ? link_url.trim() : null
    }]);

    if (error) throw error;
    res.redirect('/admin/banners?success=' + encodeURIComponent('Đã tải lên và tạo banner mới thành công!'));
  } catch (err) {
    console.error('Lỗi thêm banner:', err);
    res.redirect('/admin/banners?error=' + encodeURIComponent(err.message || 'Lỗi hệ thống khi tải lên banner.'));
  }
});

// THỰC HIỆN XÓA BANNER
router.post('/banners/delete/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const { error } = await supabase.from('banners').delete().eq('id', id);
    if (error) throw error;
    res.redirect('/admin/banners?success=' + encodeURIComponent('Đã xóa banner thành công!'));
  } catch (err) {
    console.error('Lỗi khi xóa banner:', err);
    res.redirect('/admin/banners?error=' + encodeURIComponent(err.message || 'Lỗi hệ thống khi xóa banner.'));
  }
});

// TRANG CHỈNH SỬA BANNER (GET)
router.get('/banners/edit/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const { data: banner, error } = await supabase.from('banners').select('*').eq('id', id).single();
    if (error || !banner) {
      return res.status(404).send('Không tìm thấy banner.');
    }
    res.render('admin/edit-banner', {
      title: 'Chỉnh sửa Banner',
      user: req.user,
      banner,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Lỗi trang sửa banner:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// THỰC HIỆN CẬP NHẬT BANNER (POST)
router.post('/banners/edit/:id', upload.single('media'), async (req, res) => {
  const id = parseInt(req.params.id);
  const { description, link_url } = req.body;
  try {
    const updateData = {
      description: description ? description.trim() : '',
      link_url: link_url ? link_url.trim() : null
    };

    if (req.file) {
      const mediaUrl = await uploadToSupabase(req.file, 'uploads');
      const isVideo = req.file.mimetype.startsWith('video/');
      const mediaType = isVideo ? 'video' : 'image';
      updateData.media_url = mediaUrl;
      updateData.media_type = mediaType;
    }

    const { error } = await supabase.from('banners').update(updateData).eq('id', id);
    if (error) throw error;

    res.redirect('/admin/banners?success=' + encodeURIComponent('Đã cập nhật banner thành công!'));
  } catch (err) {
    console.error('Lỗi chỉnh sửa banner:', err);
    res.redirect(`/admin/banners/edit/${id}?error=` + encodeURIComponent(err.message || 'Lỗi hệ thống.'));
  }
});

// 10. QUẢN LÝ BÌNH LUẬN & NGƯỜI DÙNG
router.get('/comments', async (req, res) => {
  try {
    const { data: comments, error } = await supabase
      .from('comments')
      .select('*, users!comments_user_id_fkey(id, display_name, email, avatar, is_banned, role), stories!comments_story_id_fkey(title)')
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.render('admin/comments', {
      title: 'Quản lý Bình luận & Người dùng',
      user: req.user,
      comments: comments || [],
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Lỗi khi lấy danh sách bình luận:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// Xóa hàng loạt bình luận
router.post('/comments/bulk-delete', async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ success: false, error: 'Không tìm thấy ID để xóa.' });
  }

  try {
    const { error } = await supabase
      .from('comments')
      .delete()
      .in('id', ids);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Lỗi xóa hàng loạt bình luận:', err);
    res.status(500).json({ success: false, error: err.message || 'Lỗi hệ thống.' });
  }
});

// Khóa tài khoản người dùng
router.post('/users/:id/ban', async (req, res) => {
  const userId = req.params.id;
  try {
    const { error } = await supabase
      .from('users')
      .update({ is_banned: true })
      .eq('id', userId);

    if (error) throw error;
    res.redirect('/admin/comments?success=' + encodeURIComponent('Đã khóa tài khoản người dùng thành công!'));
  } catch (err) {
    console.error('Lỗi khóa tài khoản:', err);
    res.redirect('/admin/comments?error=' + encodeURIComponent(err.message || 'Lỗi hệ thống.'));
  }
});

// Mở khóa tài khoản người dùng
router.post('/users/:id/unban', async (req, res) => {
  const userId = req.params.id;
  try {
    const { error } = await supabase
      .from('users')
      .update({ is_banned: false })
      .eq('id', userId);

    if (error) throw error;
    res.redirect('/admin/comments?success=' + encodeURIComponent('Đã mở khóa tài khoản người dùng thành công!'));
  } catch (err) {
    console.error('Lỗi mở khóa tài khoản:', err);
    res.redirect('/admin/comments?error=' + encodeURIComponent(err.message || 'Lỗi hệ thống.'));
  }
});

// ==================== QUẢN LÝ CỬA HÀNG EXP (SHOP ITEMS) ====================
// Trang danh sách vật phẩm shop
router.get('/shop', async (req, res) => {
  try {
    const { data: items, error } = await supabase
      .from('shop_items')
      .select('*')
      .order('type', { ascending: true })
      .order('price_exp', { ascending: true });

    if (error) throw error;

    res.render('admin/shop', {
      title: 'Quản lý Cửa hàng EXP',
      user: req.user,
      items: items || [],
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Lỗi lấy danh sách shop items:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// Thêm vật phẩm shop mới
router.post('/shop/add', upload.single('avatar_file'), async (req, res) => {
  const { name, type, price_exp, description, value_text } = req.body;
  const price = parseInt(price_exp);

  if (!name || !type || isNaN(price)) {
    return res.redirect('/admin/shop?error=' + encodeURIComponent('Thông tin nhập vào không hợp lệ.'));
  }

  try {
    let value = '';
    if (type === 'avatar') {
      if (req.file) {
        value = await uploadToSupabase(req.file, 'uploads');
      } else {
        value = '/css/silly_duck.png'; // default
      }
    } else {
      value = value_text ? value_text.trim() : '';
    }

    const { error } = await supabase
      .from('shop_items')
      .insert([{
        name: name.trim(),
        type,
        price_exp: price,
        description: description ? description.trim() : '',
        value: value
      }]);

    if (error) throw error;
    res.redirect('/admin/shop?success=' + encodeURIComponent('Đã thêm vật phẩm vào cửa hàng thành công!'));
  } catch (err) {
    console.error('Lỗi thêm vật phẩm shop:', err);
    res.redirect('/admin/shop?error=' + encodeURIComponent(err.message || 'Lỗi hệ thống.'));
  }
});

// Sửa vật phẩm shop
router.post('/shop/edit/:id', upload.single('avatar_file'), async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, type, price_exp, description, value_text } = req.body;
  const price = parseInt(price_exp);

  if (!name || !type || isNaN(price)) {
    return res.redirect('/admin/shop?error=' + encodeURIComponent('Thông tin nhập vào không hợp lệ.'));
  }

  try {
    const { data: oldItem } = await supabase
      .from('shop_items')
      .select('*')
      .eq('id', id)
      .single();

    if (!oldItem) {
      return res.redirect('/admin/shop?error=' + encodeURIComponent('Vật phẩm không tồn tại.'));
    }

    let value = oldItem.value;
    if (type === 'avatar') {
      if (req.file) {
        value = await uploadToSupabase(req.file, 'uploads');
      }
    } else {
      value = value_text ? value_text.trim() : oldItem.value;
    }

    const { error } = await supabase
      .from('shop_items')
      .update({
        name: name.trim(),
        type,
        price_exp: price,
        description: description ? description.trim() : '',
        value: value
      })
      .eq('id', id);

    if (error) throw error;
    res.redirect('/admin/shop?success=' + encodeURIComponent('Đã cập nhật vật phẩm thành công!'));
  } catch (err) {
    console.error('Lỗi sửa vật phẩm shop:', err);
    res.redirect('/admin/shop?error=' + encodeURIComponent(err.message || 'Lỗi hệ thống.'));
  }
});

// Xóa vật phẩm shop
router.post('/shop/delete/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const { error } = await supabase
      .from('shop_items')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.redirect('/admin/shop?success=' + encodeURIComponent('Đã xóa vật phẩm khỏi cửa hàng thành công!'));
  } catch (err) {
    console.error('Lỗi xóa vật phẩm shop:', err);
    res.redirect('/admin/shop?error=' + encodeURIComponent(err.message || 'Lỗi hệ thống.'));
  }
});

// ==================== QUẢN LÝ THIẾT LẬP CẤP BẬC (RANK SETTINGS) ====================
// Trang danh sách thiết lập cấp bậc
router.get('/ranks', async (req, res) => {
  try {
    const { data: ranks, error } = await supabase
      .from('rank_settings')
      .select('*')
      .order('order_index', { ascending: true })
      .order('count', { ascending: true });

    if (error) throw error;

    res.render('admin/ranks', {
      title: 'Quản lý Thiết lập Ranks',
      user: req.user,
      ranks: ranks || [],
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) {
    console.error('Lỗi lấy danh sách ranks:', err);
    res.status(500).send('Lỗi hệ thống.');
  }
});

// Thêm thiết lập cấp bậc mới
router.post('/ranks/add', async (req, res) => {
  const { count, label, badge, order_index } = req.body;
  const chapterCount = parseInt(count);
  const orderIndex = parseInt(order_index) || 0;

  if (isNaN(chapterCount) || !label || !badge) {
    return res.redirect('/admin/ranks?error=' + encodeURIComponent('Thông tin nhập vào không hợp lệ.'));
  }

  try {
    const { error } = await supabase
      .from('rank_settings')
      .insert([{ count: chapterCount, label: label.trim(), badge: badge.trim(), order_index: orderIndex }]);

    if (error) throw error;
    res.redirect('/admin/ranks?success=' + encodeURIComponent('Đã thêm Rank cấp bậc mới thành công!'));
  } catch (err) {
    console.error('Lỗi thêm rank:', err);
    res.redirect('/admin/ranks?error=' + encodeURIComponent(err.message || 'Lỗi hệ thống.'));
  }
});

// Sửa thiết lập cấp bậc
router.post('/ranks/edit/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { count, label, badge, order_index } = req.body;
  const chapterCount = parseInt(count);
  const orderIndex = parseInt(order_index) || 0;

  if (isNaN(chapterCount) || !label || !badge) {
    return res.redirect('/admin/ranks?error=' + encodeURIComponent('Thông tin nhập vào không hợp lệ.'));
  }

  try {
    const { error } = await supabase
      .from('rank_settings')
      .update({ count: chapterCount, label: label.trim(), badge: badge.trim(), order_index: orderIndex })
      .eq('id', id);

    if (error) throw error;
    res.redirect('/admin/ranks?success=' + encodeURIComponent('Đã cập nhật cấp bậc thành công!'));
  } catch (err) {
    console.error('Lỗi sửa rank:', err);
    res.redirect('/admin/ranks?error=' + encodeURIComponent(err.message || 'Lỗi hệ thống.'));
  }
});

// Xóa thiết lập cấp bậc
router.post('/ranks/delete/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const { error } = await supabase
      .from('rank_settings')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.redirect('/admin/ranks?success=' + encodeURIComponent('Đã xóa cấp bậc thành công!'));
  } catch (err) {
    console.error('Lỗi xóa rank:', err);
    res.redirect('/admin/ranks?error=' + encodeURIComponent(err.message || 'Lỗi hệ thống.'));
  }
});

// CHUYỂN HƯỚNG CÁC ĐƯỜNG DẪN CŨ VỀ ĐƯỜNG DẪN TÍCH HỢP MỚI
router.get('/chapter/add-manual', (req, res) => res.redirect('/admin/chapter/add'));
router.post('/chapter/add-manual', (req, res) => res.redirect('/admin/chapter/add'));
router.get('/chapter/add-bulk', (req, res) => res.redirect('/admin/chapter/add'));
router.post('/chapter/add-bulk', (req, res) => res.redirect('/admin/chapter/add'));

module.exports = router;


