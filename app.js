const express = require('express');
const session = require('express-session');
const path = require('path');
const cookieParser = require('cookie-parser');
const passport = require('./config/passport');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình View Engine là EJS
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware xử lý dữ liệu đầu vào
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Cấu hình Session cho xác thực Passport
app.use(session({
  secret: process.env.SESSION_SECRET || 'a_very_secret_key_change_me_in_production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set là true nếu chạy trên HTTPS
    maxAge: 24 * 60 * 60 * 1000 // Session tồn tại trong 1 ngày
  }
}));

// Khởi tạo Passport
app.use(passport.initialize());
app.use(passport.session());

// Cấu hình thư mục chứa file tĩnh (public)
app.use(express.static(path.join(__dirname, 'public')));

// Khởi tạo các file ảnh tĩnh mặc định phòng trường hợp chưa upload
const defaultCoverPath = path.join(__dirname, 'public/css/default-cover.jpg');
const defaultAvatarPath = path.join(__dirname, 'public/css/default-avatar.png');
const fs = require('fs');

// Đảm bảo thư mục css tồn tại
const cssDir = path.join(__dirname, 'public/css');
if (!fs.existsSync(cssDir)) {
  fs.mkdirSync(cssDir, { recursive: true });
}

// Nếu chưa có ảnh bìa mặc định, tạo một ảnh bìa giả dạng màu xám
if (!fs.existsSync(defaultCoverPath)) {
  // Tạo file đơn giản
  fs.writeFileSync(defaultCoverPath, ''); 
}
// Nếu chưa có ảnh đại diện mặc định, tạo file giả
if (!fs.existsSync(defaultAvatarPath)) {
  fs.writeFileSync(defaultAvatarPath, '');
}

// ĐĂNG KÝ CÁC TUYẾN ĐƯỜNG DẪN (ROUTES)
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const indexRoutes = require('./routes/index');

app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/', indexRoutes); // Router này đặt cuối cùng để tránh xung đột định tuyến

// Xử lý lỗi 404 (Không tìm thấy trang)
app.use((req, res, next) => {
  res.status(404).send('Không tìm thấy trang yêu cầu (404 Not Found).');
});

// Khởi chạy Server
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`Ứng dụng đọc truyện đang chạy tại: http://localhost:${PORT}`);
  console.log(`Cổng cấu hình: ${PORT}`);
  console.log(`Hãy đảm bảo bạn đã chạy file schema.sql trên Supabase.`);
  console.log(`==================================================`);
});
