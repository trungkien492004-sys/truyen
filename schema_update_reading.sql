-- Hướng dẫn: Copy đoạn mã này dán vào "SQL Editor" trên Supabase và bấm "Run".
-- File này bổ sung tính năng: Lịch sử đọc + Bookmark (Theo dõi truyện / Đọc sau / Hoàn thành / Yêu thích).

-- 1. BẢNG READING_HISTORY (Lưu tiến độ đọc của từng người dùng cho từng truyện)
CREATE TABLE IF NOT EXISTS reading_history (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    story_id INT REFERENCES stories(id) ON DELETE CASCADE,
    chapter_number INT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (user_id, story_id) -- Mỗi người dùng chỉ có 1 tiến độ đọc cho mỗi truyện (chương gần nhất)
);

-- 2. BẢNG BOOKMARKS (Theo dõi truyện + phân loại danh sách cá nhân)
CREATE TABLE IF NOT EXISTS bookmarks (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    story_id INT REFERENCES stories(id) ON DELETE CASCADE,
    status TEXT DEFAULT 'reading' CHECK (status IN ('reading', 'plan_to_read', 'completed', 'favorite')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (user_id, story_id) -- Mỗi người dùng chỉ có 1 trạng thái bookmark cho mỗi truyện
);

-- Index hỗ trợ truy vấn nhanh theo user
CREATE INDEX IF NOT EXISTS idx_reading_history_user ON reading_history(user_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);

-- 2b. ROW LEVEL SECURITY: Cho phép backend (dùng anon key) đọc/ghi 2 bảng này.
-- Việc kiểm soát "user nào được sửa dữ liệu của user đó" đã được xử lý ở tầng ứng dụng
-- (routes/index.js chỉ dùng req.user.id lấy từ session đăng nhập, không cho client tự truyền user_id),
-- nên ở tầng database chỉ cần mở quyền cho vai trò anon/authenticated, giống cách các bảng cũ đang hoạt động.
ALTER TABLE reading_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "allow_all_reading_history" ON reading_history;
CREATE POLICY "allow_all_reading_history" ON reading_history
    FOR ALL
    USING (true)
    WITH CHECK (true);

DROP POLICY IF EXISTS "allow_all_bookmarks" ON bookmarks;
CREATE POLICY "allow_all_bookmarks" ON bookmarks
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 4. THÊM CỘT TRẠNG THÁI TRUYỆN (ĐANG TIẾN HÀNH / HOÀN THÀNH)
ALTER TABLE stories ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'completed'));

-- Cập nhật lại view stories_with_last_update để bao gồm cột status mới (SELECT s.* đã tự động lấy cột mới, không cần sửa)

-- 5. BẢNG RATINGS (Đánh giá truyện theo thang điểm 1-10)
CREATE TABLE IF NOT EXISTS ratings (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    story_id INT REFERENCES stories(id) ON DELETE CASCADE,
    score INT NOT NULL CHECK (score BETWEEN 1 AND 10),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (user_id, story_id) -- Mỗi người dùng chỉ chấm 1 điểm cho mỗi truyện (chấm lại sẽ ghi đè)
);

CREATE INDEX IF NOT EXISTS idx_ratings_story ON ratings(story_id);

ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_ratings" ON ratings;
CREATE POLICY "allow_all_ratings" ON ratings
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- View tính điểm trung bình + số lượt đánh giá cho mỗi truyện
CREATE OR REPLACE VIEW story_ratings_summary AS
SELECT story_id,
       ROUND(AVG(score)::numeric, 1) AS avg_score,
       COUNT(*) AS rating_count
FROM ratings
GROUP BY story_id;

-- 6. GAMIFICATION: BẢNG CHAPTER_READS (Ghi nhận MỖI LẦN đọc 1 chương - dùng để tính EXP/streak/BXH,
--    khác với reading_history chỉ lưu tiến độ gần nhất)
CREATE TABLE IF NOT EXISTS chapter_reads (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    story_id INT REFERENCES stories(id) ON DELETE CASCADE,
    chapter_number INT NOT NULL,
    read_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (user_id, story_id, chapter_number) -- Mỗi chương chỉ tính EXP 1 lần cho mỗi người dùng
);

CREATE INDEX IF NOT EXISTS idx_chapter_reads_user ON chapter_reads(user_id);

ALTER TABLE chapter_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_chapter_reads" ON chapter_reads;
CREATE POLICY "allow_all_chapter_reads" ON chapter_reads
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- 7. BẢNG USER_STATS (EXP + Streak đọc liên tục của từng người dùng)
CREATE TABLE IF NOT EXISTS user_stats (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    exp INT DEFAULT 0 NOT NULL,
    streak_days INT DEFAULT 0 NOT NULL,
    last_read_date DATE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_user_stats" ON user_stats;
CREATE POLICY "allow_all_user_stats" ON user_stats
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- View bảng xếp hạng độc giả theo EXP (Top người đọc nhiều nhất)
CREATE OR REPLACE VIEW leaderboard_by_exp AS
SELECT u.id, u.display_name, u.avatar, s.exp, s.streak_days,
       (SELECT COUNT(*) FROM chapter_reads cr WHERE cr.user_id = u.id) AS chapters_read
FROM users u
JOIN user_stats s ON s.user_id = u.id
ORDER BY s.exp DESC;

-- 3. VIEW: TRUYỆN KÈM THỜI ĐIỂM CẬP NHẬT CHƯƠNG GẦN NHẤT
-- Dùng để sắp xếp trang chủ theo "truyện mới cập nhật" (có chương mới đăng) thay vì ngày tạo truyện
CREATE OR REPLACE VIEW stories_with_last_update AS
SELECT s.*,
       COALESCE(MAX(c.created_at), s.created_at) AS last_update_at
FROM stories s
LEFT JOIN chapters c ON c.story_id = s.id
GROUP BY s.id;
