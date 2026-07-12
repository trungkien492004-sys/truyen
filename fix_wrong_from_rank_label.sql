-- Hướng dẫn: Copy toàn bộ file này dán vào "SQL Editor" trên Supabase và bấm "Run".
-- Mục đích: các record rank_up_events cũ (do backfill_rank_up_today.sql tạo ra) bị hard-code
-- from_rank = 'Nhập môn' (SAI CHÍNH TẢ/THIẾU CHỮ so với tên thật trong rank_settings, ví dụ tên
-- thật là "Nhập môn ụ"). File này cập nhật lại from_rank cho ĐÚNG bằng tên bậc THẤP NHẤT
-- thật sự đang có trong rank_settings - lấy động, không gõ tay tên cụ thể.

-- BƯỚC 1: Xem trước tên bậc thấp nhất thật sự hiện tại (để xác nhận trước khi sửa)
SELECT label AS ten_bac_thap_nhat_dung, count
FROM rank_settings
ORDER BY count ASC
LIMIT 1;

-- BƯỚC 2: Sửa lại from_rank của các record hôm nay đang bị sai (khác với tên đúng ở trên)
-- thành đúng tên bậc thấp nhất thật sự lấy động từ rank_settings.
UPDATE rank_up_events
SET from_rank = (SELECT label FROM rank_settings ORDER BY count ASC LIMIT 1)
WHERE created_at::date = CURRENT_DATE
  AND from_rank <> (SELECT label FROM rank_settings ORDER BY count ASC LIMIT 1)
  AND from_rank NOT IN (SELECT label FROM rank_settings); -- chỉ sửa nếu from_rank hiện tại KHÔNG khớp bất kỳ rank thật nào (tức chắc chắn là data rác/sai)

-- BƯỚC 3: Kiểm tra lại toàn bộ record hôm nay sau khi sửa
SELECT rue.id, u.display_name, rue.from_rank, rue.to_rank, rue.rank_before_num, rue.rank_after_num, rue.created_at
FROM rank_up_events rue
JOIN users u ON u.id = rue.user_id
WHERE rue.created_at::date = CURRENT_DATE
ORDER BY rue.created_at DESC;
