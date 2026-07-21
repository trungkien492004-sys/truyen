-- Hướng dẫn: Copy đoạn mã này dán vào phần "SQL Editor" trên trang quản trị Supabase và bấm "Run" để tạo các bảng cần thiết.

-- 1. BẢNG USERS (Thông tin người dùng đăng nhập qua Google OAuth)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    google_id TEXT UNIQUE NOT NULL,
    display_name TEXT,
    email TEXT UNIQUE NOT NULL,
    avatar TEXT,
    role TEXT DEFAULT 'reader' CHECK (role IN ('reader', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS stories (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    author TEXT,
    cover_url TEXT DEFAULT '/css/default-cover.jpg', -- Có ảnh bìa mặc định
    commissioned_by TEXT, -- Tên người đặt viết truyện (nếu có)
    story_type TEXT DEFAULT 'novel', -- Phân loại truyện: 'novel' (chữ) hoặc 'comic' (tranh)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. BẢNG GENRES (Danh sách thể loại truyện)
CREATE TABLE IF NOT EXISTS genres (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE
);

-- 4. BẢNG STORY_GENRES (Liên kết nhiều-nhiều giữa truyện và thể loại)
CREATE TABLE IF NOT EXISTS story_genres (
    story_id INT REFERENCES stories(id) ON DELETE CASCADE,
    genre_id INT REFERENCES genres(id) ON DELETE CASCADE,
    PRIMARY KEY (story_id, genre_id)
);

-- 5. BẢNG CHAPTERS (Nội dung từng chương truyện)
CREATE TABLE IF NOT EXISTS chapters (
    id SERIAL PRIMARY KEY,
    story_id INT REFERENCES stories(id) ON DELETE CASCADE,
    chapter_number INT NOT NULL,
    title TEXT NOT NULL,
    content TEXT, -- Nội dung chữ hoặc đan xen mã HTML <img> để hiển thị ảnh
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE (story_id, chapter_number) -- Đảm bảo một truyện không có hai chương trùng số
);

-- 6. BẢNG STORY_VIEWS (Ghi nhận lượt đọc truyện theo thời gian)
CREATE TABLE IF NOT EXISTS story_views (
    id SERIAL PRIMARY KEY,
    story_id INT REFERENCES stories(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 7. BẢNG CONTACT_REQUESTS (Lưu các yêu cầu liên hệ/dịch truyện gửi lên admin)
CREATE TABLE IF NOT EXISTS contact_requests (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    attachments TEXT[], -- Mảng các đường dẫn file ảnh đính kèm (vd: /uploads/abc.png)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 8. TẠO CÁC VIEW ĐỂ LẤY BẢNG XẾP HẠNG (RANKINGS)
-- View xếp hạng ngày (24 giờ qua)
CREATE OR REPLACE VIEW views_ranking_daily AS
SELECT s.id, s.title, s.author, s.cover_url, COUNT(v.id) AS view_count
FROM stories s
LEFT JOIN story_views v ON s.id = v.story_id AND v.created_at >= (NOW() - INTERVAL '1 day')
GROUP BY s.id, s.title, s.author, s.cover_url;

-- View xếp hạng tuần (7 ngày qua)
CREATE OR REPLACE VIEW views_ranking_weekly AS
SELECT s.id, s.title, s.author, s.cover_url, COUNT(v.id) AS view_count
FROM stories s
LEFT JOIN story_views v ON s.id = v.story_id AND v.created_at >= (NOW() - INTERVAL '7 days')
GROUP BY s.id, s.title, s.author, s.cover_url;

-- View xếp hạng tháng (30 ngày qua)
CREATE OR REPLACE VIEW views_ranking_monthly AS
SELECT s.id, s.title, s.author, s.cover_url, COUNT(v.id) AS view_count
FROM stories s
LEFT JOIN story_views v ON s.id = v.story_id AND v.created_at >= (NOW() - INTERVAL '30 days')
GROUP BY s.id, s.title, s.author, s.cover_url;

-- View xếp hạng năm (365 ngày qua)
CREATE OR REPLACE VIEW views_ranking_yearly AS
SELECT s.id, s.title, s.author, s.cover_url, COUNT(v.id) AS view_count
FROM stories s
LEFT JOIN story_views v ON s.id = v.story_id AND v.created_at >= (NOW() - INTERVAL '365 days')
GROUP BY s.id, s.title, s.author, s.cover_url;

-- ==========================================
-- CHÈN DỮ LIỆU THỂ LOẠI MẪU (Bắt buộc chạy để có thể loại chọn)
INSERT INTO genres (name, slug) VALUES 
('Tiên Hiệp', 'tien-hiep'),
('Kiếm Hiệp', 'kiem-hiep'),
('Ngôn Tình', 'ngon-tinh'),
('Đô Thị', 'do-thi'),
('Huyền Huyễn', 'huyen-huyen'),
('Khoa Huyễn', 'khoa-huyen'),
('Hệ Thống', 'he-thong'),
('Dã Sử', 'da-su'),
('Manga / Truyện Tranh', 'manga-truyen-tranh')
ON CONFLICT (name) DO NOTHING;
