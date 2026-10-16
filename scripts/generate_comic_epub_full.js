const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const supabase = require('../config/supabase');

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function fetchWithRetry(url, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return buf;
    } catch (err) {
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}

async function main() {
  const startTime = Date.now();
  console.log('--- BẮT ĐẦU TẠO EPUB FULL ẢNH: VỢ TÔI NHIỄM NHIỄM ---');

  // 1. Fetch story info
  const { data: story, error: storyErr } = await supabase
    .from('stories')
    .select('*')
    .eq('id', 17)
    .single();

  if (storyErr || !story) {
    throw new Error('Không tìm thấy truyện ID 17: ' + (storyErr?.message || ''));
  }
  console.log(`Đã lấy thông tin truyện: "${story.title}"`);

  // 2. Fetch all chapters
  let chapters = [];
  let page = 0;
  const limit = 1000;
  while (true) {
    const { data: batch, error: batchErr } = await supabase
      .from('chapters')
      .select('id, chapter_number, title, content')
      .eq('story_id', 17)
      .order('chapter_number', { ascending: true })
      .range(page * limit, (page + 1) * limit - 1);

    if (batchErr) throw batchErr;
    if (!batch || batch.length === 0) break;
    chapters = chapters.concat(batch);
    if (batch.length < limit) break;
    page++;
  }
  console.log(`Đã tải dữ liệu ${chapters.length} chương từ database.`);

  // 3. Scan all image URLs
  const urlToLocalMap = new Map();
  let imageCounter = 0;

  // Add cover if exists
  let coverFilename = null;
  if (story.cover_url && story.cover_url.startsWith('http')) {
    const ext = story.cover_url.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
    coverFilename = `cover.${ext}`;
    urlToLocalMap.set(story.cover_url, {
      filename: coverFilename,
      mediaType: ext === 'png' ? 'image/png' : 'image/jpeg',
      isCover: true
    });
  }

  // Scan chapter contents
  for (const ch of chapters) {
    const matches = [...(ch.content || '').matchAll(/src=["']([^"']+)["']/g)];
    for (const m of matches) {
      const url = m[1];
      if (!urlToLocalMap.has(url)) {
        imageCounter++;
        const ext = url.toLowerCase().includes('.png') ? 'png' : 
                    url.toLowerCase().includes('.webp') ? 'webp' : 'jpg';
        const filename = `img_${String(imageCounter).padStart(5, '0')}.${ext}`;
        const mediaType = ext === 'png' ? 'image/png' : 
                          ext === 'webp' ? 'image/webp' : 'image/jpeg';
        urlToLocalMap.set(url, { filename, mediaType, isCover: false });
      }
    }
  }

  const totalImages = urlToLocalMap.size;
  console.log(`Tổng cộng có ${totalImages} hình ảnh cần tải về.`);

  // 4. Setup temporary directory
  const tempDir = path.resolve(__dirname, '../temp_epub_vo_toi_nhiem_nhiem');
  const oebpsDir = path.join(tempDir, 'OEBPS');
  const imgDir = path.join(oebpsDir, 'images');
  const metaInfDir = path.join(tempDir, 'META-INF');

  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(imgDir, { recursive: true });
  fs.mkdirSync(metaInfDir, { recursive: true });

  // 5. Download all images concurrently
  console.log('Bắt đầu tải toàn bộ ảnh (40 luồng đồng thời)...');
  const urlEntries = Array.from(urlToLocalMap.entries());
  let completedImages = 0;
  let failedImages = 0;
  let nextIdx = 0;
  const CONCURRENCY = 40;

  async function downloadWorker() {
    while (nextIdx < urlEntries.length) {
      const idx = nextIdx++;
      const [url, info] = urlEntries[idx];
      const destPath = path.join(imgDir, info.filename);
      try {
        const buf = await fetchWithRetry(url, 3);
        fs.writeFileSync(destPath, buf);
        completedImages++;
        if (completedImages % 200 === 0 || completedImages === totalImages) {
          const percent = ((completedImages / totalImages) * 100).toFixed(1);
          console.log(`[Tải ảnh] ${completedImages}/${totalImages} (${percent}%) - Đang chạy...`);
        }
      } catch (err) {
        failedImages++;
        console.error(`Lỗi tải ảnh [${info.filename}]:`, err.message);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => downloadWorker()));
  console.log(`Đã tải xong ảnh: ${completedImages} thành công, ${failedImages} lỗi.`);

  // 6. Build META-INF/container.xml
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
    </rootfiles>
</container>`;
  fs.writeFileSync(path.join(metaInfDir, 'container.xml'), containerXml, 'utf8');

  // 7. Build OEBPS/toc.ncx
  let tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <head>
        <meta name="dtb:uid" content="urn:uuid:${story.id}"/>
        <meta name="dtb:depth" content="1"/>
        <meta name="dtb:totalPageCount" content="0"/>
        <meta name="dtb:maxPageNumber" content="0"/>
    </head>
    <docTitle>
        <text>${escapeXml(story.title)}</text>
    </docTitle>
    <navMap>`;

  chapters.forEach((ch, idx) => {
    const chapTitle = ch.title || `Chương ${ch.chapter_number}`;
    tocNcx += `
        <navPoint id="navPoint-${idx + 1}" playOrder="${idx + 1}">
            <navLabel>
                <text>${escapeXml(chapTitle)}</text>
            </navLabel>
            <content src="chapter-${idx + 1}.xhtml"/>
        </navPoint>`;
  });

  tocNcx += `
    </navMap>
</ncx>`;
  fs.writeFileSync(path.join(oebpsDir, 'toc.ncx'), tocNcx, 'utf8');

  // 8. Build chapter XHTML files with replaced local image paths
  console.log('Tạo các trang chương XHTML...');
  chapters.forEach((ch, idx) => {
    let cleanContent = ch.content || '';

    // Replace all remote img src with local relative images/img_XXX.png
    cleanContent = cleanContent.replace(/<img\b([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi, (match, before, srcUrl, after) => {
      const localInfo = urlToLocalMap.get(srcUrl);
      const localSrc = localInfo ? `images/${localInfo.filename}` : srcUrl;
      return `<img${before}src="${localSrc}"${after} />`;
    });

    // Ensure self-closing tags
    cleanContent = cleanContent.replace(/<img\b([^>]*?)(?<!\/)>/gi, '<img$1 />');
    cleanContent = cleanContent.replace(/<br\b([^>]*?)(?<!\/)>/gi, '<br$1 />');
    cleanContent = cleanContent.replace(/<hr\b([^>]*?)(?<!\/)>/gi, '<hr$1 />');
    cleanContent = cleanContent.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');

    const chapterTitle = ch.title || `Chương ${ch.chapter_number}`;
    const chapterXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>${escapeXml(chapterTitle)}</title>
    <style type="text/css">
        body { font-family: sans-serif; line-height: 1.6; padding: 2%; margin: 0; background-color: #111; color: #eee; }
        h2 { text-align: center; margin: 1.5em 0; color: #f39c12; }
        p { margin-bottom: 0.8em; text-indent: 1em; }
        img { max-width: 100%; height: auto; display: block; margin: 8px auto; border-radius: 4px; }
    </style>
</head>
<body>
    <h2>${escapeXml(chapterTitle)}</h2>
    ${cleanContent}
</body>
</html>`;

    fs.writeFileSync(path.join(oebpsDir, `chapter-${idx + 1}.xhtml`), chapterXhtml, 'utf8');
  });

  // 9. Cover page
  let hasCoverPage = false;
  if (coverFilename && fs.existsSync(path.join(imgDir, coverFilename))) {
    hasCoverPage = true;
    const coverXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>Bìa sách</title>
    <style type="text/css">
        body { margin: 0; padding: 0; text-align: center; background-color: #000; }
        img { max-width: 100%; max-height: 100vh; height: auto; }
    </style>
</head>
<body>
    <div>
        <img src="images/${coverFilename}" alt="Bìa sách" />
    </div>
</body>
</html>`;
    fs.writeFileSync(path.join(oebpsDir, 'cover.xhtml'), coverXhtml, 'utf8');
  }

  // 10. Build OEBPS/content.opf
  let contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="2.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
        <dc:title>${escapeXml(story.title)}</dc:title>
        <dc:creator opf:role="aut">${escapeXml(story.author || 'Ẩn danh')}</dc:creator>
        <dc:language>vi</dc:language>
        <dc:identifier id="BookID" opf:scheme="UUID">urn:uuid:${story.id}</dc:identifier>
        ${hasCoverPage ? '<meta name="cover" content="cover-image"/>' : ''}
    </metadata>
    <manifest>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`;

  if (hasCoverPage) {
    const ext = coverFilename.endsWith('.png') ? 'png' : 'jpg';
    const type = ext === 'png' ? 'image/png' : 'image/jpeg';
    contentOpf += `
        <item id="cover-image" href="images/${coverFilename}" media-type="${type}"/>
        <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>`;
  }

  // Add all downloaded image files to manifest
  for (const [_, info] of urlToLocalMap.entries()) {
    if (info.isCover) continue;
    const filePath = path.join(imgDir, info.filename);
    if (fs.existsSync(filePath)) {
      contentOpf += `
        <item id="img-${info.filename.replace(/[^a-zA-Z0-9_-]/g, '_')}" href="images/${info.filename}" media-type="${info.mediaType}"/>`;
    }
  }

  // Add chapter files to manifest
  chapters.forEach((ch, idx) => {
    contentOpf += `
        <item id="chapter-${idx + 1}" href="chapter-${idx + 1}.xhtml" media-type="application/xhtml+xml"/>`;
  });

  contentOpf += `
    </manifest>
    <spine toc="ncx">
        ${hasCoverPage ? '<itemref idref="cover-page"/>' : ''}`;

  chapters.forEach((ch, idx) => {
    contentOpf += `
        <itemref idref="chapter-${idx + 1}"/>`;
  });

  contentOpf += `
    </spine>
</package>`;

  fs.writeFileSync(path.join(oebpsDir, 'content.opf'), contentOpf, 'utf8');

  // 11. Stream into EPUB ZIP file
  const outputPath = 'C:/Users/Kien/Downloads/Vo_Toi_Nhiem_Nhiem_Full_Anh.epub';
  console.log(`Đang nén và ghi file EPUB vào: ${outputPath}...`);

  const outputStream = fs.createWriteStream(outputPath);
  const archive = archiver('zip', {
    zlib: { level: 9 }
  });

  await new Promise((resolve, reject) => {
    outputStream.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(outputStream);

    // 1st entry MUST be mimetype with store: true
    archive.append('application/epub+zip', { name: 'mimetype', store: true });

    // Add META-INF
    archive.directory(metaInfDir, 'META-INF');

    // Add OEBPS
    archive.directory(oebpsDir, 'OEBPS');

    archive.finalize();
  });

  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  const totalDur = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`✅ HOÀN TẤT TẠO EPUB THÀNH CÔNG!`);
  console.log(`- File đã lưu: ${outputPath}`);
  console.log(`- Dung lượng: ${sizeMB} MB`);
  console.log(`- Tổng thời gian: ${totalDur} giây`);

  // Clean up temp directory
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('Đã dọn dẹp thư mục tạm.');
  } catch (e) {
    console.warn('Lỗi dọn dẹp thư mục tạm:', e.message);
  }
}

main().catch(err => {
  console.error('LỖI:', err);
  process.exit(1);
});
