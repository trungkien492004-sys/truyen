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

-- 3. VIEW: TRUYỆN KÈM THỜI ĐIỂM CẬP NHẬT CHƯƠNG GẦN NHẤT
-- Dùng để sắp xếp trang chủ theo "truyện mới cập nhật" (có chương mới đăng) thay vì ngày tạo truyện
CREATE OR REPLACE VIEW stories_with_last_update AS
SELECT s.*,
       COALESCE(MAX(c.created_at), s.created_at) AS last_update_at
FROM stories s
LEFT JOIN chapters c ON c.story_id = s.id
GROUP BY s.id;
