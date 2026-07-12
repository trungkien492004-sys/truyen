-- Hướng dẫn: Copy toàn bộ file này dán vào "SQL Editor" trên Supabase và bấm "Run".
-- Mục đích: sửa các chương đăng qua EPUB bị "dính chữ" (toàn bộ nội dung nằm gọn trong
-- 1 thẻ <p>...</p> duy nhất, không xuống dòng đúng đoạn văn), KHÔNG cần đăng lại từ đầu.
--
-- Cách làm: với các chương của 1 truyện cụ thể mà nội dung chỉ có ĐÚNG 1 cặp <p>...</p>
-- (dấu hiệu bị dính), tự động chèn thêm ranh giới đoạn văn "</p><p>" tại các vị trí có
-- dấu kết câu (. ! ? ” ") theo sau bởi khoảng trắng + một chữ cái viết hoa - đây là cách
-- nhận diện ranh giới câu/đoạn phổ biến nhất trong văn bản tiếng Việt.
--
-- AN TOÀN: chỉ chạy cho chương của 1 truyện cụ thể (thay STORY_ID_CAN_SUA bên dưới),
-- và chỉ sửa các chương thực sự đang bị dính (số lượng thẻ <p> <= 1).

-- BƯỚC 1: Xem trước những chương nào của truyện đang bị dính (kiểm tra trước khi sửa)
-- Thay 'STORY_ID_CAN_SUA' bằng id thật của truyện "Con Đường Bá Chủ" (xem trong bảng stories).
SELECT id, chapter_number, title,
       (LENGTH(content) - LENGTH(REPLACE(content, '<p>', ''))) / 3 AS so_doan_van
FROM chapters
WHERE story_id = 'STORY_ID_CAN_SUA'
  AND (LENGTH(content) - LENGTH(REPLACE(content, '<p>', ''))) / 3 <= 1
ORDER BY chapter_number;

-- BƯỚC 2: Sửa các chương bị dính - chèn ranh giới đoạn văn dựa theo dấu kết câu.
-- CHẠY BƯỚC NÀY SAU KHI đã xem trước ở Bước 1 và xác nhận đúng các chương cần sửa.
UPDATE chapters
SET content = '<p>' || TRIM(BOTH '<p></p>' FROM (
        regexp_replace(
            regexp_replace(content, '^<p>|</p>$', '', 'g'),
            '([.!?…”"）)])\s+([A-ZÀÁẢÃẠÂẤẦẨẪẬĂẮẰẲẴẶÊẾỀỂỄỆÔỐỒỔỖỘƠỚỜỞỠỢÍÌỈĨỊÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ])',
            '\1</p><p>\2',
            'g'
        )
    )) || '</p>'
WHERE story_id = 'STORY_ID_CAN_SUA'
  AND (LENGTH(content) - LENGTH(REPLACE(content, '<p>', ''))) / 3 <= 1;

-- BƯỚC 3: Kiểm tra lại kết quả sau khi sửa
SELECT id, chapter_number, title,
       (LENGTH(content) - LENGTH(REPLACE(content, '<p>', ''))) / 3 AS so_doan_van
FROM chapters
WHERE story_id = 'STORY_ID_CAN_SUA'
ORDER BY chapter_number;
