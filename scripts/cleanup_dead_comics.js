const { Client } = require('pg');

const cs = 'postgresql://postgres.hdfwyfdrgkueatxkxuky:Yugiki4910%40@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';
const client = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });

async function runCleanup() {
  await client.connect();
  console.log('Connected to PostgreSQL for comic cleanup...');

  // 1. Identify all comics
  const res = await client.query(`
    SELECT s.id, s.title, s.cover_url, s.source_url,
           COUNT(c.id) as chapter_count
    FROM stories s
    LEFT JOIN chapters c ON c.story_id = s.id
    WHERE s.story_type = 'comic'
    GROUP BY s.id, s.title, s.cover_url, s.source_url
    ORDER BY s.id ASC
  `);

  const comics = res.rows;
  console.log(`Found ${comics.length} comics total in database.`);

  const toDeleteIds = [];
  const toDeleteTitles = [];

  for (const c of comics) {
    if (parseInt(c.chapter_count) === 0) {
      toDeleteIds.push(c.id);
      toDeleteTitles.push(`[${c.id}] ${c.title} (0 chaps)`);
      continue;
    }

    const chapRes = await client.query(`
      SELECT content FROM chapters WHERE story_id = $1 LIMIT 1
    `, [c.id]);

    const content = chapRes.rows[0]?.content || '';
    const hasDeadCdn = content.includes('zs.wtcdn.xyz') || content.includes('mbpro.vip') ||
                       (c.cover_url && (c.cover_url.includes('zs.wtcdn.xyz') || c.cover_url.includes('mbpro.vip')));

    const isVietmanhwa = (c.source_url && c.source_url.includes('vietmanhwa')) ||
                         content.includes('vietmanhwa') ||
                         (c.cover_url && c.cover_url.includes('vietmanhwa'));

    if (hasDeadCdn && !isVietmanhwa) {
      toDeleteIds.push(c.id);
      toDeleteTitles.push(`[${c.id}] ${c.title} (dead CDN)`);
    }
  }

  console.log(`\nIdentified ${toDeleteIds.length} comics to delete.`);
  console.log(`Sample to delete:`, toDeleteTitles.slice(0, 10));

  if (toDeleteIds.length > 0) {
    console.log(`Deleting ${toDeleteIds.length} dead comics...`);
    const delRes = await client.query(`
      DELETE FROM stories
      WHERE id = ANY($1::int[])
    `, [toDeleteIds]);

    console.log(`Successfully deleted ${delRes.rowCount} dead comic stories!`);
  }

  // Check remaining comics
  const remainRes = await client.query(`
    SELECT COUNT(*) FROM stories WHERE story_type = 'comic'
  `);
  console.log(`Remaining healthy comics in DB: ${remainRes.rows[0].count}`);

  await client.end();
}

runCleanup().catch(console.error);
