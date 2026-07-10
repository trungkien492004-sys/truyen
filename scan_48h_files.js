const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');

const dirPath = 'C:/Users/Kien/OneDrive/Tài liệu';

async function scanFile(filePath) {
  try {
    const result = await mammoth.convertToHtml({ path: filePath });
    const html = result.value;
    
    // Regex tìm số chương
    const regex = /Chương\s*(\d+)/gi;
    let match;
    let chaps = [];
    while ((match = regex.exec(html)) !== null) {
      const num = parseInt(match[1]);
      if (!chaps.includes(num)) {
        chaps.push(num);
      }
    }
    
    if (chaps.length > 0) {
      chaps.sort((a, b) => a - b);
      return {
        file: path.basename(filePath),
        min: chaps[0],
        max: chaps[chaps.length - 1],
        count: chaps.length,
        chaps: chaps
      };
    }
  } catch (err) {
    // Ignore error
  }
  return null;
}

async function run() {
  if (!fs.existsSync(dirPath)) {
    console.error("Thư mục tài liệu không tồn tại.");
    return;
  }
  const files = fs.readdirSync(dirPath).filter(f => f.toLowerCase().startsWith('48h') && f.toLowerCase().endsWith('.docx'));
  console.log(`Tìm thấy ${files.length} file docx dạng 48h.`);
  
  let results = [];
  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const info = await scanFile(filePath);
    if (info) {
      results.push(info);
    }
  }
  
  results.sort((a, b) => a.min - b.min);
  console.log("\nKết quả quét các file:");
  results.forEach(r => {
    console.log(`- File: ${r.file} (Chương ${r.min} -> ${r.max}, tổng cộng ${r.count} chương)`);
  });
}
run();
