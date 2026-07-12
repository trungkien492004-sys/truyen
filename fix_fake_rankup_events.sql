-- Hướng dẫn: Copy toàn bộ file này dán vào "SQL Editor" trên Supabase và bấm "Run".
-- Mục đích: file backfill_rank_up_today.sql trước đây đã lỡ ghi nhận "đột phá" cho CẢ những
-- người KHÔNG hề đổi bậc (ví dụ vẫn đang ở "Xuất sớm" nhưng bị ghi from_rank = to_rank = "Xuất sớm").
-- File này dọn sạch các record rác đó, và bù lại đúng 1 record cho người THỰC SỰ đã đổi bậc hôm nay
-- (dựa theo rank_settings hiện tại), kèm rank_before_num/rank_after_num đúng.

-- BƯỚC 1: Xóa các record rác trong hôm nay không có thay đổi bậc thực sự (from_rank = to_rank)
DELETE FROM rank_up_events
WHERE created_at::date = CURRENT_DATE
  AND from_rank = to_rank;

-- BƯỚC 2: Với các user đã đọc hôm nay, tính lại xem rank hiện tại của họ (theo rank_settings mới nhất)
-- có KHÁC với rank thấp nhất ("Xuất sớm"/bậc #1, tức idx=0) hay không - nếu khác, coi là đã đột phá,
-- và ghi/ cập nhật lại record cho đúng format mới (có rank_before_num, rank_after_num).
-- CHÚ Ý: vì không có lịch sử rank thật trước đó, ta coi mốc xuất phát là bậc thấp nhất hiện có.
WITH ranked AS (
  SELECT
    rs.*,
    ROW_NUMBER() OVER (ORDER BY rs.count ASC) AS rn
  FROM rank_settings rs
),
user_current_rank AS (
  SELECT
    us.user_id,
    (
      SELECT r.rn FROM ranked r
      WHERE us.chapters_read >= r.count
      ORDER BY r.count DESC
      LIMIT 1
    ) AS rank_num,
    (
      SELECT r.label FROM ranked r
      WHERE us.chapters_read >= r.count
      ORDER BY r.count DESC
      LIMIT 1
    ) AS rank_label
  FROM user_stats us
  WHERE us.last_read_date = CURRENT_DATE
)
INSERT INTO rank_up_events (user_id, from_rank, to_rank, rank_before_num, rank_after_num, created_at)
SELECT
  ucr.user_id,
  (SELECT label FROM ranked WHERE rn = 1) AS from_rank, -- bậc thấp nhất làm mốc xuất phát mặc định
  ucr.rank_label AS to_rank,
  1 AS rank_before_num,
  ucr.rank_num AS rank_after_num,
  NOW()
FROM user_current_rank ucr
WHERE ucr.rank_num IS NOT NULL
  AND ucr.rank_num > 1 -- chỉ ghi nếu THỰC SỰ cao hơn bậc thấp nhất
  AND NOT EXISTS (
    SELECT 1 FROM rank_up_events rue
    WHERE rue.user_id = ucr.user_id
      AND rue.created_at::date = CURRENT_DATE
  );

-- BƯỚC 3: Kiểm tra lại kết quả cuối cùng cho hôm nay
SELECT rue.id, u.display_name, rue.from_rank, rue.to_rank, rue.rank_before_num, rue.rank_after_num, rue.created_at
FROM rank_up_events rue
JOIN users u ON u.id = rue.user_id
WHERE rue.created_at::date = CURRENT_DATE
ORDER BY rue.created_at DESC;
