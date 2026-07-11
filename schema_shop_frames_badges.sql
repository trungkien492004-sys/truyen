-- Hướng dẫn: Copy đoạn mã này dán vào "SQL Editor" trên Supabase và bấm "Run".
-- File này thêm vài mẫu KHUNG AVATAR + HUY HIỆU mới vào cửa hàng EXP (shop_items),
-- tận dụng các class CSS đẹp đã có sẵn trong public/css/style.css (mythic, galaxy, dragon_emperor, sword_saint, angel, demon...)
-- nhưng trước đó chưa có dòng dữ liệu nào bán chúng trong shop.

-- ===== KHUNG VIỀN (type = 'frame') =====
-- Lưu ý: cột "value" của frame phải trùng đúng tên class CSS (vd: .avatar-frame.mythic trong style.css)
-- Đã rà soát: 'angel' trùng khung Thiên Thần có sẵn (hoa mỹ/nữ tính) -> đổi Thiên Sứ sang 'seraph' (uy nghiêm hơn)
-- 'cyber' trùng CSS cũ -> dùng bản mới 'cyber_v2' (phong cách công nghệ sắc lạnh, cơ khí)
INSERT INTO shop_items (name, type, price_exp, description, value) VALUES
('Khung Thần Thoại', 'frame', 500, 'Khung viền cầu vồng huyền ảo, hiệu ứng hào quang xoay liên tục - dành cho độc giả huyền thoại.', 'mythic'),
('Khung Tinh Hà', 'frame', 350, 'Khung viền lấp lánh như dải ngân hà, phù hợp người yêu thích vũ trụ bao la.', 'galaxy'),
('Khung Long Đế', 'frame', 400, 'Khung viền uy nghiêm sắc vàng-đỏ của bậc đế vương rồng thiêng.', 'dragon_emperor'),
('Khung Kiếm Thánh', 'frame', 400, 'Khung viền ánh kim sắc bén, tôn vinh những cao thủ kiếm đạo.', 'sword_saint'),
('Khung Thiên Sứ', 'frame', 250, 'Khung viền ánh sáng thánh khiết uy nghiêm, sức mạnh của bậc thiên sứ chiến binh.', 'seraph'),
('Khung Ma Vương', 'frame', 250, 'Khung viền bóng tối huyền bí, dành cho những kẻ chinh phục bóng đêm.', 'demon'),
('Khung Băng Giá', 'frame', 200, 'Khung viền lạnh lẽo tinh khiết như băng tuyết vĩnh cửu.', 'ice'),
('Khung Hỏa Diệm', 'frame', 200, 'Khung viền rực lửa nóng bỏng, thể hiện nhiệt huyết đọc truyện không ngừng.', 'fire'),
('Khung Chiến Cơ', 'frame', 300, 'Khung viền công nghệ cao, quét tia sáng liên tục theo phong cách cơ khí tương lai.', 'cyber_v2'),
('Khung Thép Đen', 'frame', 280, 'Khung viền kim loại xám đen sắc lạnh, phong cách chiến binh mạnh mẽ.', 'dark_steel'),
('Khung Long Nham Thạch', 'frame', 380, 'Khung viền đỏ cam rực lửa, mang sức mạnh của rồng lửa cổ đại.', 'magma_dragon'),
('Khung Pha Lê Băng', 'frame', 280, 'Khung viền trắng xanh pha lê, thanh thoát và tinh khiết.', 'ice_crystal'),
('Khung Hoàng Kim Hồng', 'frame', 320, 'Khung viền hồng vàng sang trọng, mềm mại và quý phái.', 'rose_gold')
;

-- ===== HUY HIỆU CHAT (type = 'badge') =====
-- Lưu ý: cột "value" là TÊN HIỂN THỊ của huy hiệu, hệ thống sẽ tự nhận diện rarity/icon
-- dựa theo từ khóa trong tên (xem app.js: getTitleRarityClass, getBadgeIcon)
INSERT INTO shop_items (name, type, price_exp, description, value) VALUES
('Huy hiệu Tân Binh', 'badge', 0, 'Huy hiệu khởi đầu cho mọi độc giả mới gia nhập.', 'Tân Binh'),
('Huy hiệu Hiệp Khách', 'badge', 100, 'Dành cho độc giả đã có kinh nghiệm chinh chiến giữa các trang truyện.', 'Hiệp Khách'),
('Huy hiệu Tiên Nhân', 'badge', 300, 'Đạt tới cảnh giới tu luyện đọc truyện, thoát tục thành tiên.', 'Tiên Nhân'),
('Huy hiệu Kiếm Tôn', 'badge', 450, 'Bậc thầy kiếm đạo, danh tiếng lẫy lừng khắp giang hồ đọc giả.', 'Kiếm Tôn'),
('Huy hiệu Long Vương', 'badge', 450, 'Vị vua của loài rồng, tượng trưng cho quyền uy tối thượng.', 'Long Vương'),
('Huy hiệu Sáng Thế', 'badge', 700, 'Đấng sáng tạo nên vạn vật, đứng trên tất cả các cảnh giới thông thường.', 'Sáng Thế'),
('Huy hiệu Hỗn Độn', 'badge', 700, 'Hiện thân của hỗn mang nguyên thủy, sức mạnh vượt ngoài tưởng tượng.', 'Hỗn Độn'),
('Huy hiệu Vô Cực', 'badge', 999, 'Cảnh giới cao nhất - vượt qua mọi giới hạn của EXP và thời gian.', 'Vô Cực')
;
