const fs = require('fs');
const path = require('path');
const { ZipArchive } = require('archiver');

async function pack() {
  const tempDir = path.resolve('C:/Users/Kien/.gemini/antigravity/scratch/truyen/temp_epub_vo_toi_nhiem_nhiem');
  const oebpsDir = path.join(tempDir, 'OEBPS');
  const metaInfDir = path.join(tempDir, 'META-INF');
  const outputPath = 'C:/Users/Kien/Downloads/Vo_Toi_Nhiem_Nhiem_Full_Anh.epub';

  console.log('Bắt đầu đóng gói EPUB từ:', tempDir);
  console.log('File đầu ra:', outputPath);

  const t0 = Date.now();
  const outputStream = fs.createWriteStream(outputPath);
  const archive = new ZipArchive({
    zlib: { level: 9 }
  });

  await new Promise((resolve, reject) => {
    outputStream.on('close', resolve);
    outputStream.on('error', reject);
    archive.on('error', reject);

    archive.pipe(outputStream);

    // 1st entry MUST be mimetype uncompressed
    archive.append('application/epub+zip', { name: 'mimetype', store: true });

    // Add META-INF directory
    archive.directory(metaInfDir, 'META-INF');

    // Add OEBPS directory
    archive.directory(oebpsDir, 'OEBPS');

    archive.finalize();
  });

  const stats = fs.statSync(outputPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  const dur = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`✅ HOÀN TẤT ĐÓNG GÓI EPUB THÀNH CÔNG!`);
  console.log(`- File đã lưu: ${outputPath}`);
  console.log(`- Dung lượng: ${sizeMB} MB`);
  console.log(`- Thời gian đóng gói: ${dur}s`);

  // Clean up
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
    console.log('Đã dọn dẹp thư mục tạm.');
  } catch (err) {
    console.warn('Lỗi dọn dẹp thư mục tạm:', err.message);
  }
}

pack().catch(err => {
  console.error('LỖI ĐÓNG GÓI:', err);
  process.exit(1);
});
