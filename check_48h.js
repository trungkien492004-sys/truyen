const fs = require('fs');
const mammoth = require('mammoth');

const filePath = 'C:/Users/Kien/OneDrive/Tài liệu/48h.docx';

async function run() {
  if (!fs.existsSync(filePath)) {
    console.error("Không tìm thấy file 48h.docx");
    return;
  }
  const result = await mammoth.convertToHtml({ path: filePath });
  const html = result.value;
  console.log("Độ dài HTML 48h.docx:", html.length);
  console.log("Snippet đầu tiên:");
  console.log(html.substring(0, 1000));
}
run();
