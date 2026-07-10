-- SQL Migration Script to upgrade database schema for all features

-- Hủy tất cả các view phụ thuộc vào bảng stories để tránh xung đột cột khi ALTER TABLE
DROP VIEW IF EXISTS views_ranking_daily, views_ranking_weekly, views_ranking_monthly, views_ranking_yearly, stories_with_last_update, stories_bookmarks_count, leaderboard_by_exp CASCADE;

-- 1. Bổ sung các cột mới vào bảng stories
ALTER TABLE stories ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ongoing' CHECK (status IN ('ongoing', 'completed'));
ALTER TABLE stories ADD COLUMN IF NOT EXISTS year INT;

-- 2. Bảng ratings (Đánh giá truyện từ 1-10 sao)
CREATE TABLE IF NOT EXISTS ratings (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    story_id INT REFERENCES stories(id) ON DELETE CASCADE,
    score INT NOT NULL CHECK (score BETWEEN 1 AND 10),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (user_id, story_id)
);
ALTER TABLE ratings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_ratings" ON ratings;
CREATE POLICY "allow_all_ratings" ON ratings FOR ALL USING (true) WITH CHECK (true);

-- Re-create các views xếp hạng theo lượt đọc
CREATE OR REPLACE VIEW views_ranking_daily AS
SELECT s.id, s.title, s.author, s.cover_url, COUNT(v.id) AS view_count
FROM stories s
LEFT JOIN story_views v ON s.id = v.story_id AND v.created_at >= (NOW() - INTERVAL '1 day')
GROUP BY s.id, s.title, s.author, s.cover_url;

CREATE OR REPLACE VIEW views_ranking_weekly AS
SELECT s.id, s.title, s.author, s.cover_url, COUNT(v.id) AS view_count
FROM stories s
LEFT JOIN story_views v ON s.id = v.story_id AND v.created_at >= (NOW() - INTERVAL '7 days')
GROUP BY s.id, s.title, s.author, s.cover_url;

CREATE OR REPLACE VIEW views_ranking_monthly AS
SELECT s.id, s.title, s.author, s.cover_url, COUNT(v.id) AS view_count
FROM stories s
LEFT JOIN story_views v ON s.id = v.story_id AND v.created_at >= (NOW() - INTERVAL '30 days')
GROUP BY s.id, s.title, s.author, s.cover_url;

CREATE OR REPLACE VIEW views_ranking_yearly AS
SELECT s.id, s.title, s.author, s.cover_url, COUNT(v.id) AS view_count
FROM stories s
LEFT JOIN story_views v ON s.id = v.story_id AND v.created_at >= (NOW() - INTERVAL '365 days')
GROUP BY s.id, s.title, s.author, s.cover_url;

-- View tính điểm trung bình truyện
CREATE OR REPLACE VIEW story_ratings_summary AS
SELECT story_id,
       ROUND(AVG(score)::numeric, 1) AS avg_score,
       COUNT(*) AS rating_count
FROM ratings
GROUP BY story_id;

-- 3. Bảng chapter_reads (Ghi nhận số lần đọc chương để tính EXP)
CREATE TABLE IF NOT EXISTS chapter_reads (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    story_id INT REFERENCES stories(id) ON DELETE CASCADE,
    chapter_number INT NOT NULL,
    read_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (user_id, story_id, chapter_number)
);
ALTER TABLE chapter_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_chapter_reads" ON chapter_reads;
CREATE POLICY "allow_all_chapter_reads" ON chapter_reads FOR ALL USING (true) WITH CHECK (true);

-- 4. Bảng user_stats (EXP và streak đọc của độc giả)
CREATE TABLE IF NOT EXISTS user_stats (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    exp INT DEFAULT 0 NOT NULL,
    streak_days INT DEFAULT 0 NOT NULL,
    last_read_date DATE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE user_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_user_stats" ON user_stats;
CREATE POLICY "allow_all_user_stats" ON user_stats FOR ALL USING (true) WITH CHECK (true);

-- View bảng xếp hạng độc giả theo EXP
CREATE OR REPLACE VIEW leaderboard_by_exp AS
SELECT u.id, u.display_name, u.avatar, s.exp, s.streak_days,
       COALESCE((SELECT COUNT(*) FROM chapter_reads cr WHERE cr.user_id = u.id), 0) AS chapters_read
FROM users u
JOIN user_stats s ON s.user_id = u.id
ORDER BY s.exp DESC;

-- View truyện kèm thời điểm cập nhật chương gần nhất
CREATE OR REPLACE VIEW stories_with_last_update AS
SELECT s.*,
       COALESCE(MAX(c.created_at), s.created_at) AS last_update_at
FROM stories s
LEFT JOIN chapters c ON c.story_id = s.id
GROUP BY s.id;

-- View truyện kèm số lượt bookmark (được theo dõi nhiều nhất)
CREATE OR REPLACE VIEW stories_bookmarks_count AS
SELECT s.id, s.title, s.author, s.cover_url, COUNT(b.id) AS bookmark_count
FROM stories s
LEFT JOIN bookmarks b ON s.id = b.story_id
GROUP BY s.id;

-- 5. Bảng comments (Bình luận truyện và chương truyện)
CREATE TABLE IF NOT EXISTS comments (
    id SERIAL PRIMARY KEY,
    story_id INT REFERENCES stories(id) ON DELETE CASCADE,
    chapter_number INT, -- NULL nếu bình luận ở trang truyện, có giá trị nếu bình luận ở chương
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    parent_id INT REFERENCES comments(id) ON DELETE CASCADE, -- ID bình luận gốc (cho phản hồi lồng nhau)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_story ON comments(story_id);
CREATE INDEX IF NOT EXISTS idx_comments_user ON comments(user_id);
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_comments" ON comments;
CREATE POLICY "allow_all_comments" ON comments FOR ALL USING (true) WITH CHECK (true);

-- Bảng comment_likes (Lượt thích bình luận)
CREATE TABLE IF NOT EXISTS comment_likes (
    comment_id INT REFERENCES comments(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (comment_id, user_id)
);
ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_comment_likes" ON comment_likes;
CREATE POLICY "allow_all_comment_likes" ON comment_likes FOR ALL USING (true) WITH CHECK (true);

-- 6. Bảng notifications (Thông báo của người dùng)
CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    link TEXT, -- Link hướng tới (ví dụ: /story/10/chapter/5)
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_notifications" ON notifications;
CREATE POLICY "allow_all_notifications" ON notifications FOR ALL USING (true) WITH CHECK (true);

-- 7. Hệ thống thành tựu & huy hiệu
CREATE TABLE IF NOT EXISTS achievements (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    badge_class TEXT -- E.g. 'legend', 'gold', 'silver', 'bronze'
);
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_achievements" ON achievements;
CREATE POLICY "allow_all_achievements" ON achievements FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS user_achievements (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    achievement_id INT REFERENCES achievements(id) ON DELETE CASCADE,
    unlocked_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (user_id, achievement_id)
);
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_user_achievements" ON user_achievements;
CREATE POLICY "allow_all_user_achievements" ON user_achievements FOR ALL USING (true) WITH CHECK (true);

-- Chèn dữ liệu thành tựu mẫu
INSERT INTO achievements (name, description, badge_class) VALUES
('Độc giả mới', 'Đọc chương đầu tiên trên ứng dụng.', 'bronze'),
('Mọt sách thực thụ', 'Đọc tổng cộng 20 chương truyện.', 'silver'),
('Đại học giả', 'Đọc tổng cộng 100 chương truyện.', 'gold'),
('Huyền thoại độc giả', 'Đọc tổng cộng 500 chương truyện.', 'legend'),
('Kiên trì đọc sách', 'Đạt chuỗi đọc truyện (streak) 7 ngày liên tiếp.', 'gold'),
('Người đóng góp', 'Đăng bình luận đầu tiên của bạn.', 'bronze')
ON CONFLICT (name) DO NOTHING;
