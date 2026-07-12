-- Hướng dẫn: Copy toàn bộ file này dán vào "SQL Editor" trên Supabase và bấm "Run".
-- Thêm 2 cột lưu số thứ tự bậc tu vi (trước/sau khi đột phá), để hiển thị dạng
-- "Rank #2 -> #1" trên bảng sự kiện đột phá cảnh giới ở trang chủ.

ALTER TABLE rank_up_events ADD COLUMN IF NOT EXISTS rank_before_num INT;
ALTER TABLE rank_up_events ADD COLUMN IF NOT EXISTS rank_after_num INT;
