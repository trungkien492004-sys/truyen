// Test nhanh numbered-list batch translation
const translate = require('google-translate-api-x');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const TEST_PARAS = [
  'A sweet-looking internet celebrity shoved a microphone right up to Wang Cong\'s mouth.',
  '"Do you know you are AI?"',
  'Wang Cong was rushing to work when he frowned, looking somewhat impatient.',
  'What is that?',
  'This morning, they\'re using internet memes on me!',
  '[[September]]',
  'Wang Cong ignored the strange livestreamer and crossed the street.',
  'At that moment, the sudden screech of tires rang out.',
];

async function translateBatch(paragraphs) {
  const numbered = paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n');
  console.log('=== INPUT ===');
  console.log(numbered);
  
  const res = await translate(numbered, { to: 'vi', forceBatch: false });
  const raw = res.text || '';
  console.log('\n=== RAW OUTPUT ===');
  console.log(raw);
  
  const result = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const n = i + 1;
    const startRe = new RegExp(`\\[${n}\\]\\s*`);
    const endRe   = new RegExp(`\\[${n + 1}\\]`);
    const startM  = raw.match(startRe);
    if (!startM) { result.push('[MISSING]'); continue; }
    const startPos = raw.indexOf(startM[0]) + startM[0].length;
    const endM    = raw.match(endRe);
    const endPos  = endM ? raw.indexOf(endM[0]) : raw.length;
    result.push(raw.slice(startPos, endPos).trim());
  }
  return result;
}

translateBatch(TEST_PARAS).then(result => {
  console.log('\n=== KẾT QUẢ TÁCH ===');
  result.forEach((r, i) => console.log(`[${i+1}] ${r}`));
  
  // Check không còn ⟦ artifact
  const hasArtifact = result.some(r => r.includes('⟦') || r.includes('⟧') || r.includes('SEP'));
  console.log('\n✅ Không có artifact SEP:', !hasArtifact);
}).catch(console.error);
