const express = require('express');
const compression = require('compression');
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

// Kích hoạt nén gzip/brotli để tối ưu tốc độ load
app.use(compression());

// Cấu hình thư mục chứa file tĩnh (public)
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));



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
    
    // Badges mới
    if (v.includes('tân binh')) return 'game-title-common';
    if (v.includes('hiệp khách')) return 'game-title-rare';
    if (v.includes('tiên nhân') || v.includes('ma đạo')) return 'game-title-epic';
    if (v.includes('kiếm tôn')) return 'game-title-legendary game-title-swordmaster';
    if (v.includes('long vương')) return 'game-title-legendary game-title-dragonking';
    if (v.includes('sáng thế')) return 'game-title-mythic game-title-creator';
    if (v.includes('hỗn độn')) return 'game-title-mythic game-title-chaos';
    if (v.includes('vô cực')) return 'game-title-transcendent game-title-infinity';
    if (v.includes('thiên đạo quản trị') || v.includes('admin')) return 'game-title-transcendent game-title-admin-god';

    return 'game-title-default';
};

app.locals.getStarsByChapters = (chaptersRead) => {
    // Logic: Dựa vào số chương đọc để trả về số sao tương ứng (1 đến 5 sao)
    // Rank 1 (Mới Nhú/Xuất Sớm): 1 sao
    // Rank 2: 2 sao
    // Rank 3: 3 sao
    // Rank 4: 4 sao
    // Rank 5 & 6: 5 sao
    const count = parseInt(chaptersRead) || 0;
    
    if (count >= 1000) return '⭐⭐⭐⭐⭐'; // Huyền thoại / Vua
    if (count >= 500) return '⭐⭐⭐⭐';  // Cao thủ
    if (count >= 100) return '⭐⭐⭐';    // Thầy
    if (count >= 50) return '⭐⭐';      // Nhập môn
    return '⭐';                        // Xuất sớm / Người mới
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


app.locals.getBadgeIcon = (val) => {
    if (!val) return '💎';
    const v = val.toLowerCase();
    if (v.includes('rồng') || v.includes('long')) return '🐉';
    if (v.includes('kiếm')) return '⚔️';
    if (v.includes('ma')) return '👿';
    if (v.includes('tiên')) return '🧚';
    if (v.includes('thần') || v.includes('đế') || v.includes('chúa') || v.includes('vương') || v.includes('tôn')) return '👑';
    if (v.includes('sáng thế') || v.includes('vô cực')) return '🌌';
    if (v.includes('hỗn độn')) return '🌪️';
    if (v.includes('quản trị') || v.includes('admin')) return '⚙️';
    if (v.includes('hổ')) return '🐯';
    if (v.includes('tước') || v.includes('chim')) return '🦚';
    if (v.includes('rùa') || v.includes('vũ')) return '🐢';
    if (v.includes('đọc giả') || v.includes('tân binh')) return '📚';
    return '💎';
};

module.exports = app;
