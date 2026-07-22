-- Chạy trong Supabase Dashboard > SQL Editor để sửa lỗi BXH (/leaderboard) không hiển thị
-- huy hiệu (equipped_badge) và khung avatar (equipped_frame) của độc giả.
--
-- NGUYÊN NHÂN THẬT: view leaderboard_by_exp (định nghĩa trong schema_upgrade_all.sql) chỉ
-- SELECT id, display_name, avatar, exp, streak_days, chapters_read - KHÔNG có equipped_badge/
-- equipped_frame. Route /leaderboard (routes/index.js dòng 1826) lấy dữ liệu thẳng từ view này
-- bằng select('*'), nên 2 cột đó luôn undefined -> partials/avatar.ejs không có "badge" để hiển
-- thị game-title, dù dữ liệu equipped_badge trong bảng users là CÓ THẬT. Đây là lỗi tồn tại từ
-- trước, không phải do các thay đổi CSS gần đây.

DROP VIEW IF EXISTS leaderboard_by_exp CASCADE;

CREATE OR REPLACE VIEW leaderboard_by_exp AS
SELECT u.id, u.display_name, u.avatar, u.equipped_badge, u.equipped_frame,
       s.exp, s.streak_days,
       COALESCE((SELECT COUNT(*) FROM chapter_reads cr WHERE cr.user_id = u.id), 0) AS chapters_read
FROM users u
JOIN user_stats s ON s.user_id = u.id
ORDER BY s.exp DESC;
