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

        // 1. Lấy Top 100 người dùng theo thứ tự BXH Độc giả (chapters_read desc, exp desc)
        const { data: topUsers, error: fetchErr } = await supabase
            .from('leaderboard_by_exp')
            .select('id, exp')
            .order('chapters_read', { ascending: false })
            .order('exp', { ascending: false })
            .limit(100);

        if (fetchErr) throw fetchErr;

        // 2. Lấy Top 100 người chơi BXH Game Đấu Trường Nữ Thần theo Elo
        const { data: topGameUsers, error: gameFetchErr } = await supabase
            .from('arena_ranks')
            .select('user_id, elo_points')
            .order('elo_points', { ascending: false })
            .limit(100);

        if (gameFetchErr) console.error('Lỗi lấy BXH Game arena_ranks:', gameFetchErr);

        // Cơ cấu giải thưởng BXH Độc giả
        const getReaderReward = (rank) => {
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

        // Cơ cấu giải thưởng BXH Game (Bằng nửa BXH Độc giả)
        const getGameReward = (rank) => {
            if (rank === 1) return 50;
            if (rank === 2) return 40;
            if (rank === 3) return 30;
            if (rank >= 4 && rank <= 5) return 20;
            if (rank >= 6 && rank <= 10) return 15;
            if (rank >= 11 && rank <= 20) return 10;
            if (rank >= 21 && rank <= 50) return 5;
            if (rank >= 51 && rank <= 100) return 3;
            return 0;
        };

        const notifications = [];
        const expAddMap = {};

        // Phân bổ phần thưởng BXH Độc giả
        if (topUsers && topUsers.length > 0) {
            for (let i = 0; i < topUsers.length; i++) {
                const rank = i + 1;
                const user = topUsers[i];
                const rewardExp = getReaderReward(rank);

                if (rewardExp > 0) {
                    notifications.push({
                        user_id: user.id,
                        message: `Chúc mừng bạn đạt Top ${rank} BXH Độc giả ngày hôm nay! Bạn nhận được ${rewardExp} EXP phần thưởng.`,
                        link: '/leaderboard',
                        is_read: false
                    });
                    expAddMap[user.id] = (expAddMap[user.id] || 0) + rewardExp;
                }
            }
        }

        // Phân bổ phần thưởng BXH Game Đấu Trường
        if (topGameUsers && topGameUsers.length > 0) {
            for (let i = 0; i < topGameUsers.length; i++) {
                const rank = i + 1;
                const gameUser = topGameUsers[i];
                const rewardExp = getGameReward(rank);

                if (rewardExp > 0 && gameUser.user_id) {
                    notifications.push({
                        user_id: gameUser.user_id,
                        message: `⚔️ Chúc mừng bạn đạt Top ${rank} BXH Đấu Trường Nữ Thần ngày hôm nay! Bạn nhận được ${rewardExp} EXP phần thưởng (bằng nửa BXH truyện).`,
                        link: '/leaderboard',
                        is_read: false
                    });
                    expAddMap[gameUser.user_id] = (expAddMap[gameUser.user_id] || 0) + rewardExp;
                }
            }
        }

        // 1. Lưu tất cả thông báo
        if (notifications.length > 0) {
            const { error: notifErr } = await supabase
                .from('notifications')
                .insert(notifications);
            if (notifErr) console.error('Error inserting notifications:', notifErr);
        }

        // 2. Cập nhật EXP trong user_stats (gộp thưởng nếu user nằm trong cả 2 BXH)
        const rewardedUserIds = Object.keys(expAddMap);
        if (rewardedUserIds.length > 0) {
            const { data: curStats } = await supabase
                .from('user_stats')
                .select('user_id, exp')
                .in('user_id', rewardedUserIds);

            const statMap = {};
            (curStats || []).forEach(s => { statMap[s.user_id] = s.exp || 0; });

            const updatePromises = rewardedUserIds.map(uid => {
                const curExp = statMap[uid] || 0;
                const added = expAddMap[uid] || 0;
                return supabase
                    .from('user_stats')
                    .update({ exp: curExp + added, updated_at: new Date().toISOString() })
                    .eq('user_id', uid);
            });
            await Promise.all(updatePromises);
        }

        return res.status(200).json({ 
            success: true, 
            message: `Rewarded ${rewardedUserIds.length} users successfully (Reader + Game Leaderboard).` 
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

// Vercel Cron / Local Endpoint: /api/cron/sync-all-sources
router.get('/sync-all-sources', async (req, res) => {
    try {
        const { syncAllActiveStories } = require('../services/autoCrawler');
        
        // Chạy bất đồng bộ để tránh bị timeout (hoặc đồng bộ tùy Vercel Serverless limit)
        syncAllActiveStories()
            .then(result => console.log('[CRON-CRAWLER] Auto-sync finished:', result))
            .catch(err => console.error('[CRON-CRAWLER] Auto-sync failed:', err));

        return res.status(200).json({
            success: true,
            message: 'Đã kích hoạt tiến trình tự động quét và cào chương mới cho tất cả các truyện có link nguồn.'
        });
    } catch (error) {
        console.error('Error in sync-all-sources cron:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// Vercel Cron / Local Endpoint: /api/cron/check-old-supabase-migration
// Tự động kiểm tra và ngay khi Supabase cũ mở khóa băng thông, lập tức kéo toàn bộ ảnh về Supabase mới
router.get('/check-old-supabase-migration', async (req, res) => {
    try {
        const { runAutoMigration } = require('../services/supabaseMigration');
        const result = await runAutoMigration();
        return res.status(200).json(result);
    } catch (error) {
        console.error('Error in check-old-supabase-migration cron:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

