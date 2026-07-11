-- Hướng dẫn: Copy toàn bộ file này dán vào "SQL Editor" trên Supabase và bấm "Run".
-- File này dọn các item bị TRÙNG LẶP trong bảng shop_items (do lỡ chạy insert 2 lần),
-- đồng thời cập nhật lại value cho đúng bản mới nhất (seraph, cyber_v2) nếu còn sót bản cũ (angel).
-- AN TOÀN: chỉ xóa các dòng trùng tên, giữ lại đúng 1 dòng có id nhỏ nhất cho mỗi tên.
-- Nếu người dùng đã lỡ MUA/trang bị item bị xóa (id lớn), user_inventory sẽ tự trỏ sang item còn lại
-- ở bước UPDATE bên dưới trước khi xóa, nên không mất dữ liệu đã mua.

-- BƯỚC 1: Với mỗi nhóm tên bị trùng, chuyển toàn bộ user_inventory đang trỏ vào các id "thừa"
-- sang trỏ về id "gốc" (nhỏ nhất) của tên đó, để không ai bị mất vật phẩm đã mua.
WITH dup AS (
  SELECT id, name,
         MIN(id) OVER (PARTITION BY name) AS keep_id
  FROM shop_items
)
UPDATE user_inventory ui
SET item_id = dup.keep_id
FROM dup
WHERE ui.item_id = dup.id
  AND dup.id <> dup.keep_id;

-- BƯỚC 2: Xóa các dòng trùng lặp (giữ lại id nhỏ nhất mỗi tên)
WITH dup AS (
  SELECT id, name,
         MIN(id) OVER (PARTITION BY name) AS keep_id
  FROM shop_items
)
DELETE FROM shop_items
WHERE id IN (
  SELECT id FROM dup WHERE id <> keep_id
);

-- BƯỚC 3: Đảm bảo value đúng bản mới nhất (phòng trường hợp bản giữ lại là bản cũ 'angel')
UPDATE shop_items SET value = 'seraph' WHERE name = 'Khung Thiên Sứ';
UPDATE shop_items SET value = 'cyber_v2' WHERE name = 'Khung Chiến Cơ';

-- BƯỚC 4 (kiểm tra): xem còn dòng nào trùng tên không (kết quả phải RỖNG)
SELECT name, COUNT(*) FROM shop_items GROUP BY name HAVING COUNT(*) > 1;
