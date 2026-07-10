// Test dịch thử chương 1 để kiểm tra chất lượng
const puppeteer = require('puppeteer');
const translate = require('google-translate-api-x');

const BASE_URL = 'https://wtr-lab.com/en/novel/56585/death-rewind-48-hours-to-save-the-world';
const DELAY_BETWEEN_PARAGRAPHS = 300;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function postProcessVietnamese(text) {
  let t = text;
  t = t.replace(/^[""](.+)[""]?$/gm, '— $1');
  t = t.replace(/"([^"]+)"/g, '«$1»');
  t = t.replace(/\u201c([^\u201d]+)\u201d/g, '«$1»');
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

async function translateParagraph(text, retries = 3) {
  if (!text || !text.trim()) return '';
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await translate(text, { to: 'vi', forceBatch: false });
      return postProcessVietnamese(res.text || text);
    } catch (err) {
      if (attempt < retries) await sleep(1000 * attempt);
      else return text;
    }
  }
}

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  const url = `${BASE_URL}/chapter-1?service=web`;
  
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  const result = await page.evaluate(() => {
    const container = document.querySelector('.reader-container');
    if (!container) return null;
    const fullText = container.innerText;
    const lines = fullText.split('\n');

    let startIdx = -1;
    let chapterTitle = '';
    let found = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      const m = l.match(/^(?:#\d+)?\s*Chapter\s+1\b(.*)/i);
      if (m) {
        found++;
        if (found === 1) { chapterTitle = l.replace(/^#\d+/, '').trim(); startIdx = i; }
        else { startIdx = i + 1; break; }
      }
    }
    if (startIdx === -1) return null;

    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (l.startsWith('Report it here') || l.startsWith('Prev') || l.match(/^Ch\.\s*\d+\s*\/\s*\d+/) || l.startsWith('Web') || l.startsWith('AI')) {
        endIdx = i; break;
      }
    }
    const contentLines = lines.slice(startIdx + 1, endIdx).map(l => l.trim()).filter(l => l.length > 0);
    return { chapterTitle, contentLines };
  });

  await browser.close();

  if (!result) { console.log('Không lấy được nội dung!'); return; }

  console.log('=== TIÊU ĐỀ GỐC ===');
  console.log(result.chapterTitle);
  console.log(`\n=== ${result.contentLines.length} ĐOẠN GỐC (5 đoạn đầu) ===`);
  result.contentLines.slice(0, 5).forEach((l, i) => console.log(`[${i+1}] ${l}`));

  console.log('\n=== ĐANG DỊCH (5 đoạn đầu) ===');
  const translated = [];
  for (let i = 0; i < Math.min(5, result.contentLines.length); i++) {
    const vi = await translateParagraph(result.contentLines[i]);
    translated.push(vi);
    console.log(`[${i+1}] ${vi}`);
    await sleep(DELAY_BETWEEN_PARAGRAPHS);
  }
  
  console.log('\n=== PREVIEW HTML ===');
  translated.forEach(p => {
    if (p.startsWith('—')) console.log(`<p class="dialogue">${p}</p>`);
    else console.log(`<p>${p}</p>`);
  });
}

run().catch(console.error);
