const { Client } = require('pg');
const cs = 'postgresql://postgres.hdfwyfdrgkueatxkxuky:Yugiki4910%40@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';

async function main() {
  const client = new Client({ connectionString: cs });
  await client.connect();

  console.log('1. Cập nhật last_update_at cho toàn bộ các truyện bị lệch...');
  const updateRes = await client.query(`
    UPDATE stories s
    SET last_update_at = sub.max_created
    FROM (
      SELECT story_id, MAX(created_at) AS max_created
      FROM chapters
      GROUP BY story_id
    ) sub
    WHERE s.id = sub.story_id
      AND (s.last_update_at IS NULL OR sub.max_created > s.last_update_at);
  `);
  console.log(`Đã cập nhật ${updateRes.rowCount} truyện có thời gian bị cũ!`);

  // Đưa truyện "Điện thoại thần kỳ ở tu chân giới" (ID 7) lên thời điểm mới nhất
  console.log('2. Đưa "Điện thoại thần kỳ ở tu chân giới" (ID 7) lên thời điểm cập nhật hiện tại...');
  await client.query(`
    UPDATE stories
    SET last_update_at = NOW()
    WHERE id = 7;
  `);

  // Tạo Trigger tự động cập nhật last_update_at khi có chương mới
  console.log('3. Thiết lập Database Trigger tự động cập nhật last_update_at khi thêm/sửa chương...');
  await client.query(`
    CREATE OR REPLACE FUNCTION update_story_last_update_at()
    RETURNS TRIGGER AS $$
    BEGIN
      UPDATE stories
      SET last_update_at = COALESCE(NEW.created_at, NOW())
      WHERE id = NEW.story_id;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_auto_update_story_time ON chapters;
    CREATE TRIGGER trg_auto_update_story_time
    AFTER INSERT OR UPDATE ON chapters
    FOR EACH ROW
    EXECUTE FUNCTION update_story_last_update_at();
  `);
  console.log('Database Trigger đã được kích hoạt thành công!');

  // Kiểm tra lại truyện ID 7 trong view
  const vCheck = await client.query(`
    SELECT id, title, last_update_at FROM stories_with_last_update WHERE id = 7;
  `);
  console.log('Kiểm tra Story 7 trong view sau khi fix:', vCheck.rows[0]);

  await client.end();
}

main().catch(console.error);
