-- Hướng dẫn: Copy toàn bộ file này dán vào "SQL Editor" trên Supabase và bấm "Run".
-- Mục đích: banner "Đột Phá Cảnh Giới" chỉ ghi nhận các lần lên rank xảy ra SAU khi tính năng
-- được thêm vào web. Nếu hôm nay có người đã lên rank TRƯỚC đó (nên không có record trong
-- rank_up_events), file này sẽ tự "bù" lại 1 record cho mỗi người ĐÃ ĐỌC HÔM NAY, dựa theo
-- rank hiện tại của họ - để banner hiện được ngay hôm nay dù sự kiện xảy ra sớm hơn.
--
-- AN TOÀN: chỉ chèn thêm cho user nào có last_read_date = hôm nay VÀ CHƯA có record nào
-- trong rank_up_events hôm nay (tránh tạo trùng nếu chạy lại nhiều lần).

INSERT INTO rank_up_events (user_id, from_rank, to_rank, created_at)
SELECT
  us.user_id,
  'Nhập môn', -- không biết chính xác rank trước đó nên ghi tạm "Nhập môn" làm mốc xuất phát
  (
    SELECT rs.label FROM rank_settings rs
    WHERE us.chapters_read >= rs.count
    ORDER BY rs.count DESC
    LIMIT 1
  ) AS to_rank,
  NOW()
FROM user_stats us
WHERE us.last_read_date = CURRENT_DATE
  AND EXISTS (
    SELECT 1 FROM rank_settings rs WHERE us.chapters_read >= rs.count
  )
  AND NOT EXISTS (
    SELECT 1 FROM rank_up_events rue
    WHERE rue.user_id = us.user_id
      AND rue.created_at::date = CURRENT_DATE
  );

-- Kiểm tra lại kết quả: các record vừa được thêm cho hôm nay
SELECT rue.id, u.display_name, rue.from_rank, rue.to_rank, rue.created_at
FROM rank_up_events rue
JOIN users u ON u.id = rue.user_id
WHERE rue.created_at::date = CURRENT_DATE
ORDER BY rue.created_at DESC;
