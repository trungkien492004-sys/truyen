-- Chạy trong Supabase Dashboard > SQL Editor để sửa lỗi "column stories_with_last_update.story_type
-- does not exist". Nguyên nhân: view stories_with_last_update được tạo bằng SELECT s.* TRƯỚC KHI
-- cột story_type được thêm vào bảng stories - Postgres không tự cập nhật cột mới vào view đã tạo
-- sẵn. CREATE OR REPLACE VIEW không đủ vì Postgres chặn đổi cấu trúc cột của view đang bị view khác
-- phụ thuộc (lỗi 42P16: cannot drop columns from view) - phải DROP CASCADE rồi tạo lại toàn bộ.

DROP VIEW IF EXISTS leaderboard_by_exp, stories_with_last_update, stories_bookmarks_count CASCADE;

-- View bảng xếp hạng độc giả theo EXP (build lại vì bị cascade xóa theo, dù không liên quan cột mới)
CREATE OR REPLACE VIEW leaderboard_by_exp AS
SELECT u.id, u.display_name, u.avatar, s.exp, s.streak_days,
       COALESCE((SELECT COUNT(*) FROM chapter_reads cr WHERE cr.user_id = u.id), 0) AS chapters_read
FROM users u
JOIN user_stats s ON s.user_id = u.id
ORDER BY s.exp DESC;

-- View truyện kèm thời điểm cập nhật chương gần nhất (build lại - giờ SELECT s.* sẽ tự
-- bao gồm cột story_type mới vì tạo view SAU KHI cột đã tồn tại trong bảng stories)
CREATE OR REPLACE VIEW stories_with_last_update AS
SELECT s.*,
       COALESCE(MAX(c.created_at), s.created_at) AS last_update_at
FROM stories s
LEFT JOIN chapters c ON c.story_id = s.id
GROUP BY s.id;

-- View truyện kèm số lượt bookmark (build lại vì bị cascade xóa theo)
CREATE OR REPLACE VIEW stories_bookmarks_count AS
SELECT s.id, s.title, s.author, s.cover_url, COUNT(b.id) AS bookmark_count
FROM stories s
LEFT JOIN bookmarks b ON s.id = b.story_id
GROUP BY s.id;
