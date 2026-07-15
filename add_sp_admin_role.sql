-- Bước 1: Xóa constraint cũ giới hạn role chỉ có 'reader' và 'admin'
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- Bước 2: Thêm constraint mới có thêm 'sp_admin'
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('reader', 'admin', 'sp_admin'));

-- Bước 3: Cập nhật role cho 2 user chỉ định
UPDATE users 
SET role = 'sp_admin' 
WHERE email IN ('trungkien49494949@gmail.com', 'duapham911@gmail.com');

-- Kiểm tra kết quả
SELECT id, email, role FROM users WHERE email IN ('trungkien49494949@gmail.com', 'duapham911@gmail.com');
