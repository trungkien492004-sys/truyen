const AdmZip = require('adm-zip');

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function generateEpub(story, chapters) {
  const zip = new AdmZip();

  // 1. mimetype (bắt buộc phải là file đầu tiên, không nén - method = 0)
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
  zip.addFile('OEBPS/toc.ncx', Buffer.from(tocNcx));

  // Manifest items
  const manifestItems = [
    { id: 'ncx', href: 'toc.ncx', type: 'application/x-dtbncx+xml' }
  ];

  // Tải và nhúng ảnh bìa (chỉ fetch duy nhất ảnh bìa với timeout 3s để không nghẽn/timeout Vercel)
  let hasCoverImage = false;
  let coverFilename = 'cover.jpg';
  let coverType = 'image/jpeg';
  if (story.cover_url && story.cover_url.startsWith('http')) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const coverRes = await fetch(story.cover_url, { signal: controller.signal });
      clearTimeout(timeout);
      if (coverRes.ok) {
        const coverBuf = Buffer.from(await coverRes.arrayBuffer());
        const ext = story.cover_url.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
        coverFilename = `cover.${ext}`;
        coverType = ext === 'png' ? 'image/png' : 'image/jpeg';
        zip.addFile(`OEBPS/images/${coverFilename}`, coverBuf);
        manifestItems.push({ id: 'cover-image', href: `images/${coverFilename}`, type: coverType });
        hasCoverImage = true;
      }
    } catch (e) {
      console.warn('Bỏ qua nhúng ảnh bìa EPUB do lỗi tải:', e.message);
    }
  }

  // Trang bìa XHTML nếu có ảnh bìa
  if (hasCoverImage) {
    const coverXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>Bìa sách</title>
    <style type="text/css">
        body { margin: 0; padding: 0; text-align: center; }
        img { max-width: 100%; height: auto; }
    </style>
</head>
<body>
    <div>
        <img src="images/${coverFilename}" alt="Bìa sách" />
    </div>
</body>
</html>`;
    zip.addFile('OEBPS/cover.xhtml', Buffer.from(coverXhtml));
    manifestItems.push({ id: 'cover-page', href: 'cover.xhtml', type: 'application/xhtml+xml' });
  }

  // Khai báo các file chương trong manifest
  chapters.forEach((ch, idx) => {
    manifestItems.push({
      id: `chapter-${idx + 1}`,
      href: `chapter-${idx + 1}.xhtml`,
      type: 'application/xhtml+xml'
    });
  });

  // 4. Content.opf (Khai báo manifest & spine thứ tự chương)
  let contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="2.0">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
        <dc:title>${escapeXml(story.title)}</dc:title>
        <dc:creator opf:role="aut">${escapeXml(story.author || 'Ẩn danh')}</dc:creator>
        <dc:language>vi</dc:language>
        <dc:identifier id="BookID" opf:scheme="UUID">urn:uuid:${story.id}</dc:identifier>
        ${hasCoverImage ? '<meta name="cover" content="cover-image"/>' : ''}
    </metadata>
    <manifest>`;

  manifestItems.forEach(item => {
    contentOpf += `
        <item id="${item.id}" href="${item.href}" media-type="${item.type}"/>`;
  });

  contentOpf += `
    </manifest>
    <spine toc="ncx">
        ${hasCoverImage ? '<itemref idref="cover-page"/>' : ''}`;

  chapters.forEach((ch, idx) => {
    contentOpf += `
        <itemref idref="chapter-${idx + 1}"/>`;
  });

  contentOpf += `
    </spine>
</package>`;
  zip.addFile('OEBPS/content.opf', Buffer.from(contentOpf));

  // 5. Nội dung các chương (XHTML tiêu chuẩn - tự động đóng thẻ img, br, hr và escape XML hợp lệ)
  chapters.forEach((ch, idx) => {
    let cleanContent = ch.content || '';
    // Đảm bảo các thẻ tự đóng hợp lệ trong XHTML (EPUB parser yêu cầu chuẩn XML)
    cleanContent = cleanContent.replace(/<img\b([^>]*?)(?<!\/)>/gi, '<img$1 />');
    cleanContent = cleanContent.replace(/<br\b([^>]*?)(?<!\/)>/gi, '<br$1 />');
    cleanContent = cleanContent.replace(/<hr\b([^>]*?)(?<!\/)>/gi, '<hr$1 />');
    
    // Thoát ký tự & đứng độc lập nếu không phải thực thể XML
    cleanContent = cleanContent.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');

    const chapterTitle = ch.title || `Chương ${ch.chapter_number}`;
    const xhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
    <title>${escapeXml(chapterTitle)}</title>
    <style type="text/css">
        body { font-family: sans-serif; line-height: 1.6; padding: 4%; }
        h2 { text-align: center; margin-bottom: 1.5em; }
        p { margin-bottom: 0.9em; text-indent: 1.2em; }
        img { max-width: 100%; height: auto; display: block; margin: 10px auto; }
    </style>
</head>
<body>
    <h2>${escapeXml(chapterTitle)}</h2>
    ${cleanContent}
</body>
</html>`;
    zip.addFile(`OEBPS/chapter-${idx + 1}.xhtml`, Buffer.from(xhtml));
  });

  return zip.toBuffer();
}

module.exports = {
  generateEpub,
  escapeXml
};
