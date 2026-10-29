const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres.hdfwyfdrgkueatxkxuky:Yugiki4910%40@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres',
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const htmlBodyPath = path.join(__dirname, 'ch5_body.html');
    const bodyContent = fs.readFileSync(htmlBodyPath, 'utf8');

    // Check if Chapter 5 image exists
    const ch5ImgPath = path.join(__dirname, '../public/images/illustrations/khat-tinh-ch5.jpg');
    let illustrationHtml = '';
    if (fs.existsSync(ch5ImgPath)) {
      illustrationHtml = `
<div style="margin: 2rem auto; max-width: 520px; text-align: center; background: rgba(186, 112, 137, 0.08); border: 1px solid rgba(186, 112, 137, 0.3); border-radius: 8px; padding: 12px;">
  <div style="font-size: 0.85rem; font-weight: bold; letter-spacing: 2px; color: #e11d48; margin-bottom: 8px;">✦ MINH HỌA CHƯƠNG 5 ✦</div>
  <img src="/images/illustrations/khat-tinh-ch5.jpg" alt="Minh họa Chương 5" style="max-width: 100%; border-radius: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.4);" />
  <div style="margin-top: 8px; font-style: italic; font-size: 0.95rem; color: #f43f5e; font-weight: 500;">“Bốn thân xác cuốn vào trò chơi đổi bạn tình đồi bại, phản chiếu dưới tấm gương trần của dục vọng không đáy”</div>
</div>`;
    }

    const quoteBoxHtml = `
<div style="margin: 2rem auto; max-width: 520px; text-align: center; background: rgba(186, 112, 137, 0.08); border: 1px solid rgba(186, 112, 137, 0.3); border-radius: 8px; padding: 16px 20px;">
  <div style="font-size: 0.85rem; font-weight: bold; letter-spacing: 2px; color: #e11d48; margin-bottom: 8px;">✦ ĐIỂM NHẤN CHƯƠNG 5 ✦</div>
  <div style="font-style: italic; font-size: 0.95rem; color: #f43f5e; font-weight: 500; line-height: 1.6;">“Trước tấm gương trần phản chiếu bản giao hưởng xác thịt đồi bại, mọi luân thường đạo lý đều tan thành mây khói — chỉ còn lại sự phục tùng tuyệt đối trước dục vọng của kẻ săn mồi.”</div>
</div>`;

    const endBlockHtml = `
<p style="text-align: center; font-weight: bold; color: #e11d48; margin: 2rem 0 1rem 0; letter-spacing: 2px;">❖ HẾT CHƯƠNG 5 ❖</p>`;

    const fullChapter5Html = bodyContent + '\n' + illustrationHtml + '\n' + quoteBoxHtml + '\n' + endBlockHtml;

    // Check if Chapter 5 already exists in DB
    const existing = await client.query(
      'SELECT id FROM chapters WHERE story_id = $1 AND chapter_number = $2',
      [479, 5]
    );

    let res;
    if (existing.rows.length > 0) {
      res = await client.query(
        `UPDATE chapters 
         SET title = $1, content = $2, created_at = NOW() 
         WHERE story_id = $3 AND chapter_number = $4 
         RETURNING id, chapter_number, title`,
        ['Chương 5: Bốn Người Một Phòng', fullChapter5Html, 479, 5]
      );
      console.log('Chapter 5 updated in DB:', res.rows[0]);
    } else {
      res = await client.query(
        `INSERT INTO chapters (
          story_id, 
          chapter_number, 
          title, 
          content, 
          views, 
          created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        RETURNING id, chapter_number, title`,
        [479, 5, 'Chương 5: Bốn Người Một Phòng', fullChapter5Html, 0]
      );
      console.log('Chapter 5 inserted into DB:', res.rows[0]);
    }

    // Update story last_update_at
    await client.query(
      `UPDATE stories SET last_update_at = NOW() WHERE id = 479`
    );

    await client.query('COMMIT');
    console.log('Successfully published Chapter 5!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Failed to publish Chapter 5:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
