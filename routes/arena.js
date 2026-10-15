const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// Middleware yêu cầu đăng nhập để vào Đấu Trường
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  return res.redirect('/auth/login?redirect=' + encodeURIComponent('/arena'));
}

router.use(requireAuth);

// Helper: Khởi tạo dữ liệu người chơi mới nếu chưa có
async function ensureUserArenaData(userId) {
  // 1. Kiểm tra Rank
  let { data: rank } = await supabase
    .from('arena_ranks')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!rank) {
    const { data: newRank } = await supabase
      .from('arena_ranks')
      .insert([{
        user_id: userId,
        elo_points: 1000,
        tier: 'Đồng',
        wins: 0,
        losses: 0,
        daily_tickets: 5
      }])
      .select()
      .single();
    rank = newRank;
  } else {
    // Reset vé hàng ngày nếu qua ngày mới
    const now = new Date();
    const lastReset = new Date(rank.last_ticket_reset || 0);
    if (now.toDateString() !== lastReset.toDateString()) {
      await supabase
        .from('arena_ranks')
        .update({ daily_tickets: 5, last_ticket_reset: now.toISOString() })
        .eq('user_id', userId);
      rank.daily_tickets = 5;
    }
  }

  // 2. Kiểm tra Túi đồ
  let { data: items } = await supabase
    .from('user_card_items')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!items) {
    const { data: newItems } = await supabase
      .from('user_card_items')
      .insert([{
        user_id: userId,
        wooden_chests: 2,
        silver_chests: 1,
        gold_chests: 0,
        exp_pills: 50,
        star_stones: 5
      }])
      .select()
      .single();
    items = newItems;
  }

  // 3. Kiểm tra Tướng sở hữu (tặng ngay Bạch Dao R và 20 mảnh Cố Thanh Y làm quà tân thủ)
  const { data: userHeroes } = await supabase
    .from('user_heroes')
    .select('*')
    .eq('user_id', userId);

  if (!userHeroes || userHeroes.length === 0) {
    // Tặng Bạch Dao (id: 4) đã mở khóa
    const { data: bachDao } = await supabase.from('card_heroes').select('id').eq('name', 'Bạch Dao').single();
    const { data: coThanhY } = await supabase.from('card_heroes').select('id').eq('name', 'Cố Thanh Y').single();

    if (bachDao) {
      await supabase.from('user_heroes').insert([{
        user_id: userId,
        hero_id: bachDao.id,
        is_unlocked: true,
        shards: 0,
        level: 1,
        star: 1
      }]);
    }
    if (coThanhY) {
      await supabase.from('user_heroes').insert([{
        user_id: userId,
        hero_id: coThanhY.id,
        is_unlocked: false,
        shards: 20, // cần thêm 10 mảnh để mở khóa
        level: 1,
        star: 1
      }]);
    }
  }

  // 4. Kiểm tra Đội hình
  let { data: team } = await supabase
    .from('user_card_teams')
    .select('*, slot1:slot_1(id, name, title, avatar_url, card_image_url, rarity, element, base_hp, base_atk, base_def, base_spd, skill_basic, skill_ultimate, skill_passive), slot2:slot_2(id, name, title, avatar_url, card_image_url, rarity, element, base_hp, base_atk, base_def, base_spd, skill_basic, skill_ultimate, skill_passive), slot3:slot_3(id, name, title, avatar_url, card_image_url, rarity, element, base_hp, base_atk, base_def, base_spd, skill_basic, skill_ultimate, skill_passive)')
    .eq('user_id', userId)
    .single();

  if (!team) {
    // Tự động xếp tướng đầu tiên có vào slot_1
    const { data: firstHero } = await supabase
      .from('user_heroes')
      .select('hero_id')
      .eq('user_id', userId)
      .eq('is_unlocked', true)
      .limit(1)
      .single();

    const heroId = firstHero ? firstHero.hero_id : null;
    await supabase
      .from('user_card_teams')
      .insert([{
        user_id: userId,
        slot_1: heroId,
        combat_power: 1500
      }]);

    const { data: refTeam } = await supabase
      .from('user_card_teams')
      .select('*, slot1:slot_1(id, name, title, avatar_url, card_image_url, rarity, element, base_hp, base_atk, base_def, base_spd, skill_basic, skill_ultimate, skill_passive), slot2:slot_2(id, name, title, avatar_url, card_image_url, rarity, element, base_hp, base_atk, base_def, base_spd, skill_basic, skill_ultimate, skill_passive), slot3:slot_3(id, name, title, avatar_url, card_image_url, rarity, element, base_hp, base_atk, base_def, base_spd, skill_basic, skill_ultimate, skill_passive)')
      .eq('user_id', userId)
      .single();
    team = refTeam;
  }

  return { rank, items, team };
}

// 1. TRANG CHÍNH ĐẤU TRƯỜNG & WAIFU HUB
router.get('/', async (req, res) => {
  const userId = req.user.id;
  try {
    const { rank, items, team } = await ensureUserArenaData(userId);

    // Lấy toàn bộ tướng game + thông tin sở hữu của user
    const { data: allHeroes } = await supabase
      .from('card_heroes')
      .select('*')
      .order('id', { ascending: true });

    const { data: userHeroes } = await supabase
      .from('user_heroes')
      .select('*')
      .eq('user_id', userId);

    const userHeroMap = {};
    (userHeroes || []).forEach(uh => {
      userHeroMap[uh.hero_id] = uh;
    });

    const heroesList = (allHeroes || []).map(h => {
      const owned = userHeroMap[h.id];
      return {
        ...h,
        is_unlocked: owned ? owned.is_unlocked : false,
        shards: owned ? owned.shards : 0,
        level: owned ? owned.level : 1,
        star: owned ? owned.star : 1,
        exp: owned ? owned.exp : 0,
        // Tính chỉ số sau khi nhân level và star
        hp: Math.round(h.base_hp * (1 + ((owned ? owned.level : 1) - 1) * 0.1) * (1 + ((owned ? owned.star : 1) - 1) * 0.2)),
        atk: Math.round(h.base_atk * (1 + ((owned ? owned.level : 1) - 1) * 0.1) * (1 + ((owned ? owned.star : 1) - 1) * 0.2)),
        def: Math.round(h.base_def * (1 + ((owned ? owned.level : 1) - 1) * 0.08)),
        spd: h.base_spd,
        crit: h.base_crit
      };
    });

    // Lấy danh sách 4 đối thủ tiềm năng gần Elo của user (ngoại trừ bản thân)
    const { data: opponentsRaw } = await supabase
      .from('arena_ranks')
      .select('user_id, elo_points, tier, wins, losses, users(id, display_name, avatar)')
      .neq('user_id', userId)
      .order('elo_points', { ascending: false })
      .limit(6);

    // Lấy đội hình của các đối thủ
    const opponentUserIds = (opponentsRaw || []).map(o => o.user_id);
    let opponentTeamsMap = {};
    if (opponentUserIds.length > 0) {
      const { data: oppTeams } = await supabase
        .from('user_card_teams')
        .select('user_id, combat_power, slot1:slot_1(id, name, avatar_url, rarity), slot2:slot_2(id, name, avatar_url, rarity), slot3:slot_3(id, name, avatar_url, rarity)')
        .in('user_id', opponentUserIds);

      (oppTeams || []).forEach(t => {
        opponentTeamsMap[t.user_id] = t;
      });
    }

    const opponents = (opponentsRaw || []).map(o => ({
      ...o,
      team: opponentTeamsMap[o.user_id] || { combat_power: 1200, slot1: null, slot2: null, slot3: null }
    }));

    // Lấy Top 20 BXH Đấu trường
    const { data: leaderboard } = await supabase
      .from('arena_ranks')
      .select('user_id, elo_points, tier, wins, losses, users(id, display_name, avatar)')
      .order('elo_points', { ascending: false })
      .limit(20);

    res.render('arena/index', {
      title: '⚔️ Đấu Trường Nữ Thần - Waifu Arena',
      user: req.user,
      rank,
      items,
      team,
      heroes: heroesList,
      opponents,
      leaderboard: leaderboard || []
    });
  } catch (err) {
    console.error('Lỗi tải trang Đấu Trường:', err);
    res.status(500).send('Lỗi khi tải Đấu Trường Nữ Thần: ' + err.message);
  }
});

// 2. API CẬP NHẬT ĐỘI HÌNH
router.post('/api/set-team', async (req, res) => {
  const userId = req.user.id;
  const { slot_1, slot_2, slot_3 } = req.body;

  try {
    // Kiểm tra tướng có thuộc quyền sở hữu của user và đã mở khóa chưa
    const heroIds = [slot_1, slot_2, slot_3].filter(Boolean).map(id => parseInt(id));
    if (heroIds.length > 0) {
      const { data: ownedHeroes } = await supabase
        .from('user_heroes')
        .select('hero_id')
        .eq('user_id', userId)
        .eq('is_unlocked', true)
        .in('hero_id', heroIds);

      const ownedSet = new Set((ownedHeroes || []).map(h => h.hero_id));
      for (const hid of heroIds) {
        if (!ownedSet.has(hid)) {
          return res.status(400).json({ success: false, error: 'Bạn chưa mở khóa tướng này!' });
        }
      }
    }

    // Tính sơ bộ tổng lực chiến
    const { data: heroStats } = await supabase
      .from('card_heroes')
      .select('id, base_hp, base_atk, base_def')
      .in('id', heroIds);

    let totalCp = 0;
    (heroStats || []).forEach(h => {
      totalCp += Math.round(h.base_hp * 0.5 + h.base_atk * 2.5 + h.base_def * 1.5);
    });

    await supabase
      .from('user_card_teams')
      .upsert({
        user_id: userId,
        slot_1: slot_1 ? parseInt(slot_1) : null,
        slot_2: slot_2 ? parseInt(slot_2) : null,
        slot_3: slot_3 ? parseInt(slot_3) : null,
        combat_power: totalCp || 1000,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' });

    res.json({ success: true, combat_power: totalCp });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. API TRIỆU HỒI / GHÉP MẢNH TƯỚNG
router.post('/api/summon-hero', async (req, res) => {
  const userId = req.user.id;
  const { hero_id } = req.body;

  try {
    const { data: hero } = await supabase.from('card_heroes').select('*').eq('id', hero_id).single();
    if (!hero) return res.status(404).json({ success: false, error: 'Không tìm thấy tướng.' });

    const { data: userHero } = await supabase
      .from('user_heroes')
      .select('*')
      .eq('user_id', userId)
      .eq('hero_id', hero_id)
      .single();

    if (!userHero || userHero.shards < hero.shards_to_summon) {
      return res.status(400).json({
        success: false,
        error: `Chưa đủ mảnh! Hiện có ${userHero ? userHero.shards : 0}/${hero.shards_to_summon} mảnh.`
      });
    }

    if (userHero.is_unlocked) {
      return res.status(400).json({ success: false, error: 'Tướng này bạn đã sở hữu rồi!' });
    }

    await supabase
      .from('user_heroes')
      .update({
        is_unlocked: true,
        shards: userHero.shards - hero.shards_to_summon
      })
      .eq('id', userHero.id);

    res.json({ success: true, message: `Triệu hồi thành công Nữ Thần: ${hero.name}!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. API NÂNG CẤP TƯỚNG (LEVEL UP)
router.post('/api/upgrade-hero', async (req, res) => {
  const userId = req.user.id;
  const { hero_id } = req.body;

  try {
    const { data: userHero } = await supabase
      .from('user_heroes')
      .select('*')
      .eq('user_id', userId)
      .eq('hero_id', hero_id)
      .single();

    if (!userHero || !userHero.is_unlocked) {
      return res.status(400).json({ success: false, error: 'Bạn chưa sở hữu tướng này!' });
    }

    const costExpPills = userHero.level * 10;
    const { data: items } = await supabase
      .from('user_card_items')
      .select('exp_pills')
      .eq('user_id', userId)
      .single();

    if (!items || items.exp_pills < costExpPills) {
      return res.status(400).json({
        success: false,
        error: `Không đủ Đan EXP! Cần ${costExpPills} viên (hiện có: ${items ? items.exp_pills : 0}).`
      });
    }

    // Trừ đan và tăng level
    await supabase
      .from('user_card_items')
      .update({ exp_pills: items.exp_pills - costExpPills })
      .eq('user_id', userId);

    const newLevel = userHero.level + 1;
    await supabase
      .from('user_heroes')
      .update({ level: newLevel })
      .eq('id', userHero.id);

    res.json({ success: true, new_level: newLevel, remaining_pills: items.exp_pills - costExpPills });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. API MỞ RƯƠNG (GACHA)
router.post('/api/open-chest', async (req, res) => {
  const userId = req.user.id;
  const { chest_type } = req.body; // 'wooden', 'silver', 'gold'

  try {
    const { data: items } = await supabase
      .from('user_card_items')
      .select('*')
      .eq('user_id', userId)
      .single();

    const chestKey = `${chest_type}_chests`;
    if (!items || items[chestKey] <= 0) {
      return res.status(400).json({ success: false, error: 'Bạn không có loại rương này!' });
    }

    // Trừ 1 rương
    await supabase
      .from('user_card_items')
      .update({ [chestKey]: items[chestKey] - 1 })
      .eq('user_id', userId);

    // Thuật toán tỷ lệ rơi quà:
    const { data: allHeroes } = await supabase.from('card_heroes').select('id, name, rarity, card_image_url');
    let gainedPills = 0;
    let gainedStones = 0;
    let droppedHero = null;
    let gainedShards = 0;

    if (chest_type === 'wooden') {
      gainedPills = Math.floor(Math.random() * 15) + 10;
      // Rơi mảnh R hoặc SR
      const rHeroes = allHeroes.filter(h => h.rarity === 'R' || h.rarity === 'SR');
      droppedHero = rHeroes[Math.floor(Math.random() * rHeroes.length)] || allHeroes[0];
      gainedShards = Math.floor(Math.random() * 3) + 2; // 2-4 mảnh
    } else if (chest_type === 'silver') {
      gainedPills = Math.floor(Math.random() * 30) + 20;
      gainedStones = Math.floor(Math.random() * 2) + 1;
      const srHeroes = allHeroes.filter(h => h.rarity === 'SR' || h.rarity === 'SSR');
      droppedHero = srHeroes[Math.floor(Math.random() * srHeroes.length)] || allHeroes[0];
      gainedShards = Math.floor(Math.random() * 6) + 4; // 4-9 mảnh
    } else if (chest_type === 'gold') {
      gainedPills = Math.floor(Math.random() * 60) + 50;
      gainedStones = Math.floor(Math.random() * 4) + 2;
      const ssrHeroes = allHeroes.filter(h => h.rarity === 'SSR' || h.rarity === 'UR');
      droppedHero = (ssrHeroes.length > 0) ? ssrHeroes[Math.floor(Math.random() * ssrHeroes.length)] : allHeroes[0];
      gainedShards = Math.floor(Math.random() * 12) + 8; // 8-19 mảnh
    }

    // Cộng tài nguyên
    await supabase
      .from('user_card_items')
      .update({
        exp_pills: (items.exp_pills || 0) + gainedPills,
        star_stones: (items.star_stones || 0) + gainedStones
      })
      .eq('user_id', userId);

    // Cộng mảnh tướng
    if (droppedHero) {
      const { data: existingUserHero } = await supabase
        .from('user_heroes')
        .select('*')
        .eq('user_id', userId)
        .eq('hero_id', droppedHero.id)
        .single();

      if (existingUserHero) {
        await supabase
          .from('user_heroes')
          .update({ shards: existingUserHero.shards + gainedShards })
          .eq('id', existingUserHero.id);
      } else {
        await supabase
          .from('user_heroes')
          .insert([{
            user_id: userId,
            hero_id: droppedHero.id,
            shards: gainedShards,
            is_unlocked: false
          }]);
      }
    }

    res.json({
      success: true,
      rewards: {
        pills: gainedPills,
        stones: gainedStones,
        hero: droppedHero,
        shards: gainedShards
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. TRANG CHIẾN ĐẤU SÀN ĐẤU (BATTLE ARENA SCENE)
router.get('/battle/:defender_id', async (req, res) => {
  const attackerId = req.user.id;
  const defenderId = req.params.defender_id;

  if (attackerId === defenderId) {
    return res.redirect('/arena?error=' + encodeURIComponent('Không thể tự khiêu chiến chính mình!'));
  }

  try {
    // Kiểm tra vé khiêu chiến
    const { data: attackerRank } = await supabase
      .from('arena_ranks')
      .select('daily_tickets, elo_points')
      .eq('user_id', attackerId)
      .single();

    if (!attackerRank || attackerRank.daily_tickets <= 0) {
      return res.redirect('/arena?error=' + encodeURIComponent('Hôm nay bạn đã hết vé khiêu chiến (5/5 vé)!'));
    }

    // Lấy thông tin 2 đội hình
    const [
      { data: attackerTeamRaw },
      { data: defenderTeamRaw },
      { data: defenderUser },
      { data: defenderRank }
    ] = await Promise.all([
      supabase.from('user_card_teams').select('slot_1, slot_2, slot_3').eq('user_id', attackerId).single(),
      supabase.from('user_card_teams').select('slot_1, slot_2, slot_3').eq('user_id', defenderId).single(),
      supabase.from('users').select('id, display_name, avatar').eq('id', defenderId).single(),
      supabase.from('arena_ranks').select('elo_points, tier').eq('user_id', defenderId).single()
    ]);

    // Lấy chi tiết thông tin các tướng trong đội hình
    const getTeamHeroes = async (teamRaw, uId) => {
      const ids = [teamRaw?.slot_1, teamRaw?.slot_2, teamRaw?.slot_3].filter(Boolean);
      if (ids.length === 0) return [];
      const { data: heroes } = await supabase.from('card_heroes').select('*').in('id', ids);
      const { data: uHeroes } = await supabase.from('user_heroes').select('*').eq('user_id', uId).in('hero_id', ids);
      const uhMap = {};
      (uHeroes || []).forEach(uh => { uhMap[uh.hero_id] = uh; });

      return (heroes || []).map(h => {
        const uh = uhMap[h.id] || { level: 1, star: 1 };
        return {
          id: h.id,
          name: h.name,
          title: h.title,
          avatar_url: h.avatar_url || h.card_image_url,
          card_image_url: h.card_image_url,
          rarity: h.rarity,
          element: h.element,
          level: uh.level,
          star: uh.star,
          hp: Math.round(h.base_hp * (1 + (uh.level - 1) * 0.1) * (1 + (uh.star - 1) * 0.2)),
          max_hp: Math.round(h.base_hp * (1 + (uh.level - 1) * 0.1) * (1 + (uh.star - 1) * 0.2)),
          atk: Math.round(h.base_atk * (1 + (uh.level - 1) * 0.1) * (1 + (uh.star - 1) * 0.2)),
          def: Math.round(h.base_def * (1 + (uh.level - 1) * 0.08)),
          spd: h.base_spd,
          crit: h.base_crit,
          rage: 0,
          max_rage: 100,
          skill_basic: h.skill_basic,
          skill_ultimate: h.skill_ultimate,
          skill_passive: h.skill_passive
        };
      });
    };

    const attackerTeam = await getTeamHeroes(attackerTeamRaw, attackerId);
    let defenderTeam = await getTeamHeroes(defenderTeamRaw, defenderId);

    if (attackerTeam.length === 0) {
      return res.redirect('/arena?error=' + encodeURIComponent('Đội hình của bạn chưa có tướng nào! Hãy vào tab Nữ Thần để xếp tướng.'));
    }

    // Nếu đối thủ chưa xếp đội, tạo 1 bot tướng mẫu
    if (defenderTeam.length === 0) {
      const { data: defaultHero } = await supabase.from('card_heroes').select('*').limit(2);
      defenderTeam = (defaultHero || []).map(h => ({
        id: h.id,
        name: h.name,
        title: h.title,
        avatar_url: h.avatar_url || h.card_image_url,
        card_image_url: h.card_image_url,
        rarity: h.rarity,
        element: h.element,
        level: 1,
        star: 1,
        hp: h.base_hp,
        max_hp: h.base_hp,
        atk: h.base_atk,
        def: h.base_def,
        spd: h.base_spd,
        crit: h.base_crit,
        rage: 0,
        max_rage: 100,
        skill_basic: h.skill_basic,
        skill_ultimate: h.skill_ultimate,
        skill_passive: h.skill_passive
      }));
    }

    res.render('arena/battle', {
      title: '⚔️ Sàn Đấu Trực Tuyến - Waifu Arena',
      user: req.user,
      defender: defenderUser || { id: defenderId, display_name: 'Độc giả thần bí', avatar: '/css/silly_duck.png' },
      attackerRank,
      defenderRank: defenderRank || { elo_points: 1000, tier: 'Đồng' },
      attackerTeam,
      defenderTeam
    });
  } catch (err) {
    console.error('Lỗi khởi tạo sàn đấu:', err);
    res.status(500).send('Lỗi khi vào sàn đấu: ' + err.message);
  }
});

// 7. API KẾT THÚC TRẬN ĐẤU & CẬP NHẬT RANK
router.post('/api/battle-result', async (req, res) => {
  const attackerId = req.user.id;
  const { defender_id, winner } = req.body; // winner: 'attacker' hoặc 'defender'

  try {
    const isAttackerWin = winner === 'attacker';

    // Trừ 1 vé khiêu chiến
    const { data: curRank } = await supabase
      .from('arena_ranks')
      .select('daily_tickets, elo_points, wins, losses')
      .eq('user_id', attackerId)
      .single();

    if (!curRank || curRank.daily_tickets <= 0) {
      return res.status(400).json({ success: false, error: 'Đã hết vé khiêu chiến!' });
    }

    const eloChange = isAttackerWin ? 25 : -12;
    const newAttackerElo = Math.max(800, curRank.elo_points + eloChange);

    // Tính Rank Tier mới
    const calculateTier = (elo) => {
      if (elo >= 2200) return 'Vương Giả';
      if (elo >= 1800) return 'Kim Cương';
      if (elo >= 1500) return 'Bạch Kim';
      if (elo >= 1250) return 'Vàng';
      if (elo >= 1050) return 'Bạc';
      return 'Đồng';
    };

    // Cập nhật Attacker
    await supabase
      .from('arena_ranks')
      .update({
        elo_points: newAttackerElo,
        tier: calculateTier(newAttackerElo),
        daily_tickets: curRank.daily_tickets - 1,
        wins: curRank.wins + (isAttackerWin ? 1 : 0),
        losses: curRank.losses + (isAttackerWin ? 0 : 1)
      })
      .eq('user_id', attackerId);

    // Cập nhật Defender (nếu thua bị trừ nhẹ, nếu thắng được cộng nhẹ)
    const { data: defRank } = await supabase
      .from('arena_ranks')
      .select('elo_points, wins, losses')
      .eq('user_id', defender_id)
      .single();

    if (defRank) {
      const defEloChange = isAttackerWin ? -10 : 15;
      const newDefElo = Math.max(800, defRank.elo_points + defEloChange);
      await supabase
        .from('arena_ranks')
        .update({
          elo_points: newDefElo,
          tier: calculateTier(newDefElo),
          wins: defRank.wins + (isAttackerWin ? 0 : 1),
          losses: defRank.losses + (isAttackerWin ? 1 : 0)
        })
        .eq('user_id', defender_id);
    }

    // Nếu thắng: Thưởng thêm 1 Hòm Bạc + 30 Đan EXP
    let bonusReward = null;
    if (isAttackerWin) {
      const { data: items } = await supabase.from('user_card_items').select('*').eq('user_id', attackerId).single();
      if (items) {
        await supabase
          .from('user_card_items')
          .update({
            silver_chests: items.silver_chests + 1,
            exp_pills: items.exp_pills + 30
          })
          .eq('user_id', attackerId);
        bonusReward = { silver_chests: 1, exp_pills: 30 };
      }
    }

    // Ghi Battle log
    await supabase.from('arena_battle_logs').insert([{
      attacker_id: attackerId,
      defender_id: defender_id,
      winner_id: isAttackerWin ? attackerId : defender_id,
      elo_change: eloChange,
      log_summary: isAttackerWin ? 'Chiến thắng vang dội' : 'Thất bại đáng tiếc'
    }]);

    res.json({
      success: true,
      elo_change: eloChange,
      new_elo: newAttackerElo,
      tier: calculateTier(newAttackerElo),
      bonus: bonusReward
    });
  } catch (err) {
    console.error('Lỗi lưu kết quả trận đấu:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
