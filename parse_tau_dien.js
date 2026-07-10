const mammoth = require('mammoth');
const fs = require('fs');

async function run() {
  const file1 = 'C:/Users/Kien/OneDrive/Tài liệu/Tàu điện hậu cung chuong 1-5.docx';
  
  try {
    const result = await mammoth.convertToHtml({ path: file1 });
    console.log("HTML Start:\\n", result.value.substring(0, 2000));
  } catch (err) {
    console.error("Error reading file1:", err);
  }
}

run();
