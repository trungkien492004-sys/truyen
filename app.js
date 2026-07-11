const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');
const cookieParser = require('cookie-parser');
const passport = require('./config/passport');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình View Engine là EJS
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Middleware xử lý dữ liệu đầu vào (Tăng giới hạn lên 50mb để nhận nội dung truyện lớn từ client)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(cookieParser());

// Cấu hình trust proxy để Express nhận biết HTTPS đứng sau proxy của Vercel
app.set('trust proxy', 1);

// Cấu hình Cookie-Session thay thế cho Express-Session để hoạt động stateless trên Vercel Serverless
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'session_secret_fallback_key'],
  maxAge: 24 * 60 * 60 * 1000, // Cookie tồn tại trong 24 giờ
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax'
}));

// Middleware vá lỗi tương thích giữa passport v0.6+ và cookie-session (do cookie-session không có hàm regenerate và save)
app.use((req, res, next) => {
  if (req.session && !req.session.regenerate) {
    req.session.regenerate = (cb) => cb();
  }
  if (req.session && !req.session.save) {
    req.session.save = (cb) => cb();
  }
  next();
});

// Khởi tạo Passport
app.use(passport.initialize());
app.use(passport.session());

// Cấu hình thư mục chứa file tĩnh (public)
app.use(express.static(path.join(__dirname, 'public')));



// Global Helper for EJS
app.locals.getTitleRarityClass = (val) => {
    if (!val) return 'game-title-default';
    const v = val.toLowerCase();
    
    if (v.includes('admin') || v.includes('quản trị')) return 'game-title-mythic';
    if (v.includes('long') || v.includes('rồng') || v.includes('dragon')) return 'game-title-dragon';
    if (v.includes('kiếm') || v.includes('sword') || v.includes('độc cô')) return 'game-title-sword';
    if (v.includes('ma') || v.includes('quỷ') || v.includes('demon')) return 'game-title-demon';
    if (v.includes('thiên') || v.includes('angel') || v.includes('thần') || v.includes('tiên') || v.includes('sứ')) return 'game-title-angel';
    if (v.includes('thần thoại') || v.includes('vô cực') || v.includes('đế') || v.includes('hoàng') || v.includes('chúa') || v.includes('tôn')) return 'game-title-mythic';
    if (v.includes('cyber') || v.includes('máy') || v.includes('đọc') || v.includes('sách')) return 'game-title-cyber';
    if (v.includes('tinh hà') || v.includes('vũ trụ') || v.includes('galaxy') || v.includes('sao')) return 'game-title-galaxy';
    if (v.includes('hoa') || v.includes('sakura') || v.includes('đào')) return 'game-title-sakura';
    if (v.includes('noel') || v.includes('giáng sinh') || v.includes('tuyết')) return 'game-title-noel';
    if (v.includes('halloween') || v.includes('bí ngô') || v.includes('ma cà rồng')) return 'game-title-halloween';
    
    return 'game-title-default';
};

// ĐĂNG KÝ CÁC TUYẾN ĐƯỜNG DẪN (ROUTES)
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const indexRoutes = require('./routes/index');
const cronRoutes = require('./routes/cron');

app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);
app.use('/api/cron', cronRoutes);
app.use('/', indexRoutes); // Router này đặt cuối cùng để tránh xung đột định tuyến

// Xử lý lỗi 404 (Không tìm thấy trang)
app.use((req, res, next) => {
  res.status(404).send('Không tìm thấy trang yêu cầu (404 Not Found).');
});

// Khởi chạy Server khi chạy trực tiếp qua node
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`Ứng dụng đọc truyện đang chạy tại: http://localhost:${PORT}`);
    console.log(`Cổng cấu hình: ${PORT}`);
    console.log(`Hãy đảm bảo bạn đã chạy file schema.sql trên Supabase.`);
    console.log(`==================================================`);
  });
}

module.exports = app;
