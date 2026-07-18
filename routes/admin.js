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

// Hàm tự động định dạng text thuần sang HTML có thẻ <p> nếu chưa có
function formatContentToHtml(content) {
  if (!content) return '';
  if (/<p>|<br>|<div>/i.test(content)) {
    return content;
  }
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => `<p>${line}</p>`)
    .join('\n');
}

// Lấy TOÀN BỘ chapter_number hiện có của 1 truyện, phân trang lấy nhiều lần để không bị giới hạn
// mặc định 1000 dòng/query của Supabase/PostgREST (bug đã gặp: truyện >1000 chương bị đối chiếu
// trùng sai vì chỉ lấy được 1000 chương đầu, có nguy cơ upsert đè nhầm dữ liệu chương cũ).
async function getUserRank(chaptersCount, exp) {
    // Tính toán Rank (Hạng trên BXH Độc Giả)
    // Đếm song song: (1) người có chapters_read nhiều hơn, +
    //                  (2) người có chapters_read bằng nhưng exp cao hơn
    const [rankAbove, rankTied] = await Promise.all([
      supabase.from('leaderboard_by_exp').select('user_id', { count: 'exact', head: true }).gt('chapters_read', chaptersCount),
      supabase.from('leaderboard_by_exp').select('user_id', { count: 'exact', head: true }).eq('chapters_read', chaptersCount).gt('exp', exp)
    ]);
    const userRank = (rankAbove.count !== null && rankTied.count !== null)
      ? rankAbove.count + rankTied.count + 1
      : '-';
    return userRank;
}

async function getAllExistingChapterNumbers(storyId) {
  let all = [];
  const PAGE_SIZE = 1000;
  let from = 0;
  while (true) {
    const { data: pageData, error } = await supabase
      .from('chapters')
      .select('chapter_number')
      .eq('story_id', storyId)
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!pageData || pageData.length === 0) break;

    all = all.concat(pageData);
    if (pageData.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

// Lấy TOÀN BỘ chương (id + chapter_number) của 1 truyện, sắp theo chapter_number tăng dần -
// dùng chung cơ chế phân trang như getAllExistingChapterNumbers, cho các thao tác cần đủ cả id
// (ví dụ sắp xếp lại thứ tự chương khi admin đổi số thứ tự 1 chương cụ thể).
async function getAllChaptersWithId(storyId) {
  let all = [];
  const PAGE_SIZE = 1000;
  let from = 0;
  while (true) {
    const { data: pageData, error } = await supabase
      .from('chapters')
      .select('id, chapter_number')
      .eq('story_id', storyId)
      .order('chapter_number', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!pageData || pageData.length === 0) break;

    all = all.concat(pageData);
    if (pageData.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
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



// Hàm trích xuất toàn bộ text thô từ buffer PDF (dùng chung cho cả 2 luồng: tách nhiều chương và fallback 1 chương)
function extractPdfRawText(buffer) {
  return new Promise((resolve, reject) => {
    const pdfParser = new PDFParser(this, 1);

    pdfParser.on('pdfParser_dataError', errData => reject(errData.parserError || new Error('Không đọc được nội dung file PDF.')));
    pdfParser.on('pdfParser_dataReady', () => {
      try {
        // Loại bỏ dòng "---Page (N) Break---" do pdf2json tự sinh, VÀ dòng số trang in thật sự nằm sẵn
        // trong nội dung file PDF gốc (kiểu "Trang 8488" đứng riêng 1 dòng ở đầu/cuối mỗi trang) -
        // nếu không lọc, chữ "Trang XXXX" sẽ bị dính vào giữa câu văn khi các trang được nối lại.
        // Chỉ khớp khi "Trang"/"trang" + số đứng MỘT MÌNH trên dòng đó (không có chữ nào khác),
        // để không xóa nhầm câu văn có chứa từ "trang" (ví dụ "trang giấy", "trang bị").
        const rawText = pdfParser.getRawTextContent()
          .replace(/\r\n/g, '\n')
          .replace(/-{3,}Page \(\d+\) Break-{3,}/g, '')
          .replace(/^[ \t]*[Tt]rang\s*\.?\s*\d+[ \t]*$/gm, '');
        resolve(rawText);
      } catch (err) {
        reject(err);
      }
    });

    pdfParser.parseBuffer(buffer);
  });
}

// Regex tách chương KHÔNG YÊU CẦU tiêu đề đứng trọn 1 dòng riêng - nhận diện tại BẤT KỲ vị trí nào trong toàn văn bản.
// Lý do: nhiều PDF khi trích xuất text bị dính dòng (tiêu đề "Chương X" nằm liền sát đoạn văn trước/sau do ngắt trang
// hoặc do cấu trúc PDF không có xuống dòng thật), khiến regex kiểu ^...$ chỉ bắt được số ít chương "may mắn" đứng riêng dòng.
// Yêu cầu: phải có ranh giới từ (word boundary) hoặc đầu dòng/khoảng trắng trước từ khóa, để không bắt nhầm giữa từ khác.
const CHAPTER_SPLIT_PATTERN = '(?:^|[\\n\\r]|(?<=[.!?…”"）)\\]]\\s))\\s*(Chương|CHƯƠNG|Chap|CHAP|Chapter|CHAPTER|Phần|PHẦN|Part|PART)\\s*\\.?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:[:.\\-–,]\\s*)?([^\\n\\r]{0,80})?';

// Tách toàn văn bản thô thành nhiều chương dựa theo mọi vị trí khớp tiêu đề chương (không phụ thuộc ranh giới dòng)
function splitRawTextIntoChapters(rawText, storyId) {
  // Tạo instance regex riêng cho mỗi lần gọi (regex có cờ g giữ trạng thái lastIndex - dùng chung có thể lỗi khi chạy song song)
  const regex = new RegExp(CHAPTER_SPLIT_PATTERN, 'g');
  const matches = [];
  let m;
  while ((m = regex.exec(rawText)) !== null) {
    matches.push({ index: m.index, matchedText: m[0], num: parseFloat(m[2]), titleTail: (m[3] || '').trim() });
    if (m.index === regex.lastIndex) regex.lastIndex++; // tránh vòng lặp vô hạn với match rỗng
  }

  if (matches.length === 0) return [];

  const chapters = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const contentStart = cur.index + cur.matchedText.length;
    const contentEnd = next ? next.index : rawText.length;
    const rawContent = rawText.slice(contentStart, contentEnd);

    const chapNum = cur.num;
    // Tiêu đề phụ chỉ lấy nếu ngắn gọn và không phải đã là phần đầu của đoạn văn kế tiếp (tránh nuốt nhầm câu văn dài)
    const chapTitle = cur.titleTail && cur.titleTail.length <= 60 ? cur.titleTail : '';

    const contentHtml = rawContent
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
      .map(l => `<p>${l}</p>`)
      .join('');

    chapters.push({
      story_id: parseInt(storyId),
      chapter_number: chapNum,
      title: chapTitle ? `Chương ${chapNum}: ${chapTitle}` : `Chương ${chapNum}`,
      content: contentHtml
    });
  }

  return chapters;
}

// Hàm phân tích file PDF thành nhiều chương (tự động tách dựa theo "Chương X" / "Chapter X" ở bất kỳ vị trí nào trong văn bản)
async function parsePdfToChapters(buffer, storyId) {
  const rawText = await extractPdfRawText(buffer);
  const chapters = splitRawTextIntoChapters(rawText, storyId);
  return { chapters, rawText };
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
// Đếm xem văn bản thô có bao nhiêu tiêu đề chương khớp được (dùng để quyết định có nên tự tách nhiều chương hay không).
// Dùng chung 1 nguồn sự thật với splitRawTextIntoChapters (CHAPTER_SPLIT_PATTERN) để không bị lệch pha giữa "đếm" và "tách".
function countChapterHeaders(plainText) {
  let count = 0;
  const re = new RegExp(CHAPTER_SPLIT_PATTERN, 'g');
  let m;
  while ((m = re.exec(plainText)) !== null) {
    count++;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return count;
}

// Tách một khối text thô (Word/txt) thành nhiều chương - dùng chung logic với PDF (splitRawTextIntoChapters)
function splitPlainTextIntoChapters(plainText, storyId) {
  return splitRawTextIntoChapters(plainText, storyId);
}

// Hàm phân tích 1 tệp tin (Word/Txt): mặc định 1 file = 1 chương (dựa theo tên file),
// nhưng nếu bên trong file có TỪ 2 tiêu đề "Chương X" trở lên thì tự động tách thành nhiều chương riêng biệt.
async function parseSingleFileToChapter(file, storyId) {
  const isDocx = file.originalname.endsWith('.docx') || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const isEpub = file.originalname.toLowerCase().endsWith('.epub') || file.mimetype === 'application/epub+zip';
  let html = '';
  let plainText = '';

  if (isEpub) {
    try {
      const AdmZip = require('adm-zip');
      const cheerio = require('cheerio');
      const zip = new AdmZip(file.buffer);

      // Đọc container.xml → tìm content.opf
      const containerEntry = zip.getEntry('META-INF/container.xml');
      if (!containerEntry) throw new Error('EPUB thiếu META-INF/container.xml');
      const containerXml = containerEntry.getData().toString('utf8');
      const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);
      if (!opfPathMatch) throw new Error('Không tìm thấy content.opf');
      const opfPath = opfPathMatch[1];
      const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

      // Đọc content.opf → lấy manifest + spine
      const opfEntry = zip.getEntry(opfPath);
      if (!opfEntry) throw new Error('Không đọc được content.opf');
      const opfXml = opfEntry.getData().toString('utf8');
      const $opf = cheerio.load(opfXml, { xmlMode: true });
      const manifest = {};
      $opf('manifest item').each((i, el) => {
        const id = $opf(el).attr('id');
        const href = $opf(el).attr('href');
        if (id && href) manifest[id] = href;
      });
      const spineHrefs = [];
      $opf('spine itemref').each((i, el) => {
        const idref = $opf(el).attr('idref');
        if (manifest[idref]) spineHrefs.push(manifest[idref]);
      });

      const epubChapters = [];

      // Hàm tách 1 xhtml thành nhiều chương theo heading h1-h4 chứa "Chương X"
      function splitXhtmlByHeadings(xhtml, storyId) {
        const $ = cheerio.load(xhtml);
        $('script, style, nav').remove();

        // Tìm tất cả heading chứa "Chương X" (h1~h4)
        const chapterHeadings = $('h1, h2, h3, h4').filter((i, el) => {
          return /chương\s*\d+/i.test($(el).text());
        });

        if (chapterHeadings.length < 2) return []; // không đủ chương → dùng fallback

        const results = [];
        chapterHeadings.each((i, headingEl) => {
          const headingText = $(headingEl).text().trim();
          const chapNumMatch = headingText.match(/chương\s*(\d+(?:\.\d+)?)/i);
          const num = chapNumMatch ? parseFloat(chapNumMatch[1]) : null;
          const subtitle = headingText.replace(/chương\s*\d+(?:\.\d+)?[:\s\-–]*/i, '').trim();

          // Lấy tất cả sibling elements SAU heading này cho đến heading tiếp theo
          const contentNodes = [];
          let next = headingEl.next;
          while (next) {
            const isNextHeading = ['h1','h2','h3','h4'].includes(next.name)
              && /chương\s*\d+/i.test($(next).text());
            if (isNextHeading) break;
            if (next.type === 'tag') contentNodes.push($.html(next));
            next = next.next;
          }

          const content = contentNodes.join('') || `<p>(Nội dung chương ${num})</p>`;
          results.push({
            story_id: parseInt(storyId),
            chapter_number: num,
            title: subtitle || null,
            content
          });
        });
        return results;
      }

      for (const href of spineHrefs) {
        const fullHref = (opfDir + href).replace(/\\/g, '/');
        const entry = zip.getEntry(fullHref) || zip.getEntry(decodeURIComponent(fullHref));
        if (!entry) continue;
        const xhtml = entry.getData().toString('utf8');

        // Thử tách theo heading "Chương X" trong nội dung
        const splitResult = splitXhtmlByHeadings(xhtml, storyId);
        if (splitResult.length >= 2) {
          epubChapters.push(...splitResult);
          continue;
        }

        // Fallback: cả spine item = 1 chương
        const $fb = cheerio.load(xhtml);
        $fb('script, style, nav').remove();
        const bodyTextFb = $fb('body').text().replace(/\s+/g, ' ').trim();
        if (bodyTextFb.length < 20) continue;
        const chTitleFb = $fb('h1').first().text().trim() || $fb('h2').first().text().trim() || $fb('h3').first().text().trim() || '';
        const chapNumFb = chTitleFb.match(/chương\s*(\d+(?:\.\d+)?)/i);
        epubChapters.push({
          story_id: parseInt(storyId),
          chapter_number: chapNumFb ? parseFloat(chapNumFb[1]) : null,
          title: chTitleFb.replace(/chương\s*\d+(?:\.\d+)?[:\s\-–]*/i, '').trim() || null,
          content: $fb('body').html() || `<p>${bodyTextFb}</p>`
        });
      }

      if (epubChapters.length > 0) return epubChapters;
      // Nếu không tách được chương nào → fallback xuống bên dưới xử lý như txt
      plainText = '';
      html = '';
    } catch (epubErr) {
      console.error('Lỗi parse EPUB:', epubErr.message);
      plainText = '';
      html = '';
    }
    // Nếu fallback (không có chương nào)
    if (!plainText && !html) {
      return [{ story_id: parseInt(storyId), chapter_number: null, title: file.originalname, content: '<p>Không thể đọc nội dung EPUB.</p>' }];
    }

  } else if (isDocx) {
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

    const [htmlResult, textResult] = await Promise.all([
      mammoth.convertToHtml({ buffer: file.buffer }, options),
      mammoth.extractRawText({ buffer: file.buffer })
    ]);
    html = htmlResult.value;
    plainText = textResult.value;
  } else {
    plainText = file.buffer.toString('utf-8');
    html = plainText
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => `<p>${line}</p>`)
      .join('');
  }

  // Nếu phát hiện từ 2 tiêu đề "Chương X" trở lên bên trong nội dung -> tự động tách thành nhiều chương
  // (Lưu ý: chỉ áp dụng tách theo plainText - với .docx sẽ mất định dạng ảnh nhúng khi tách nhiều chương,
  // vì mammoth.extractRawText không giữ ảnh; nếu file có ảnh và nhiều chương, khuyến khích tách file trước khi upload)
  if (countChapterHeaders(plainText) >= 2) {
    const splitChapters = splitPlainTextIntoChapters(plainText, storyId);
    if (splitChapters.length >= 2) {
      return splitChapters;
    }
  }

  // Mặc định: 1 file = 1 chương -> Phân tích tên tệp tin để trích xuất số chương và tiêu đề chương
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
          chapter_number = parseFloat(standaloneNumMatch[1]);
        }
      }
    }
    // Thông minh: Giữ lại toàn bộ tên file gốc làm tiêu đề chương nếu không đúng định dạng 3 phần
    title = fileName;
  }

  return [{
    story_id: parseInt(storyId),
    chapter_number: chapter_number,
    title: title || null,
    content: html
  }];
}

// Middleware kiểm tra quyền Admin (admin hoặc sp_admin đều được vào)
function isAdmin(req, res, next) {
  if (req.isAuthenticated() && (req.user.role === 'admin' || req.user.role === 'sp_admin')) {
    return next();
  }
  res.status(403).send('Bị từ chối truy cập: Quyền quản trị viên yêu cầu.');
}

// Middleware chỉ dành riêng cho admin thực sự (không cho sp_admin)
function isFullAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.role === 'admin') {
    return next();
  }
  res.status(403).send('Bị từ chối truy cập: Tính năng này chỉ dành cho Admin cao cấp.');
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

    // Lấy danh sách truyện hiện có theo chương cập nhật gần nhất
    const { data: stories } = await supabase.from('stories_with_last_update').select('*').order('last_update_at', { ascending: false });

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

// TRẢ VỀ SỐ CHƯƠNG HIỆN CÓ CỦA 1 TRUYỆN (dùng cho tính năng "Đăng tiếp thông minh")
router.get('/chapter/count', async (req, res) => {
  const { story_id } = req.query;
  if (!story_id) return res.json({ count: 0 });
  try {
    const { count, error } = await supabase
      .from('chapters')
      .select('*', { count: 'exact', head: true })
      .eq('story_id', story_id);
    if (error) throw error;
    res.json({ count: count || 0 });
  } catch (err) {
    console.error('Lỗi đếm số chương:', err);
    res.json({ count: 0 });
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
        content: formatContentToHtml(content)
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

      // Quét từng file để tách chương (mặc định 1 file = 1 chương, tự tách nhiều chương nếu phát hiện nhiều tiêu đề "Chương X" bên trong file)
      for (const file of files) {
        const parsed = await parseSingleFileToChapter(file, story_id);
        chaptersToInsert.push(...parsed);
      }

      // Lấy tất cả số chương hiện có của bộ truyện này trong database để đối chiếu (đã phân trang, không giới hạn 1000)
      const existingChapters = await getAllExistingChapterNumbers(story_id);

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

    // Lấy tất cả số chương hiện có của bộ truyện này trong database để đối chiếu (đã phân trang, không giới hạn 1000)
    const existingChapters = await getAllExistingChapterNumbers(story_id);

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

    const { chapters: parsedChapters, rawText } = await parsePdfToChapters(req.file.buffer, story_id);
    let chapters = parsedChapters;

    if (!rawText || !rawText.trim()) {
      return res.json({ success: false, error: 'Không đọc được nội dung văn bản từ file PDF này (có thể là PDF dạng ảnh scan, chưa hỗ trợ OCR).' });
    }

    // Đã phân trang, không giới hạn 1000 chương
    const existingChapters = await getAllExistingChapterNumbers(story_id);

    const normalizedExisting = (existingChapters || [])
      .map(c => normalizeChapterNumber(c.chapter_number))
      .filter(Number.isFinite);
    const existingMaxChapter = normalizedExisting.length > 0
      ? Math.max(...normalizedExisting)
      : null;

    chapters = syncPdfChapterNumbers(chapters, existingMaxChapter);

    // Nếu PDF không có từ khóa chương nào được nhận diện -> đăng toàn bộ nội dung thành 1 chương duy nhất
    if (chapters.length === 0) {
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

    // Loại bỏ các chương bị trùng chapter_number trong CÙNG một lần upload (tránh lỗi upsert "ON CONFLICT DO UPDATE command cannot affect row a second time")
    const seenNumbers = new Set();
    chapters = chapters.filter(ch => {
      if (seenNumbers.has(ch.chapter_number)) return false;
      seenNumbers.add(ch.chapter_number);
      return true;
    });

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
    // Supabase/PostgREST giới hạn tối đa 1000 dòng mỗi query - với truyện có >1000 chương phải
    // phân trang lấy nhiều lần rồi gộp lại, nếu không danh sách chương ở trang sửa truyện (admin)
    // sẽ bị cắt cụt ở chương thứ 1000 (đã từng xảy ra và sửa ở trang công khai, giờ áp dụng thêm ở đây).
    let chapters = [];
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

        chapters = chapters.concat(pageData);
        if (pageData.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
    }

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

// THỰC HIỆN XÓA TRUYỆN (VÀ CÁC THÔNG TIN LIÊN QUAN CASCADE) - Cho phép Admin và SP Admin xóa
router.post('/story/delete/:id', isAdmin, async (req, res) => {
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
    const { error: updateContentErr } = await supabase.from('chapters').update({ title: newTitle, content: formatContentToHtml(content) }).eq('id', chapterId);
    if (updateContentErr) throw updateContentErr;

    // Nếu thay đổi số thứ tự chương, tiến hành sắp xếp lại
    if (currentChap.chapter_number !== targetChapterNumber) {
        // Lấy tất cả các chương, sắp xếp theo chapter_number (đã phân trang, không giới hạn 1000)
        const allChapters = await getAllChaptersWithId(currentChap.story_id);

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

// Hàm tự động đánh lại số chương liên tục từ 1, 2, 3... sau khi xóa chương
async function reorderChapters(storyId) {
  try {
    const { data: chapters, error } = await supabase
      .from('chapters')
      .select('id, chapter_number')
      .eq('story_id', storyId)
      .order('chapter_number', { ascending: true });

    if (error) {
      console.error('Lỗi khi lấy danh sách chương để sắp xếp lại:', error);
      return;
    }

    if (!chapters || chapters.length === 0) return;

    for (let i = 0; i < chapters.length; i++) {
      const expectedNumber = i + 1;
      if (chapters[i].chapter_number !== expectedNumber) {
        const { error: updateError } = await supabase
          .from('chapters')
          .update({ chapter_number: expectedNumber })
          .eq('id', chapters[i].id);
        
        if (updateError) {
          console.error(`Lỗi cập nhật số chương cho ID ${chapters[i].id}:`, updateError);
        }
      }
    }
  } catch (e) {
    console.error('Lỗi hệ thống trong reorderChapters:', e);
  }
}

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

    if (story_id) {
      await reorderChapters(parseInt(story_id));
    }

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
    // 1. Lấy story_id của chương truyện trước khi xóa
    const { data: chapter, error: getError } = await supabase
      .from('chapters')
      .select('story_id')
      .eq('id', chapterId)
      .single();

    if (getError || !chapter) {
      throw new Error('Không tìm thấy chương truyện cần xóa.');
    }

    const storyId = chapter.story_id;

    // 2. Thực hiện xóa chương truyện
    const { error: deleteError } = await supabase
      .from('chapters')
      .delete()
      .eq('id', chapterId);

    if (deleteError) throw deleteError;

    // 3. Tự động sắp xếp và đánh lại số chương liên tiếp
    await reorderChapters(storyId);

    res.redirect(`${redirectTo}?success=${encodeURIComponent('Đã xóa chương thành công và tự động đánh lại số chương liên tục!')}`);
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
// Hàm tự tạo cấu trúc file EPUB tiêu chuẩn từ dữ liệu truyện và chương truyện
function generateEpub(story, chapters) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();

  // 1. mimetype (không nén - compression method = 0)
  zip.addFile('mimetype', Buffer.from('application/epub+zip'), '', 0);

  // 2. META-INF/container.xml
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
    </rootfiles>
</container>`;
  zip.addFile('META-INF/container.xml', Buffer.from(containerXml));

  // 3. TOC.ncx (Mục lục cấu trúc)
  let tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <head>
        <meta name="dtb:uid" content="urn:uuid:${story.id}"/>
        <meta name="dtb:depth" content="1"/>
        <meta name="dtb:totalPageCount" content="0"/>
        <meta name="dtb:maxPageNumber" content="0"/>
    </head>
    <docTitle>
        <text>${story.title}</text>
    </docTitle>
    <navMap>`;

  chapters.forEach((ch, idx) => {
    tocNcx += `
        <navPoint id="navPoint-${idx + 1}" playOrder="${idx + 1}">
            <navLabel>
                <text>${ch.title}</text>
            </navLabel>
            <content src="chapter-${idx + 1}.xhtml"/>
        </navPoint>`;
  });

  tocNcx += `
    </navMap>
</ncx>`;
  zip.addFile('OEBPS/toc.ncx', Buffer.from(tocNcx));

  // 4. Content.opf (Khai báo manifest & spine thứ tự chương)
  let contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="2.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
        <dc:title>${story.title}</dc:title>
        <dc:creator opf:role="aut">${story.author || 'Ẩn danh'}</dc:creator>
        <dc:language>vi</dc:language>
        <dc:identifier id="BookID" opf:scheme="UUID">urn:uuid:${story.id}</dc:identifier>
    </metadata>
    <manifest>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`;

  chapters.forEach((ch, idx) => {
    contentOpf += `
        <item id="chapter-${idx + 1}" href="chapter-${idx + 1}.xhtml" media-type="application/xhtml+xml"/>`;
  });

  contentOpf += `
    </manifest>
    <spine toc="ncx">`;

  chapters.forEach((ch, idx) => {
    contentOpf += `
        <itemref idref="chapter-${idx + 1}"/>`;
  });

  contentOpf += `
    </spine>
</package>`;
  zip.addFile('OEBPS/content.opf', Buffer.from(contentOpf));

  // 5. Nội dung các chương (XHTML tiêu chuẩn)
  chapters.forEach((ch, idx) => {
    const content = ch.content || '';
    const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>${ch.title}</title>
</head>
<body>
    <h2>${ch.title}</h2>
    ${content}
</body>
</html>`;
    zip.addFile(`OEBPS/chapter-${idx + 1}.xhtml`, Buffer.from(xhtml));
  });

  return zip.toBuffer();
}

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

    // Lấy toàn bộ chương truyện bằng phân trang tránh giới hạn 1000 hàng của Supabase
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

    const epubBuffer = generateEpub(story, chapters);
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

module.exports = router;


