const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// Vercel Cron Endpoint: /api/cron/daily-reward
router.get('/daily-reward', async (req, res) => {
    try {
        // Kiểm tra CRON_SECRET để bảo mật
        const authHeader = req.headers.authorization;
        const cronSecret = process.env.CRON_SECRET;
        
        if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Lấy Top 100 người dùng theo thứ tự BXH hiển thị (chapters_read desc, exp desc)
        // - Phải dùng cùng view và sort order với trang /leaderboard để phần thưởng
        //   khớp chính xác với thứ hạng người dùng nhìn thấy trên màn hình.
        // - View leaderboard_by_exp expose 'id' (= user id), không phải 'user_id'
        const { data: topUsers, error: fetchErr } = await supabase
            .from('leaderboard_by_exp')
            .select('id, exp')
            .order('chapters_read', { ascending: false })
            .order('exp', { ascending: false })
            .limit(100);

        if (fetchErr) throw fetchErr;
        if (!topUsers || topUsers.length === 0) {
            return res.status(200).json({ message: 'No users found.' });
        }

        // Cơ cấu giải thưởng
        const getReward = (rank) => {
            if (rank === 1) return 100;
            if (rank === 2) return 80;
            if (rank === 3) return 60;
            if (rank >= 4 && rank <= 5) return 40;
            if (rank >= 6 && rank <= 10) return 30;
            if (rank >= 11 && rank <= 20) return 20;
            if (rank >= 21 && rank <= 50) return 10;
            if (rank >= 51 && rank <= 100) return 5;
            return 0;
        };

        const notifications = [];
        const expUpdates = [];

        // Duyệt qua từng người dùng để phân bổ phần thưởng
        for (let i = 0; i < topUsers.length; i++) {
            const rank = i + 1;
            const user = topUsers[i];
            const rewardExp = getReward(rank);

            if (rewardExp > 0) {
                // Chuẩn bị payload thông báo
                notifications.push({
                    user_id: user.id,
                    message: `Chúc mừng bạn đạt Top ${rank} BXH Độc giả ngày hôm nay! Bạn nhận được ${rewardExp} EXP phần thưởng.`,
                    link: '/leaderboard',
                    is_read: false
                });

                // Chuẩn bị thông tin cập nhật EXP
                expUpdates.push({
                    user_id: user.id,
                    exp: user.exp + rewardExp,
                    updated_at: new Date().toISOString()
                });
            }
        }


        // 1. Lưu tất cả thông báo
        if (notifications.length > 0) {
            const { error: notifErr } = await supabase
                .from('notifications')
                .insert(notifications);
            if (notifErr) console.error('Error inserting notifications:', notifErr);
        }

        // 2. Cập nhật tất cả điểm EXP
        // Supabase/PostgreSQL không hỗ trợ bulk update dễ dàng bằng RPC nếu không viết sẵn hàm.
        // Ta dùng vòng lặp Promise.all vì số lượng là <= 100 (khá nhanh).
        const updatePromises = expUpdates.map(update => 
            supabase
                .from('user_stats')
                .update({ exp: update.exp, updated_at: update.updated_at })
                .eq('user_id', update.user_id)
        );
        
        await Promise.all(updatePromises);

        return res.status(200).json({ 
            success: true, 
            message: `Rewarded ${expUpdates.length} users successfully.` 
        });

    } catch (error) {
        console.error('Error in daily-reward cron:', error);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Vercel Cron / Local Endpoint: /api/cron/sync-donghentai
router.get('/sync-donghentai', async (req, res) => {
    try {
        const { syncLatestDongHentai } = require('../services/donghentaiCrawler');
        const pages = parseInt(req.query.pages) || 3;
        
        // Chạy bất đồng bộ để không timeout request
        syncLatestDongHentai(pages).catch(err => console.error('Cron crawler err:', err));

        return res.status(200).json({
            success: true,
            message: `Đã kích hoạt tiến trình tự động cào và cập nhật chương mới nhất (quét ${pages} trang gần đây).`
        });
    } catch (error) {
        console.error('Error in sync-donghentai cron:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
