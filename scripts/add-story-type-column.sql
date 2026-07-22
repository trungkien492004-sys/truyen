-- Chạy 1 lần trong Supabase Dashboard > SQL Editor để tạo cột story_type -
-- đây là nguyên nhân gây lỗi sập toàn bộ trang chủ khi code mới cố .eq('story_type', ...)
-- nhưng cột này chưa từng được tạo thật trong bảng stories.

ALTER TABLE stories ADD COLUMN IF NOT EXISTS story_type TEXT DEFAULT 'novel';

-- Sau khi chạy xong câu trên, vào trang web và mở URL sau (đăng nhập admin trước):
--   https://truyen-psi.vercel.app/admin/classify-stories
-- Route này sẽ tự động phân loại toàn bộ truyện hiện có thành 'comic' hoặc 'novel'
-- dựa trên tỉ lệ ảnh/chữ trong chương đầu tiên (xem services/storyClassifier.js).
