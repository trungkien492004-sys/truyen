const puppeteer = require('puppeteer');
const translate = require('google-translate-api-x');
const supabase = require('./config/supabase');

const STORY_ID = 11;
const TOTAL_CHAPTERS = 442;
const BASE_URL = 'https://wtr-lab.com/en/novel/56585/death-rewind-48-hours-to-save-the-world';
const DELAY_BETWEEN_CHAPTERS = 1500; // 1.5s giữa các chương
const DELAY_BETWEEN_PARAGRAPHS = 400; // 400ms giữa các batch

// ══════════════════════════════════════════════════════════════
//  HÀM TRỢ GIÚP
// ══════════════════════════════════════════════════════════════

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Bảng dịch tên nhân vật chính sang thuần Việt nhất quán
const NAME_MAP = {
  'Wang Cong': 'Vương Thông',
  'Wang Cong\'s': 'Vương Thông',
  'Zhu Jun': 'Chu Tuấn',
  'Qin Feng': 'Tần Phong',
  'Theodore': 'Theodore',
  'Wangcong': 'Vương Thông',
  'Chu Tuân': 'Chu Tuấn',
  'Vương Công': 'Vương Thông',
  'Vương Tông': 'Vương Thông',
  'Thư Quân': 'Chu Tuấn',
  'Tần Phong Đức': 'Tần Phong',
};

// Hậu xử lý văn bản dịch sang tiếng Việt cho tự nhiên, dễ đọc
function postProcessVietnamese(text) {
  let t = text;

  // 1. Sửa tên nhân vật nhất quán
  for (const [from, to] of Object.entries(NAME_MAP)) {
    t = t.replace(new RegExp(from, 'g'), to);
  }

  // 2. Sửa đại từ nhân xưng: Google Translate hay nhầm "tôi" khi nên là "anh/cậu"
  // Giữ nguyên "tôi" nếu đó là lời thoại (có — đầu dòng), còn văn tường thuật thì đổi
  if (!t.trim().startsWith('—') && !t.trim().startsWith('–')) {
    // Sửa "cơ thể tôi" → "cơ thể anh" (nghiễm chủ / nghiễm nử)
    t = t.replace(/\bcơ thể tôi\b/gi, 'cơ thể anh');
    t = t.replace(/\bmắt tôi\b/gi, 'mắt anh');
    t = t.replace(/\btiếp theo tôi\b/gi, 'tiếp theo anh');
    // Kiểm tra xách hướng: câu bắt đầu = "tôi" + động từ — khó xử lý túng quát, bỏ qua
  }

  // 3. Lời thoại: "..." → — ... (xử lý đầu dòng bắt đầu — hoặc ")
  t = t.replace(/^["\u201c\u201d\u2018\u2019](.+)["\u201c\u201d\u2018\u2019]\s*$/m, '— $1');
  // Xóa dấu ” thừa sau khi đã thêm —
  t = t.replace(/^(— .+)["\u201c\u201d]\s*$/m, '$1');

  // 4. Trích dẫn trong câu: "..." → «...»
  t = t.replace(/[\u201c\u201d"]([^\u201c\u201d"\n]+)[\u201c\u201d"]/g, '«$1»');

  // 5. Loại bỏ số thứ tự đầu dòng nếu Google Translate giữ lại [N]
  t = t.replace(/^\[\d+\]\s*/m, '');

  // 6. Một số cụm cứng của machine translation → viết lại mềm hơn
  t = t.replace(/\bhắn ta\b/g, 'anh');
  t = t.replace(/\bđương sự\b/g, 'đượng sự');
  t = t.replace(/\bđối phương\b/g, 'đối diện');
  t = t.replace(/\bđối phương đó\b/g, 'người đó');
  t = t.replace(/\bxách hướng\.?\b/g, ''); // loại bỏ artifact
  t = t.replace(/\bno\b/gi, 'không'); // translate residue

  // 7. Chuẩn hoá khoảng trắng
  t = t.replace(/[ \t]{2,}/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n');

  return t.trim();
}

// Tách văn bản thành danh sách đoạn logic
function splitIntoParagraphs(rawText) {
  return rawText
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
}

// Dịch batch bằng format đánh số [N] — giúp Google Translate không dịch separator
const BATCH_SIZE = 8;

async function translateBatch(paragraphs, retries = 3) {
  if (!paragraphs || paragraphs.length === 0) return [];

  // Đánh số từng đoạn: [1] text1\n[2] text2...
  const numbered = paragraphs
    .map((p, i) => `[${i + 1}] ${p}`)
    .join('\n');

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await translate(numbered, { to: 'vi', forceBatch: false });
      const rawOutput = res.text || '';

      // Phân tích output theo pattern [N] ... 
      const result = [];
      for (let i = 0; i < paragraphs.length; i++) {
        const n = i + 1;
        // Tìm [n] ... cho đến [n+1] hoặc hết chuỗi
        const startRe = new RegExp(`\\[${n}\\]\\s*`);
        const endRe   = new RegExp(`\\[${n + 1}\\]`);
        const startM  = rawOutput.match(startRe);
        if (!startM) { result.push(paragraphs[i]); continue; }
        const startPos = rawOutput.indexOf(startM[0]) + startM[0].length;
        const endM    = rawOutput.match(endRe);
        const endPos  = endM ? rawOutput.indexOf(endM[0]) : rawOutput.length;
        const extracted = rawOutput.slice(startPos, endPos).trim();
        result.push(postProcessVietnamese(extracted));
      }

      // Kiểm tra đã lấy đủ số đoạn hay chưa
      if (result.length === paragraphs.length && result.every(p => p.length > 0)) {
        return result;
      }

      // Fallback: tách theo \n và lấy những dòng có nội dung
      const lines = rawOutput.split('\n')
        .map(l => l.replace(/^\[\d+\]\s*/, '').trim())
        .filter(l => l.length > 0)
        .map(l => postProcessVietnamese(l));
      return lines.length > 0 ? lines : paragraphs;

    } catch (err) {
      if (attempt < retries) await sleep(1500 * attempt);
      else return paragraphs;
    }
  }
  return paragraphs;
}

// Định dạng nội dung thành HTML đẹp để đọc
function buildHtmlContent(titleVi, paragraphs) {
  // Danh sách dòng nhiễu UI cần lọc bỏ (tiếng Anh và tiếng Việt sau dịch)
  const UI_NOISE = [
    /^qu[aả]ng c[aá]o/i,       // Quảng cáo có vấn đề?
    /^ads?\s*(have|has|problem|issue)/i, // Ads have problem?
    /^báo cáo/i,               // Báo cáo ở đây
    /^report/i,                // Report it here
    /^prev(ious)?$/i,
    /^next$/i,
    /^web\+?$/i,
    /^ai$/i,
    /^ch\.?\s*\d+\s*\/\s*\d+/i,
    /^\d+\.\d+%$/,
    /^(contents|novel|edit terms|add to library|read|display|speech|settings|more)$/i,
  ];

  const htmlParas = paragraphs
    .filter(p => p && p.trim().length > 0)
    .filter(p => !UI_NOISE.some(re => re.test(p.trim()))) // lọc nhiễu UI
    .map(p => {
      const clean = p.trim();

      // [[Time Marker]] hoặc 【Tháng X】 → dấu phân cảnh thời gian đẹp
      const timeMatch = clean.match(/^\[\[(.+?)\]\]$/) || clean.match(/^\u3010(.+?)\u3011$/);
      if (timeMatch) {
        const label = timeMatch[1].trim();
        return `<div class="scene-break"><span>✦ ${label} ✦</span></div>`;
      }

      // Dấu phân cảnh trống ***, ---, ...
      if (/^[\*\-\.]{3,}$/.test(clean) || clean === '…') {
        return `<div class="scene-break"><span>— ✦ —</span></div>`;
      }

      // Lời thoại bắt đầu bằng —
      if (clean.startsWith('—') || clean.startsWith('\u2013')) {
        return `<p class="dialogue">${clean}</p>`;
      }

      return `<p>${clean}</p>`;
    })
    .join('\n');

  return htmlParas;
}

// ══════════════════════════════════════════════════════════════
//  CÀO NỘI DUNG CHƯƠNG
// ══════════════════════════════════════════════════════════════

async function fetchChapterText(page, chapterNum) {
  const url = `${BASE_URL}/chapter-${chapterNum}?service=web`;
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    const result = await page.evaluate((chNum) => {
      const container = document.querySelector('.reader-container');
      if (!container) return null;

      const fullText = container.innerText;

      // Tìm phần nội dung thực sự (sau tiêu đề chương, trước "Report it here")
      const lines = fullText.split('\n');

      // Tìm dòng tiêu đề chương (Chapter N ...)
      let startIdx = -1;
      let chapterTitle = '';
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i].trim();
        const m = l.match(new RegExp(`^(?:#\\d+)?\\s*Chapter\\s+${chNum}\\b(.*)`, 'i'));
        if (m) {
          // Nếu tiêu đề bị lặp 2 lần liên tiếp, bỏ qua lần đầu
          if (startIdx === -1) {
            startIdx = i;
            chapterTitle = l.replace(/^#\d+/, '').trim();
          } else {
            startIdx = i + 1; // bắt đầu nội dung từ sau dòng tiêu đề thứ 2
            break;
          }
        }
      }

      if (startIdx === -1) return null;

      // Tìm điểm kết thúc
      let endIdx = lines.length;
      for (let i = startIdx + 1; i < lines.length; i++) {
        const l = lines[i].trim();
        if (
          l.startsWith('Report it here') ||
          l.startsWith('Prev') ||
          l.match(/^Ch\.\s*\d+\s*\/\s*\d+/) ||
          l.startsWith('Web') ||
          l.startsWith('AI') ||
          l.startsWith('Next')
        ) {
          endIdx = i;
          break;
        }
      }

      const contentLines = lines.slice(startIdx + 1, endIdx)
        .map(l => l.trim())
        .filter(l => l.length > 0)
        // Lọc các dòng UI của website bị cào nhầm
        .filter(l => {
          const lo = l.toLowerCase();
          return !(lo.startsWith('report it') ||
                   lo.startsWith('ads ') ||
                   lo.startsWith('ad ') ||
                   lo.match(/^prev(ious)?$/) ||
                   lo === 'next' ||
                   lo === 'web' || lo === 'web+' || lo === 'ai' ||
                   lo.match(/^\d+\.\d+%$/) ||
                   lo.match(/^ch\.?\s*\d+\s*\/\s*\d+/));
        });

      return { chapterTitle, contentLines };
    }, chapterNum);

    return result;
  } catch (err) {
    console.error(`  ❌ Lỗi khi tải chương ${chapterNum}: ${err.message}`);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════
//  DỊCH TOÀN BỘ NỘI DUNG CHƯƠNG
// ══════════════════════════════════════════════════════════════

async function translateChapter(chapterNum, chapterTitle, contentLines) {
  process.stdout.write(`  📝 Dịch tiêu đề... `);
  let titleVi = `Chương ${chapterNum}`;
  try {
    const titleSuffix = chapterTitle.replace(/^Chapter\s*\d+[:\s,\-–]*/i, '').trim();
    if (titleSuffix) {
      const res = await translate(titleSuffix, { to: 'vi', forceBatch: false });
      let t = postProcessVietnamese(res.text.trim());
      titleVi = `Chương ${chapterNum}: ${t}`;
    }
  } catch {}
  console.log(titleVi);

  console.log(`  📝 Dịch ${contentLines.length} đoạn văn (batch ${BATCH_SIZE})...`);

  const translatedParagraphs = [];
  // Dịch theo lô BATCH_SIZE đoạn một lần → nhanh hơn ~5x
  for (let i = 0; i < contentLines.length; i += BATCH_SIZE) {
    const batch = contentLines.slice(i, i + BATCH_SIZE);
    const results = await translateBatch(batch);
    translatedParagraphs.push(...results);
    await sleep(DELAY_BETWEEN_PARAGRAPHS);

    const done = Math.min(i + BATCH_SIZE, contentLines.length);
    process.stdout.write(`    [${done}/${contentLines.length}]\r`);
  }
  console.log('');

  const htmlContent = buildHtmlContent(titleVi, translatedParagraphs);
  return { titleVi, htmlContent };
}

// ══════════════════════════════════════════════════════════════
//  ĐĂNG LÊN SUPABASE
// ══════════════════════════════════════════════════════════════

async function uploadChapter(chapterNum, titleVi, htmlContent) {
  const { error } = await supabase.from('chapters').upsert(
    {
      story_id: STORY_ID,
      chapter_number: chapterNum,
      title: titleVi,
      content: htmlContent
    },
    { onConflict: 'story_id,chapter_number' }
  );
  if (error) throw error;
}

// ══════════════════════════════════════════════════════════════
//  MAIN
// ══════════════════════════════════════════════════════════════

async function run() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' 🚀  BẮT ĐẦU CÀO + DỊCH 442 CHƯƠNG "TỬ VONG HỒI ĐƯƠNG"');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Lấy danh sách chương đã có
  const { data: existing } = await supabase
    .from('chapters')
    .select('chapter_number')
    .eq('story_id', STORY_ID);
  const existingSet = new Set((existing || []).map(c => c.chapter_number));
  console.log(`📖 Đã có ${existingSet.size} chương trong DB.\n`);

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();

  let ok = 0, skipped = 0, failed = 0;

  for (let ch = 1; ch <= TOTAL_CHAPTERS; ch++) {
    if (existingSet.has(ch)) {
      process.stdout.write(`  ⏭️  Chương ${ch}: bỏ qua (đã có)\r`);
      skipped++;
      continue;
    }

    console.log(`\n▶  Chương ${ch}/${TOTAL_CHAPTERS}`);

    const fetched = await fetchChapterText(page, ch);
    if (!fetched || !fetched.contentLines || fetched.contentLines.length === 0) {
      console.log(`  ❌ Không lấy được nội dung — bỏ qua`);
      failed++;
      await sleep(DELAY_BETWEEN_CHAPTERS);
      continue;
    }

    const { titleVi, htmlContent } = await translateChapter(
      ch,
      fetched.chapterTitle,
      fetched.contentLines
    );

    try {
      await uploadChapter(ch, titleVi, htmlContent);
      ok++;
      console.log(`  ✅ Đăng thành công: "${titleVi}"`);
    } catch (err) {
      console.error(`  ❌ Lỗi đăng DB: ${err.message}`);
      failed++;
    }

    await sleep(DELAY_BETWEEN_CHAPTERS);
  }

  await browser.close();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(` ✅ Hoàn tất! Thành công: ${ok} | Bỏ qua: ${skipped} | Lỗi: ${failed}`);
  console.log('═══════════════════════════════════════════════════════════');
}

run().catch(console.error);
