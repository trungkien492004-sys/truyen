-- BƯỚC 1: Chạy câu này TRƯỚC để xem dữ liệu thật đang lưu (không sửa gì cả, chỉ xem)
SELECT id, name, type, value, price_exp FROM shop_items
WHERE name IN ('Khung Thép Đen', 'Khung Long Nham Thạch', 'Khung Pha Lê Băng', 'Khung Hoàng Kim Hồng')
ORDER BY id;

-- Đọc kết quả cột "type": nếu thấy giá trị KHÔNG PHẢI 'frame' (ví dụ 'avatar' hoặc rỗng),
-- đó chính là nguyên nhân khung hiện sai chỗ. Chạy tiếp BƯỚC 2 bên dưới để sửa.

-- BƯỚC 2: Ép type về đúng 'frame' cho 4 item này (an toàn, chỉ update field type)
UPDATE shop_items
SET type = 'frame'
WHERE name IN ('Khung Thép Đen', 'Khung Long Nham Thạch', 'Khung Pha Lê Băng', 'Khung Hoàng Kim Hồng');

-- BƯỚC 3: Kiểm tra lại sau khi sửa (phải thấy type = 'frame' cho cả 4 dòng)
SELECT id, name, type, value FROM shop_items
WHERE name IN ('Khung Thép Đen', 'Khung Long Nham Thạch', 'Khung Pha Lê Băng', 'Khung Hoàng Kim Hồng')
ORDER BY id;
