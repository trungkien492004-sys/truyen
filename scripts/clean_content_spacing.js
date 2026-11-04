const { Client } = require('pg');
const cs = 'postgresql://postgres.hdfwyfdrgkueatxkxuky:Yugiki4910%40@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';

function cleanChapterContent(content) {
  if (!content) return content;
  let text = content;

  // 1. Fix missing space after punctuation before Vietnamese/Word character:
  // e.g. "game!!Chẳng" -> "game!! Chẳng"
  // e.g. "nhau.Nhiều" -> "nhau. Nhiều"
  // e.g. "ngươi.Chẳng" -> "ngươi. Chẳng"
  // e.g. "ha"~Phương" -> "ha"~ Phương"
  // e.g. "chạm…liên" -> "chạm… liên"
  // But be careful NOT to break URLs (http:// or https:// or image URLs .jpg, .png) or tags (<p>, </p>)
  
  // We can do this safely by splitting by HTML tags or processing text nodes.
  const parts = text.split(/(<[^>]+>)/g);
  for (let i = 0; i < parts.length; i++) {
    // If it's not an HTML tag:
    if (!parts[i].startsWith('<')) {
      let t = parts[i];

      // Fix punctuation followed directly by word without space:
      // Exclude numbers (e.g. 1.5, 3,14) and URLs
      // [.,!?:;…~] followed by Vietnamese uppercase or word
      // e.g. .A, !A, ?A, :A, ;A, …A, …a
      t = t.replace(/([.,!?:;~])([A-ZÀ-ỸÁ-Ỵ])/g, '$1 $2');
      t = t.replace(/(…)([a-zà-ỹA-ZÀ-Ỹ0-9])/g, '$1 $2');
      t = t.replace(/([a-zà-ỹ0-9])(…)/g, '$1$2'); // keep word… together or add space if needed
      t = t.replace(/([.!?])([a-zà-ỹ])/g, '$1 $2'); // lower case after sentence end
      
      // Fix e.g. "Không!!không" -> "Không!! Không"
      t = t.replace(/(!{1,3})([a-zà-ỹA-ZÀ-Ỹ])/g, '$1 $2');
      t = t.replace(/(\?{1,3})([a-zà-ỹA-ZÀ-Ỹ])/g, '$1 $2');

      // Fix multiple spaces:
      t = t.replace(/[ ]{2,}/g, ' ');

      parts[i] = t;
    }
  }
  text = parts.join('');

  // 2. Fix tags glued to text outside <p>:
  // e.g. </p>Hắn -> </p><p>Hắn
  text = text.replace(/<\/p>([A-Za-zÀ-ỹ0-9])/g, '</p><p>$1');
  text = text.replace(/([A-Za-zÀ-ỹ0-9])<p>/g, '$1</p><p>');

  return text;
}

async function run() {
  const client = new Client({ connectionString: cs });
  await client.connect();
  console.log('Connecting to database...');

  const res = await client.query('SELECT id, chapter_number, title, content FROM chapters WHERE story_id = 7 ORDER BY chapter_number ASC;');
  console.log(`Checking ${res.rows.length} chapters of story 7...`);

  let updatedCount = 0;
  for (const row of res.rows) {
    const original = row.content || '';
    const cleaned = cleanChapterContent(original);
    if (cleaned !== original) {
      await client.query('UPDATE chapters SET content = $1 WHERE id = $2;', [cleaned, row.id]);
      console.log(`Updated Chapter ${row.chapter_number}: "${row.title}"`);
      updatedCount++;
    }
  }

  console.log(`\nDone! Successfully cleaned and updated ${updatedCount} chapters.`);
  await client.end();
}

run().catch(console.error);
