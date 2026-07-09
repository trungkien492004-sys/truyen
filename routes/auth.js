const express = require('express');
const passport = require('passport');
const router = express.Router();

// Trang Đăng nhập
router.get('/login', (req, res) => {
  if (req.isAuthenticated()) {
    return res.redirect('/');
  }
  res.render('login', { user: null, title: 'Đăng nhập' });
});

// Kích hoạt xác thực Google
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// Nhận Callback từ Google gửi về
router.get('/google/callback', 
  passport.authenticate('google', { failureRedirect: '/auth/login' }),
  (req, res) => {
    // Đăng nhập thành công, chuyển hướng về trang chủ
    console.log(`Độc giả đăng nhập thành công: ${req.user.display_name}`);
    res.redirect('/');
  }
);

// Đăng xuất
router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    res.redirect('/');
  });
});

module.exports = router;
