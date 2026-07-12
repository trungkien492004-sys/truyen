-- Hướng dẫn: Copy toàn bộ file này dán vào "SQL Editor" trên Supabase và bấm "Run".
-- Mục đích: file fix_fake_rankup_events.sql lần trước xóa nhầm điều kiện (chỉ xóa khi
-- from_rank = to_rank giống hệt nhau), nhưng dữ liệu rác thực tế là from_rank="Nhập môn"
-- khác to_rank="Xuất sớm" (2 CHỮ KHÁC NHAU) - trong khi "Xuất sớm" mới chính là bậc THẤP NHẤT
-- trong rank_settings, nghĩa là user đó CHƯA HỀ đột phá lên đâu cả, chỉ là record rác.
-- File này xóa đúng: mọi record hôm nay có to_rank = tên bậc thấp nhất hiện tại.

-- BƯỚC 1: Xem trước bậc thấp nhất hiện tại (để bạn xác nhận trước khi xóa)
SELECT label AS bac_thap_nhat, count
FROM rank_settings
ORDER BY count ASC
LIMIT 1;

-- BƯỚC 2: Xóa các record rác hôm nay có to_rank = TÊN BẬC THẤP NHẤT (tức không hề đột phá thật)
DELETE FROM rank_up_events
WHERE created_at::date = CURRENT_DATE
  AND to_rank = (SELECT label FROM rank_settings ORDER BY count ASC LIMIT 1);

-- BƯỚC 3: Kiểm tra lại kết quả cuối cùng cho hôm nay - chỉ còn người THỰC SỰ đột phá
SELECT rue.id, u.display_name, rue.from_rank, rue.to_rank, rue.rank_before_num, rue.rank_after_num, rue.created_at
FROM rank_up_events rue
JOIN users u ON u.id = rue.user_id
WHERE rue.created_at::date = CURRENT_DATE
ORDER BY rue.created_at DESC;
