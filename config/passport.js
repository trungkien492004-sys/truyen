const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const supabase = require('./supabase');
require('dotenv').config();

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'dummy_id',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy_secret',
    callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback'
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
      if (!email) {
        return done(new Error('Tài khoản Google không có Email khả dụng.'), null);
      }

      const googleId = profile.id;
      const displayName = profile.displayName || profile.username || 'Độc giả';
      const avatar = '/css/silly_duck.png'; // Luôn dùng Vịt Vàng làm avatar tân thủ

      // 1. Tìm xem người dùng đã tồn tại trong database chưa
      const { data: existingUser, error: findError } = await supabase
        .from('users')
        .select('*')
        .eq('google_id', googleId)
        .maybeSingle();

      if (findError) {
        console.error('Lỗi khi truy vấn user từ Supabase:', findError);
        return done(findError, null);
      }

      if (existingUser) {
        return done(null, existingUser);
      }

      // 2. Nếu chưa tồn tại, tạo mới user
      // Kiểm tra xem email có khớp với ADMIN_EMAIL cấu hình trong .env hay không
      const adminEmailConfig = process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL.toLowerCase().trim() : '';
      const role = (email.toLowerCase().trim() === adminEmailConfig) ? 'admin' : 'reader';

      const { data: newUser, error: insertError } = await supabase
        .from('users')
        .insert([
          {
            google_id: googleId,
            display_name: displayName,
            email: email,
            avatar: avatar,
            role: role
          }
        ])
        .select('*')
        .single();

      if (insertError) {
        console.error('Lỗi tạo user mới trên Supabase:', insertError);
        return done(insertError, null);
      }

      console.log(`Đã tạo tài khoản người dùng mới: ${displayName} (${role})`);
      return done(null, newUser);

    } catch (err) {
      console.error('Lỗi trong tiến trình xác thực Google Passport:', err);
      return done(err, null);
    }
  }
));

// Lưu thông tin user vào Session (ở đây là google_id)
passport.serializeUser((user, done) => {
  done(null, user.google_id);
});

// In-memory cache cho user session (TTL: 5 phút) để tối ưu tốc độ và chống đứt phiên đăng nhập khi Supabase chập chờn
const userSessionCache = new Map(); // google_id -> { user, expiresAt }

// Lấy thông tin user từ Session
passport.deserializeUser(async (googleId, done) => {
  try {
    const now = Date.now();
    const cached = userSessionCache.get(googleId);
    if (cached && cached.expiresAt > now) {
      return done(null, cached.user);
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('google_id', googleId)
      .maybeSingle();

    if (error) {
      console.warn('Lỗi Supabase khi nạp user session:', error.message);
      // Nếu có cache cũ (kể cả đã quá hạn), vẫn dùng lại để tránh ngắt session người dùng
      if (cached && cached.user) {
        return done(null, cached.user);
      }
      return done(null, false);
    }

    if (!user) {
      userSessionCache.delete(googleId);
      return done(null, false);
    }

    // Cập nhật cache 5 phút
    userSessionCache.set(googleId, {
      user,
      expiresAt: now + 5 * 60 * 1000
    });

    done(null, user);
  } catch (err) {
    console.error('Lỗi deserializeUser:', err);
    const cached = userSessionCache.get(googleId);
    if (cached && cached.user) {
      return done(null, cached.user);
    }
    done(null, false);
  }
});

module.exports = passport;
