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

// ĐỊNH NGHĨA 10 MÀN THÁP THỬ THÁCH (PVE DUNGEON)
const DUNGEON_STAGES = [
  {
    stage: 1,
    name: 'Cương Thi Rơm',
    title: 'Tầng 1 - Quỷ Rơm Tác Quái',
    element: 'Mộc',
    combat_power: 800,
    avatar: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=200&auto=format&fit=crop&q=80',
    boss: {
      name: 'Quỷ Rơm Tác Quái',
      title: 'Tầng 1 - Mộc Linh',
      avatar_url: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=200&auto=format&fit=crop&q=80',
      rarity: 'R',
      element: 'wood',
      level: 5,
      star: 1,
      hp: 1800,
      max_hp: 1800,
      atk: 180,
      def: 60,
      spd: 90,
      crit: 5,
      rage: 0,
      max_rage: 100,
      skill_basic: { name: 'Gai Rơm', desc: 'Đâm gai nhọn vào mục tiêu', dmg_rate: 1.0, rage_gain: 25 },
      skill_ultimate: { name: 'Bão Cỏ Khô', desc: 'Tung bão gai quấn lấy toàn đội', dmg_rate: 1.8, rage_cost: 100 }
    },
    rewards: { wooden_chests: 1, exp_pills: 5, star_stones: 0 }
  },
  {
    stage: 2,
    name: 'Sói Yêu Nguyệt Nha',
    title: 'Tầng 2 - Ma Lang Nguyệt Ảnh',
    element: 'Ám',
    combat_power: 1400,
    avatar: 'https://images.unsplash.com/photo-1564865878688-9a244444042a?w=200&auto=format&fit=crop&q=80',
    boss: {
      name: 'Ma Lang Nguyệt Ảnh',
      title: 'Tầng 2 - Ám Lang',
      avatar_url: 'https://images.unsplash.com/photo-1564865878688-9a244444042a?w=200&auto=format&fit=crop&q=80',
      rarity: 'SR',
      element: 'dark',
      level: 10,
      star: 1,
      hp: 2800,
      max_hp: 2800,
      atk: 280,
      def: 90,
      spd: 110,
      crit: 10,
      rage: 0,
      max_rage: 100,
      skill_basic: { name: 'Cắn Xé', desc: 'Nanh sói sắc nhọn tấn công', dmg_rate: 1.1, rage_gain: 25 },
      skill_ultimate: { name: 'Nguyệt Thực Trảm', desc: 'Vuốt sói bóng đêm cào xé toàn đội', dmg_rate: 2.0, rage_cost: 100 }
    },
    rewards: { wooden_chests: 2, exp_pills: 10, star_stones: 1 }
  },
  {
    stage: 3,
    name: 'Bích Nhện Tinh',
    title: 'Tầng 3 - Nhện Chúa Rừng Sương',
    element: 'Độc',
    combat_power: 2000,
    avatar: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200&auto=format&fit=crop&q=80',
    boss: {
      name: 'Bích Nhện Tinh',
      title: 'Tầng 3 - Độc Chúa',
      avatar_url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=200&auto=format&fit=crop&q=80',
      rarity: 'SR',
      element: 'poison',
      level: 15,
      star: 1,
      hp: 3800,
      max_hp: 3800,
      atk: 360,
      def: 130,
      spd: 100,
      crit: 12,
      rage: 0,
      max_rage: 100,
      skill_basic: { name: 'Phóng Tơ Độc', desc: 'Bắn tơ tẩm độc gây sát thương', dmg_rate: 1.1, rage_gain: 25 },
      skill_ultimate: { name: 'Vạn Tiễn Tơ Độc', desc: 'Tơ độc bao phủ toàn chiến trường', dmg_rate: 2.1, rage_cost: 100 }
    },
    rewards: { wooden_chests: 2, exp_pills: 15, star_stones: 2 }
  },
  {
    stage: 4,
    name: 'Xích Hổ Yêu Ma',
    title: 'Tầng 4 - Hổ Cốt Cuồng Nộ',
    element: 'Lực',
    combat_power: 2800,
    avatar: 'https://images.unsplash.com/photo-1561731216-c3a4d99437d5?w=200&auto=format&fit=crop&q=80',
    boss: {
      name: 'Xích Hổ Yêu Ma',
      title: 'Tầng 4 - Cuồng Thú',
      avatar_url: 'https://images.unsplash.com/photo-1561731216-c3a4d99437d5?w=200&auto=format&fit=crop&q=80',
      rarity: 'SR',
      element: 'fire',
      level: 20,
      star: 2,
      hp: 5000,
      max_hp: 5000,
      atk: 480,
      def: 180,
      spd: 105,
      crit: 15,
      rage: 0,
      max_rage: 100,
      skill_basic: { name: 'Hổ Trảo', desc: 'Vồ tới tát mạnh mục tiêu', dmg_rate: 1.15, rage_gain: 25 },
      skill_ultimate: { name: 'Mãnh Hổ Hống', desc: 'Tiếng gầm làm chấn động toàn đội', dmg_rate: 2.2, rage_cost: 100 }
    },
    rewards: { wooden_chests: 3, silver_chests: 1, exp_pills: 20, star_stones: 2 }
  },
  {
    stage: 5,
    name: 'Thạch Cự Nhân',
    title: 'Tầng 5 - Thủ Hộ Nham Thạch',
    element: 'Thổ',
    combat_power: 3600,
    avatar: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=200&auto=format&fit=crop&q=80',
    boss: {
      name: 'Thạch Cự Nhân',
      title: 'Tầng 5 - Thổ Ma Thần',
      avatar_url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=200&auto=format&fit=crop&q=80',
      rarity: 'SSR',
      element: 'earth',
      level: 25,
      star: 2,
      hp: 7500,
      max_hp: 7500,
      atk: 560,
      def: 280,
      spd: 85,
      crit: 10,
      rage: 0,
      max_rage: 100,
      skill_basic: { name: 'Nham Đột', desc: 'Cột đá đâm lên từ mặt đất', dmg_rate: 1.2, rage_gain: 25 },
      skill_ultimate: { name: 'Địa Chấn Sơn Diệt', desc: 'Dộng đất sụp đổ tàn phá quân địch', dmg_rate: 2.3, rage_cost: 100 }
    },
    rewards: { silver_chests: 2, exp_pills: 30, star_stones: 3 }
  },
  {
    stage: 6,
    name: 'Cửu Vĩ Linh Hồ',
    title: 'Tầng 6 - Hỏa Hồ Mê Hoặc',
    element: 'Hỏa',
    combat_power: 4500,
    avatar: 'https://images.unsplash.com/photo-1516934024742-b461fba47600?w=200&auto=format&fit=crop&q=80',
    boss: {
      name: 'Cửu Vĩ Linh Hồ',
      title: 'Tầng 6 - Linh Thú',
      avatar_url: 'https://images.unsplash.com/photo-1516934024742-b461fba47600?w=200&auto=format&fit=crop&q=80',
      rarity: 'SSR',
      element: 'fire',
      level: 30,
      star: 2,
      hp: 9000,
      max_hp: 9000,
      atk: 720,
      def: 240,
      spd: 125,
      crit: 20,
      rage: 0,
      max_rage: 100,
      skill_basic: { name: 'Hỏa Hồ Đạn', desc: 'Cầu lửa ma mị thiêu đốt', dmg_rate: 1.2, rage_gain: 25 },
      skill_ultimate: { name: 'Cửu Vĩ Nghiệp Hỏa', desc: 'Biển lửa chín đuôi thiêu rụi đội hình', dmg_rate: 2.4, rage_cost: 100 }
    },
    rewards: { silver_chests: 2, exp_pills: 40, star_stones: 4 }
  },
  {
    stage: 7,
    name: 'Vô Danh Kiếm Quỷ',
    title: 'Tầng 7 - Hắc Ám Kiếm Ma',
    element: 'Kiếm',
    combat_power: 5500,
    avatar: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=200&auto=format&fit=crop&q=80',
    boss: {
      name: 'Vô Danh Kiếm Quỷ',
      title: 'Tầng 7 - Kiếm Hồn',
      avatar_url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=200&auto=format&fit=crop&q=80',
      rarity: 'SSR',
      element: 'dark',
      level: 35,
      star: 3,
      hp: 11000,
      max_hp: 11000,
      atk: 900,
      def: 330,
      spd: 135,
      crit: 25,
      rage: 0,
      max_rage: 100,
      skill_basic: { name: 'Tàn Kiếm', desc: 'Kiếm khí sắc lạnh chém đứt không khí', dmg_rate: 1.25, rage_gain: 25 },
      skill_ultimate: { name: 'Vạn Kiếm Quy Tông', desc: 'Vạn đạo kiếm khí cuồng bạo xé rách địch thủ', dmg_rate: 2.5, rage_cost: 100 }
    },
    rewards: { silver_chests: 3, exp_pills: 50, star_stones: 5 }
  },
  {
    stage: 8,
    name: 'Bắc Hải U Xà',
    title: 'Tầng 8 - Cửu U Minh Xà',
    element: 'Băng',
    combat_power: 6800,
    avatar: 'https://images.unsplash.com/photo-1531386151447-fd76ad50012f?w=200&auto=format&fit=crop&q=80',
    boss: {
      name: 'Bắc Hải U Xà',
      title: 'Tầng 8 - Hàn Xà Vương',
      avatar_url: 'https://images.unsplash.com/photo-1531386151447-fd76ad50012f?w=200&auto=format&fit=crop&q=80',
      rarity: 'SSR',
      element: 'ice',
      level: 40,
      star: 3,
      hp: 13500,
      max_hp: 13500,
      atk: 1080,
      def: 420,
      spd: 120,
      crit: 20,
      rage: 0,
      max_rage: 100,
      skill_basic: { name: 'Hàn Băng Thấu Xương', desc: 'Hơi lạnh ngưng đọng tấn công mục tiêu', dmg_rate: 1.3, rage_gain: 25 },
      skill_ultimate: { name: 'Băng Phong Vạn Lý', desc: 'Đóng băng toàn bộ chiến trường', dmg_rate: 2.6, rage_cost: 100 }
    },
    rewards: { silver_chests: 3, gold_chests: 1, exp_pills: 60, star_stones: 6 }
  },
  {
    stage: 9,
    name: 'Kim Xí Ma Bằng',
    title: 'Tầng 9 - Cuồng Phong Ma Ưng',
    element: 'Phong',
    combat_power: 8200,
    avatar: 'https://images.unsplash.com/photo-1543946207-39bd91e70ca7?w=200&auto=format&fit=crop&q=80',
    boss: {
      name: 'Kim Xí Ma Bằng',
      title: 'Tầng 9 - Phong Vương',
      avatar_url: 'https://images.unsplash.com/photo-1543946207-39bd91e70ca7?w=200&auto=format&fit=crop&q=80',
      rarity: 'SSR',
      element: 'wind',
      level: 45,
      star: 3,
      hp: 16500,
      max_hp: 16500,
      atk: 1280,
      def: 500,
      spd: 155,
      crit: 30,
      rage: 0,
      max_rage: 100,
      skill_basic: { name: 'Phong Nhẫn', desc: 'Lưỡi đao gió chém ngọt mục tiêu', dmg_rate: 1.35, rage_gain: 25 },
      skill_ultimate: { name: 'Long Quyển Phong Bạo', desc: 'Cơn bão lốc xoáy cuốn phăng toàn quân', dmg_rate: 2.7, rage_cost: 100 }
    },
    rewards: { gold_chests: 1, exp_pills: 80, star_stones: 8 }
  },
  {
    stage: 10,
    name: 'Vực Sâu Tà Long',
    title: 'Tầng 10 - Trùm Cuối Thượng Cổ Tà Thần',
    element: 'Thần Ma',
    combat_power: 10000,
    avatar: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=200&auto=format&fit=crop&q=80',
    boss: {
      name: 'Vực Sâu Tà Long',
      title: 'Trùm Cuối Tầng 10',
      avatar_url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=200&auto=format&fit=crop&q=80',
      rarity: 'UR',
      element: 'dark',
      level: 50,
      star: 4,
      hp: 22000,
      max_hp: 22000,
      atk: 1550,
      def: 650,
      spd: 140,
      crit: 35,
      rage: 0,
      max_rage: 100,
      skill_basic: { name: 'Hơi Thở Diệt Vong', desc: 'Hơi thở rồng tà ác thiêu đốt mục tiêu', dmg_rate: 1.4, rage_gain: 25 },
      skill_ultimate: { name: 'Hắc Ám Long Tinh Bộc Phá', desc: 'Ngôi sao đen diệt thế hủy diệt toàn quân', dmg_rate: 3.0, rage_cost: 100 }
    },
    rewards: { gold_chests: 2, exp_pills: 100, star_stones: 15 }
  }
];

// ĐỊNH NGHĨA DANH SÁCH NHIỆM VỤ HÀNG NGÀY
const QUEST_DEFINITIONS = [
  { id: 'read_daily', name: 'Đọc truyện mỗi ngày', desc: 'Đọc tích lũy từ 3 chương truyện hôm nay', target: 3, type: 'read_chapters', reward: { silver_chests: 1, wooden_chests: 1, exp_pills: 20, star_stones: 2 }, reward_desc: '🥈 1 Hòm Bạc + 📦 1 Hòm Gỗ + 💊 20 Đan EXP + ⭐ 2 Đá Sao' },
  { id: 'arena_1', name: 'Thử sức Đấu Trường', desc: 'Khiêu chiến 1 trận trong Đấu Trường Nữ Thần', target: 1, type: 'battles_fought', reward: { wooden_chests: 1, exp_pills: 5 }, reward_desc: '📦 1 Hòm Gỗ + 💊 5 Đan EXP' },
  { id: 'dungeon_1', name: 'Trảm Yêu Trừ Ma', desc: 'Vượt qua 1 màn bất kỳ trong Tháp Thử Thách', target: 1, type: 'stages_cleared', reward: { wooden_chests: 1, star_stones: 1 }, reward_desc: '📦 1 Hòm Gỗ + ⭐ 1 Đá Nâng Sao' },
  { id: 'chest_1', name: 'Khai Mở Vận May', desc: 'Mở 1 rương quà bất kỳ (Gỗ/Bạc/Vàng)', target: 1, type: 'chests_opened', reward: { exp_pills: 15 }, reward_desc: '💊 15 Đan EXP Tướng' }
];

// Helper: Lấy tiến độ nhiệm vụ hàng ngày của người chơi
async function getDailyQuestsProgress(userId) {
  const todayStr = new Date().toISOString().slice(0, 10);
  let { data: qRow } = await supabase
    .from('user_card_quests')
    .select('*')
    .eq('user_id', userId)
    .eq('quest_date', todayStr)
    .maybeSingle();

  if (!qRow) {
    const { data: newRow } = await supabase
      .from('user_card_quests')
      .insert([{
        user_id: userId,
        quest_date: todayStr,
        read_chapters: 0,
        battles_fought: 0,
        stages_cleared: 0,
        chests_opened: 0,
        claimed_quests: []
      }])
      .select()
      .single();
    qRow = newRow;
  }

  const claimed = Array.isArray(qRow?.claimed_quests) ? qRow.claimed_quests : [];

  const questsWithStatus = QUEST_DEFINITIONS.map(q => {
    const progress = qRow ? (qRow[q.type] || 0) : 0;
    const isCompleted = progress >= q.target;
    const isClaimed = claimed.includes(q.id);
    return {
      ...q,
      progress: Math.min(progress, q.target),
      current: progress,
      isCompleted,
      isClaimed,
      canClaim: isCompleted && !isClaimed
    };
  });

  return { quests: questsWithStatus, raw: qRow };
}

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
        daily_tickets: 5,
        dungeon_stage: 1
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
    if (!rank.dungeon_stage) rank.dungeon_stage = 1;
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
    const { data: lieuNhuYen } = await supabase.from('card_heroes').select('id').eq('name', 'Liễu Như Yên').single();
    const { data: toMongDao } = await supabase.from('card_heroes').select('id').eq('name', 'Tô Mộng Dao').single();

    if (lieuNhuYen) {
      await supabase.from('user_heroes').insert([{
        user_id: userId,
        hero_id: lieuNhuYen.id,
        is_unlocked: true,
        shards: 0,
        level: 1,
        star: 1
      }]);
    }
    if (toMongDao) {
      await supabase.from('user_heroes').insert([{
        user_id: userId,
        hero_id: toMongDao.id,
        is_unlocked: false,
        shards: 8,
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
    const { quests } = await getDailyQuestsProgress(userId);

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
        hp: Math.round(h.base_hp * (1 + ((owned ? owned.level : 1) - 1) * 0.1) * (1 + ((owned ? owned.star : 1) - 1) * 0.2)),
        atk: Math.round(h.base_atk * (1 + ((owned ? owned.level : 1) - 1) * 0.1) * (1 + ((owned ? owned.star : 1) - 1) * 0.2)),
        def: Math.round(h.base_def * (1 + ((owned ? owned.level : 1) - 1) * 0.08)),
        spd: h.base_spd,
        crit: h.base_crit
      };
    });

    // Lấy danh sách đối thủ xứng tầm
    const minElo = Math.max(800, (rank.elo_points || 1000) - 250);
    const maxElo = (rank.elo_points || 1000) + 250;

    const { data: candidateRanks } = await supabase
      .from('arena_ranks')
      .select('user_id, elo_points, tier, wins, losses, users(id, display_name, avatar)')
      .neq('user_id', userId)
      .gte('elo_points', minElo)
      .lte('elo_points', maxElo)
      .limit(6);

    let opponents = candidateRanks || [];
    if (opponents.length < 3) {
      const { data: anyOpponents } = await supabase
        .from('arena_ranks')
        .select('user_id, elo_points, tier, wins, losses, users(id, display_name, avatar)')
        .neq('user_id', userId)
        .limit(4);
      opponents = anyOpponents || [];
    }

    // Gắn đội hình thủ của đối thủ
    const oppUserIds = opponents.map(o => o.user_id);
    const { data: oppTeams } = await supabase
      .from('user_card_teams')
      .select('*, slot1:slot_1(id, name, avatar_url, card_image_url, rarity), slot2:slot_2(id, name, avatar_url, card_image_url, rarity), slot3:slot_3(id, name, avatar_url, card_image_url, rarity)')
      .in('user_id', oppUserIds);

    const oppTeamMap = {};
    (oppTeams || []).forEach(t => {
      oppTeamMap[t.user_id] = t;
    });

    opponents = opponents.map(o => ({
      ...o,
      team: oppTeamMap[o.user_id] || { combat_power: 1200, slot1: null, slot2: null, slot3: null }
    }));

    // Lấy Top 20 BXH Đấu trường
    const { data: leaderboard } = await supabase
      .from('arena_ranks')
      .select('user_id, elo_points, tier, wins, losses, users(id, display_name, avatar)')
      .order('elo_points', { ascending: false })
    // Lấy danh sách các màn tháp hôm nay user đã nhận quà
    const todayStr = new Date().toISOString().slice(0, 10);
    const { data: todayQuestRow } = await supabase
      .from('user_card_quests')
      .select('claimed_quests')
      .eq('user_id', userId)
      .eq('quest_date', todayStr)
      .maybeSingle();

    const claimedList = todayQuestRow && todayQuestRow.claimed_quests ? todayQuestRow.claimed_quests : [];
    const todayClearedStages = claimedList
      .filter(q => q.startsWith('dungeon_stage_'))
      .map(q => parseInt(q.replace('dungeon_stage_', '')));

    res.render('arena/index', {
      title: '⚔️ Đấu Trường Nữ Thần - Waifu Arena',
      user: req.user,
      rank,
      items,
      team,
      heroes: heroesList,
      opponents,
      leaderboard: leaderboard || [],
      quests,
      dungeonStages: DUNGEON_STAGES,
      userDungeonStage: rank.dungeon_stage || 1,
      todayClearedStages
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

    const { data: heroStats } = await supabase
      .from('card_heroes')
      .select('id, base_hp, base_atk, base_def, base_spd')
      .in('id', heroIds.length > 0 ? heroIds : [-1]);

    const { data: userHeroStats } = await supabase
      .from('user_heroes')
      .select('hero_id, level, star')
      .eq('user_id', userId)
      .in('hero_id', heroIds.length > 0 ? heroIds : [-1]);

    const uhMap = {};
    (userHeroStats || []).forEach(uh => { uhMap[uh.hero_id] = uh; });

    let totalCp = 0;
    (heroStats || []).forEach(h => {
      const uh = uhMap[h.id] || { level: 1, star: 1 };
      const hp = Math.round(h.base_hp * (1 + (uh.level - 1) * 0.1) * (1 + (uh.star - 1) * 0.2));
      const atk = Math.round(h.base_atk * (1 + (uh.level - 1) * 0.1) * (1 + (uh.star - 1) * 0.2));
      const def = Math.round(h.base_def * (1 + (uh.level - 1) * 0.08));
      totalCp += Math.round(hp * 0.2 + atk * 1.5 + def * 1.2 + h.base_spd * 2);
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

// 3. API TRIỆU HỒI TƯỚNG (SUMMON / CRAFT)
router.post('/api/summon-hero', async (req, res) => {
  const userId = req.user.id;
  const { hero_id } = req.body;
  const heroId = parseInt(hero_id);

  try {
    const { data: hero } = await supabase
      .from('card_heroes')
      .select('id, name, shards_to_summon')
      .eq('id', heroId)
      .single();

    if (!hero) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tướng này!' });
    }

    const { data: uHero } = await supabase
      .from('user_heroes')
      .select('*')
      .eq('user_id', userId)
      .eq('hero_id', heroId)
      .maybeSingle();

    if (uHero && uHero.is_unlocked) {
      return res.status(400).json({ success: false, error: 'Bạn đã sở hữu tướng này rồi!' });
    }

    const currentShards = uHero ? uHero.shards : 0;
    if (currentShards < hero.shards_to_summon) {
      return res.status(400).json({
        success: false,
        error: `Chưa đủ mảnh triệu hồi! Bạn có ${currentShards}/${hero.shards_to_summon} mảnh.`
      });
    }

    const remainingShards = currentShards - hero.shards_to_summon;
    if (uHero) {
      await supabase
        .from('user_heroes')
        .update({
          is_unlocked: true,
          shards: remainingShards,
          level: 1,
          star: 1
        })
        .eq('id', uHero.id);
    } else {
      await supabase
        .from('user_heroes')
        .insert([{
          user_id: userId,
          hero_id: heroId,
          is_unlocked: true,
          shards: remainingShards,
          level: 1,
          star: 1
        }]);
    }

    res.json({ success: true, message: `🎉 Chúc mừng bạn đã chiêu mộ thành công ${hero.name}!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. API TĂNG CẤP TƯỚNG (UPGRADE HERO LEVEL)
router.post('/api/upgrade-hero', async (req, res) => {
  const userId = req.user.id;
  const { hero_id } = req.body;
  const heroId = parseInt(hero_id);

  try {
    const { data: uHero } = await supabase
      .from('user_heroes')
      .select('*')
      .eq('user_id', userId)
      .eq('hero_id', heroId)
      .single();

    if (!uHero || !uHero.is_unlocked) {
      return res.status(400).json({ success: false, error: 'Bạn chưa mở khóa tướng này!' });
    }

    const currentLevel = uHero.level || 1;
    if (currentLevel >= 50) {
      return res.status(400).json({ success: false, error: 'Tướng đã đạt cấp tối đa (Lv.50)!' });
    }

    const pillsCost = currentLevel * 5;

    const { data: items } = await supabase
      .from('user_card_items')
      .select('exp_pills')
      .eq('user_id', userId)
      .single();

    if (!items || (items.exp_pills || 0) < pillsCost) {
      return res.status(400).json({
        success: false,
        error: `Không đủ Đan EXP! Cần ${pillsCost} viên, bạn hiện có ${items ? items.exp_pills : 0}.`
      });
    }

    await supabase
      .from('user_card_items')
      .update({ exp_pills: items.exp_pills - pillsCost })
      .eq('user_id', userId);

    await supabase
      .from('user_heroes')
      .update({ level: currentLevel + 1 })
      .eq('id', uHero.id);

    const { data: baseHero } = await supabase
      .from('card_heroes')
      .select('*')
      .eq('id', heroId)
      .single();

    const newLevel = currentLevel + 1;
    const curStar = uHero.star || 1;
    const newHp = Math.round((baseHero ? baseHero.base_hp : 2000) * (1 + (newLevel - 1) * 0.1) * (1 + (curStar - 1) * 0.2));
    const newAtk = Math.round((baseHero ? baseHero.base_atk : 200) * (1 + (newLevel - 1) * 0.1) * (1 + (curStar - 1) * 0.2));
    const newDef = Math.round((baseHero ? baseHero.base_def : 100) * (1 + (newLevel - 1) * 0.08));

    res.json({
      success: true,
      new_level: newLevel,
      star: curStar,
      hp: newHp,
      atk: newAtk,
      def: newDef,
      remaining_pills: items.exp_pills - pillsCost,
      next_pills_cost: newLevel * 5
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4b. API TĂNG SAO TƯỚNG (UPGRADE HERO STAR)
router.post('/api/upgrade-star', async (req, res) => {
  const userId = req.user.id;
  const { hero_id } = req.body;
  const heroId = parseInt(hero_id);

  try {
    const { data: uHero } = await supabase
      .from('user_heroes')
      .select('*')
      .eq('user_id', userId)
      .eq('hero_id', heroId)
      .single();

    if (!uHero || !uHero.is_unlocked) {
      return res.status(400).json({ success: false, error: 'Bạn chưa mở khóa nữ tướng này!' });
    }

    const currentStar = uHero.star || 1;
    if (currentStar >= 5) {
      return res.status(400).json({ success: false, error: 'Nữ thần đã đạt cảnh giới tối đa (5 Sao ⭐⭐⭐⭐⭐)!' });
    }

    const starCostMap = { 1: 5, 2: 10, 3: 20, 4: 35 }; // Đá nâng sao
    const shardCostMap = { 1: 10, 2: 20, 3: 35, 4: 50 }; // Mảnh tướng cần để lên 2★, 3★, 4★, 5★
    const stoneCost = starCostMap[currentStar] || 10;
    const shardCost = shardCostMap[currentStar] || 20;

    const currentShards = uHero.shards || 0;
    if (currentShards < shardCost) {
      return res.status(400).json({
        success: false,
        error: `Không đủ Mảnh Tướng! Cần ${shardCost} mảnh 🧩 (bạn hiện có ${currentShards} mảnh). Hãy mở thêm Rương để nhận mảnh!`
      });
    }

    const { data: items } = await supabase
      .from('user_card_items')
      .select('star_stones')
      .eq('user_id', userId)
      .single();

    if (!items || (items.star_stones || 0) < stoneCost) {
      return res.status(400).json({
        success: false,
        error: `Không đủ Đá Nâng Sao! Cần ${stoneCost} viên ⭐ (bạn hiện có ${items ? (items.star_stones || 0) : 0} viên).`
      });
    }

    // Trừ Đá Nâng Sao trong túi đồ
    await supabase
      .from('user_card_items')
      .update({ star_stones: items.star_stones - stoneCost })
      .eq('user_id', userId);

    const newStar = currentStar + 1;
    const remainingShards = currentShards - shardCost;

    // Cập nhật Sao và trừ Mảnh Tướng
    await supabase
      .from('user_heroes')
      .update({
        star: newStar,
        shards: remainingShards
      })
      .eq('id', uHero.id);

    const { data: baseHero } = await supabase
      .from('card_heroes')
      .select('*')
      .eq('id', heroId)
      .single();

    const curLvl = uHero.level || 1;
    const newHp = Math.round((baseHero ? baseHero.base_hp : 2000) * (1 + (curLvl - 1) * 0.1) * (1 + (newStar - 1) * 0.2));
    const newAtk = Math.round((baseHero ? baseHero.base_atk : 200) * (1 + (curLvl - 1) * 0.1) * (1 + (newStar - 1) * 0.2));
    const newDef = Math.round((baseHero ? baseHero.base_def : 100) * (1 + (curLvl - 1) * 0.08));

    res.json({
      success: true,
      new_star: newStar,
      level: curLvl,
      hp: newHp,
      atk: newAtk,
      def: newDef,
      remaining_stones: items.star_stones - stoneCost,
      remaining_shards: remainingShards,
      next_stones_cost: starCostMap[newStar] || 0,
      next_shards_cost: shardCostMap[newStar] || 0
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4c. API TRÙNG SINH TƯỚNG (RESET HERO: HOÀN TRẢ EXP, ĐÁ SAO VÀ MẢNH)
router.post('/api/reset-hero', async (req, res) => {
  const userId = req.user.id;
  const { hero_id } = req.body;
  const heroId = parseInt(hero_id);

  try {
    const { data: uHero } = await supabase
      .from('user_heroes')
      .select('*')
      .eq('user_id', userId)
      .eq('hero_id', heroId)
      .single();

    if (!uHero || !uHero.is_unlocked) {
      return res.status(400).json({ success: false, error: 'Bạn chưa sở hữu nữ tướng này!' });
    }

    const currentLevel = uHero.level || 1;
    const currentStar = uHero.star || 1;

    if (currentLevel <= 1 && currentStar <= 1) {
      return res.status(400).json({ success: false, error: 'Nữ tướng đang ở cấp 1 và 1 sao, không có tài nguyên nào cần hoàn trả!' });
    }

    // Tính tổng Đan EXP đã tiêu: sum(i * 5) với i từ 1 đến currentLevel - 1
    const refundedPills = Math.round(5 * (currentLevel - 1) * currentLevel / 2);

    // Tính tổng Đá Sao đã tiêu: 1->2: 5, 2->3: 10, 3->4: 20, 4->5: 35
    const starRefundMap = { 1: 0, 2: 5, 3: 15, 4: 35, 5: 70 };
    const refundedStones = starRefundMap[currentStar] || 0;

    // Tính tổng Mảnh Tướng đã tiêu khi nâng sao: 1->2: 10, 2->3: 20, 3->4: 35, 4->5: 50
    const shardRefundMap = { 1: 0, 2: 10, 3: 30, 4: 65, 5: 115 };
    const refundedShards = shardRefundMap[currentStar] || 0;

    // Lấy túi đồ người chơi
    const { data: items } = await supabase
      .from('user_card_items')
      .select('exp_pills, star_stones')
      .eq('user_id', userId)
      .single();

    const newExpPills = (items?.exp_pills || 0) + refundedPills;
    const newStarStones = (items?.star_stones || 0) + refundedStones;

    // Hoàn trả vào túi đồ
    await supabase
      .from('user_card_items')
      .update({
        exp_pills: newExpPills,
        star_stones: newStarStones
      })
      .eq('user_id', userId);

    // Reset tướng về cấp 1, sao 1 và hoàn trả lại mảnh tướng
    const newShards = (uHero.shards || 0) + refundedShards;
    await supabase
      .from('user_heroes')
      .update({
        level: 1,
        star: 1,
        exp: 0,
        shards: newShards
      })
      .eq('id', uHero.id);

    // Lấy thông số gốc của tướng
    const { data: baseHero } = await supabase
      .from('card_heroes')
      .select('*')
      .eq('id', heroId)
      .single();

    const baseHp = baseHero ? baseHero.base_hp : 2000;
    const baseAtk = baseHero ? baseHero.base_atk : 200;
    const baseDef = baseHero ? baseHero.base_def : 100;

    res.json({
      success: true,
      message: `Trùng sinh thành công! Đã hoàn trả lại ${refundedPills} Đan EXP và ${refundedStones} Đá Tăng Sao!`,
      refunded_pills: refundedPills,
      refunded_stones: refundedStones,
      new_level: 1,
      new_star: 1,
      hp: baseHp,
      atk: baseAtk,
      def: baseDef,
      total_exp_pills: newExpPills,
      total_star_stones: newStarStones,
      next_pills_cost: 5,
      next_stones_cost: 5
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. API MỞ RƯƠNG QUÀ (OPEN CHEST / GACHA)
router.post('/api/open-chest', async (req, res) => {
  const userId = req.user.id;
  const { chest_type } = req.body;

  try {
    const { data: items } = await supabase
      .from('user_card_items')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!items) {
      return res.status(400).json({ success: false, error: 'Không tìm thấy túi đồ của bạn!' });
    }

    let chestCol = '';
    if (chest_type === 'wooden') chestCol = 'wooden_chests';
    else if (chest_type === 'silver') chestCol = 'silver_chests';
    else if (chest_type === 'gold') chestCol = 'gold_chests';
    else return res.status(400).json({ success: false, error: 'Loại rương không hợp lệ!' });

    if (!items[chestCol] || items[chestCol] <= 0) {
      return res.status(400).json({ success: false, error: 'Bạn không có rương loại này!' });
    }

    const { data: allHeroes } = await supabase
      .from('card_heroes')
      .select('id, name, rarity, avatar_url, card_image_url');

    let gainedPills = 0;
    let gainedStones = 0;
    let gainedShards = 0;
    let droppedHero = null;

    if (chest_type === 'wooden') {
      gainedPills = Math.floor(Math.random() * 6) + 5;
      gainedStones = Math.random() < 0.2 ? 1 : 0;
      gainedShards = Math.floor(Math.random() * 3) + 2;
      const rList = allHeroes.filter(h => h.rarity === 'R' || h.rarity === 'SR');
      if (rList.length > 0) droppedHero = rList[Math.floor(Math.random() * rList.length)];
    } else if (chest_type === 'silver') {
      gainedPills = Math.floor(Math.random() * 16) + 15;
      gainedStones = Math.floor(Math.random() * 3) + 1;
      gainedShards = Math.floor(Math.random() * 6) + 5;
      const srList = allHeroes.filter(h => h.rarity === 'SR' || h.rarity === 'SSR');
      if (srList.length > 0) droppedHero = srList[Math.floor(Math.random() * srList.length)];
    } else if (chest_type === 'gold') {
      gainedPills = Math.floor(Math.random() * 31) + 30;
      gainedStones = Math.floor(Math.random() * 5) + 3;
      gainedShards = Math.floor(Math.random() * 11) + 10;
      const ssrList = allHeroes.filter(h => h.rarity === 'SSR' || h.rarity === 'UR');
      if (ssrList.length > 0) droppedHero = ssrList[Math.floor(Math.random() * ssrList.length)];
    }

    const updatedRemaining = items[chestCol] - 1;

    // Trừ 1 hòm & cộng đan, đá
    await supabase
      .from('user_card_items')
      .update({
        [chestCol]: updatedRemaining,
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

    // Cập nhật nhiệm vụ ngày: mở rương
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const { data: qRow } = await supabase
        .from('user_card_quests')
        .select('id, chests_opened')
        .eq('user_id', userId)
        .eq('quest_date', todayStr)
        .maybeSingle();

      if (qRow) {
        await supabase.from('user_card_quests')
          .update({ chests_opened: qRow.chests_opened + 1, updated_at: new Date().toISOString() })
          .eq('id', qRow.id);
      } else {
        await supabase.from('user_card_quests')
          .insert([{ user_id: userId, quest_date: todayStr, chests_opened: 1 }]);
      }
    } catch (qe) {
      console.error('Lỗi cập nhật quest chests_opened:', qe);
    }

    res.json({
      success: true,
      rewards: {
        pills: gainedPills,
        stones: gainedStones,
        hero: droppedHero,
        shards: gainedShards
      },
      remaining_chests: {
        wooden: chest_type === 'wooden' ? updatedRemaining : items.wooden_chests,
        silver: chest_type === 'silver' ? updatedRemaining : items.silver_chests,
        gold: chest_type === 'gold' ? updatedRemaining : items.gold_chests
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. API NHẬN THƯỞNG NHIỆM VỤ HÀNG NGÀY
router.post('/api/claim-quest', async (req, res) => {
  const userId = req.user.id;
  const { quest_id } = req.body;
  const questDef = QUEST_DEFINITIONS.find(q => q.id === quest_id);

  if (!questDef) {
    return res.status(400).json({ success: false, error: 'Nhiệm vụ không tồn tại!' });
  }

  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    const { data: qRow } = await supabase
      .from('user_card_quests')
      .select('*')
      .eq('user_id', userId)
      .eq('quest_date', todayStr)
      .maybeSingle();

    if (!qRow) {
      return res.status(400).json({ success: false, error: 'Chưa có tiến trình hôm nay!' });
    }

    const claimed = Array.isArray(qRow.claimed_quests) ? qRow.claimed_quests : [];
    if (claimed.includes(quest_id)) {
      return res.status(400).json({ success: false, error: 'Nhiệm vụ này bạn đã nhận thưởng rồi!' });
    }

    const currentVal = qRow[questDef.type] || 0;
    if (currentVal < questDef.target) {
      return res.status(400).json({ success: false, error: 'Chưa hoàn thành điều kiện nhiệm vụ!' });
    }

    // Trao thưởng vào user_card_items
    const { data: curItems } = await supabase
      .from('user_card_items')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (curItems) {
      const r = questDef.reward;
      await supabase
        .from('user_card_items')
        .update({
          wooden_chests: curItems.wooden_chests + (r.wooden_chests || 0),
          silver_chests: curItems.silver_chests + (r.silver_chests || 0),
          gold_chests: curItems.gold_chests + (r.gold_chests || 0),
          exp_pills: curItems.exp_pills + (r.exp_pills || 0),
          star_stones: curItems.star_stones + (r.star_stones || 0)
        })
        .eq('user_id', userId);
    }

    // Đánh dấu đã nhận
    const updatedClaimed = [...claimed, quest_id];
    await supabase
      .from('user_card_quests')
      .update({ claimed_quests: updatedClaimed, updated_at: new Date().toISOString() })
      .eq('id', qRow.id);

    res.json({
      success: true,
      reward_desc: questDef.reward_desc,
      claimed_quests: updatedClaimed
    });
  } catch (err) {
    console.error('Lỗi nhận thưởng nhiệm vụ:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. TRANG CHIẾN ĐẤU SÀN ĐẤU PVP (ARENA BATTLE SCENE)
router.get('/battle/:defender_id', async (req, res) => {
  const attackerId = req.user.id;
  const defenderId = req.params.defender_id;

  if (attackerId === defenderId) {
    return res.redirect('/arena?error=' + encodeURIComponent('Không thể tự khiêu chiến chính mình!'));
  }

  try {
    const { data: attackerRank } = await supabase
      .from('arena_ranks')
      .select('daily_tickets, elo_points, tier')
      .eq('user_id', attackerId)
      .single();

    if (!attackerRank || attackerRank.daily_tickets <= 0) {
      return res.redirect('/arena?error=' + encodeURIComponent('Bạn đã hết vé khiêu chiến hôm nay! Hãy quay lại vào ngày mai.'));
    }

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
      isDungeon: false,
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

// 8. TRANG CHIẾN ĐẤU VƯỢT ẢI THÁP THỬ THÁCH (PVE DUNGEON BATTLE SCENE)
router.get('/dungeon/:stage_id', async (req, res) => {
  const userId = req.user.id;
  const stageId = parseInt(req.params.stage_id);
  const stage = DUNGEON_STAGES.find(s => s.stage === stageId);

  if (!stage) {
    return res.redirect('/arena?error=' + encodeURIComponent('Màn chơi không tồn tại!'));
  }

  try {
    const { rank } = await ensureUserArenaData(userId);
    const userMaxStage = rank.dungeon_stage || 1;
    if (stageId > userMaxStage) {
      return res.redirect('/arena?error=' + encodeURIComponent(`Bạn chưa mở khóa Ải ${stageId}! Hãy hoàn thành các ải trước.`));
    }

    const { data: attackerTeamRaw } = await supabase
      .from('user_card_teams')
      .select('slot_1, slot_2, slot_3')
      .eq('user_id', userId)
      .single();

    const ids = [attackerTeamRaw?.slot_1, attackerTeamRaw?.slot_2, attackerTeamRaw?.slot_3].filter(Boolean);
    if (ids.length === 0) {
      return res.redirect('/arena?error=' + encodeURIComponent('Đội hình của bạn chưa có tướng nào!'));
    }

    const { data: heroes } = await supabase.from('card_heroes').select('*').in('id', ids);
    const { data: uHeroes } = await supabase.from('user_heroes').select('*').eq('user_id', userId).in('hero_id', ids);
    const uhMap = {};
    (uHeroes || []).forEach(uh => { uhMap[uh.hero_id] = uh; });

    const attackerTeam = (heroes || []).map(h => {
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

    const boss = {
      ...stage.boss,
      id: 999000 + stage.stage,
      rage: 0,
      max_rage: 100,
      isBoss: true
    };

    res.render('arena/battle', {
      title: `🏰 Vượt Ải Tầng ${stage.stage}: ${stage.name} - Tháp Thử Thách`,
      user: req.user,
      isDungeon: true,
      stage,
      defender: {
        id: 'dungeon_stage_' + stage.stage,
        display_name: `${stage.title}`,
        avatar: stage.avatar
      },
      attackerRank: rank,
      defenderRank: { elo_points: stage.combat_power, tier: `Ải ${stage.stage}` },
      attackerTeam,
      defenderTeam: [boss]
    });
  } catch (err) {
    console.error('Lỗi khởi tạo vượt ải:', err);
    res.status(500).send('Lỗi khi vào ải: ' + err.message);
  }
});

// 9. API KẾT THÚC TRẬN ĐẤU PVP & CẬP NHẬT RANK
router.post('/api/battle-result', async (req, res) => {
  const attackerId = req.user.id;
  const { defender_id, winner } = req.body;

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

    // Cập nhật Defender nếu là user thật
    if (defender_id && !defender_id.toString().startsWith('dungeon_')) {
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

    // Cập nhật quest: đánh đấu trường
    try {
      const todayStr = new Date().toISOString().slice(0, 10);
      const { data: qRow } = await supabase
        .from('user_card_quests')
        .select('id, battles_fought')
        .eq('user_id', attackerId)
        .eq('quest_date', todayStr)
        .maybeSingle();

      if (qRow) {
        await supabase.from('user_card_quests')
          .update({ battles_fought: qRow.battles_fought + 1, updated_at: new Date().toISOString() })
          .eq('id', qRow.id);
      } else {
        await supabase.from('user_card_quests')
          .insert([{ user_id: attackerId, quest_date: todayStr, battles_fought: 1 }]);
      }
    } catch (qe) {
      console.error('Lỗi cập nhật quest battles_fought:', qe);
    }

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

// 10. API KẾT THÚC TRẬN ĐẤU PVE VƯỢT ẢI (DUNGEON RESULT)
router.post('/api/dungeon-result', async (req, res) => {
  const userId = req.user.id;
  const { stage_id, winner } = req.body;
  const stageId = parseInt(stage_id);
  const stage = DUNGEON_STAGES.find(s => s.stage === stageId);

  if (!stage) {
    return res.status(400).json({ success: false, error: 'Màn chơi không hợp lệ!' });
  }

  const isWin = (winner === 'attacker');
  try {
    if (!isWin) {
      return res.json({ success: true, isWin: false, message: 'Thất bại đáng tiếc!' });
    }

    // Thắng: Kiểm tra xem màn này hôm nay đã nhận quà chưa (Mỗi ngày rơi 1 lần quà/ải)
    const todayStr = new Date().toISOString().slice(0, 10);
    const stageClaimKey = `dungeon_stage_${stageId}`;

    const { data: qRow } = await supabase
      .from('user_card_quests')
      .select('id, stages_cleared, claimed_quests')
      .eq('user_id', userId)
      .eq('quest_date', todayStr)
      .maybeSingle();

    const claimedList = qRow && qRow.claimed_quests ? qRow.claimed_quests : [];
    const alreadyClaimedToday = claimedList.includes(stageClaimKey);

    let rewardsGiven = null;
    let rewardDropped = false;

    // Cập nhật tầng cao nhất của user
    const { data: rank } = await supabase
      .from('arena_ranks')
      .select('dungeon_stage')
      .eq('user_id', userId)
      .single();

    let newStage = rank ? rank.dungeon_stage : 1;
    let isFirstClear = false;
    if (rank && stageId >= (rank.dungeon_stage || 1)) {
      newStage = Math.min(11, stageId + 1);
      await supabase
        .from('arena_ranks')
        .update({ dungeon_stage: newStage })
        .eq('user_id', userId);
      isFirstClear = true;
    }

    if (!alreadyClaimedToday) {
      // Trao thưởng vượt ải nếu hôm nay chưa nhận quà màn này
      const r = stage.rewards;
      const { data: curItems } = await supabase
        .from('user_card_items')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (curItems) {
        await supabase
          .from('user_card_items')
          .update({
            wooden_chests: curItems.wooden_chests + (r.wooden_chests || 0),
            silver_chests: curItems.silver_chests + (r.silver_chests || 0),
            gold_chests: curItems.gold_chests + (r.gold_chests || 0),
            exp_pills: curItems.exp_pills + (r.exp_pills || 0),
            star_stones: curItems.star_stones + (r.star_stones || 0)
          })
          .eq('user_id', userId);
      }
      rewardsGiven = r;
      rewardDropped = true;

      // Đánh dấu màn này hôm nay đã nhận quà
      const newClaimed = Array.from(new Set([...claimedList, stageClaimKey]));
      if (qRow) {
        await supabase.from('user_card_quests')
          .update({
            claimed_quests: newClaimed,
            stages_cleared: (qRow.stages_cleared || 0) + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', qRow.id);
      } else {
        await supabase.from('user_card_quests')
          .insert([{ user_id: userId, quest_date: todayStr, stages_cleared: 1, claimed_quests: [stageClaimKey] }]);
      }
    } else {
      // Đã nhận quà hôm nay rồi, chỉ cộng tiến độ nhiệm vụ
      if (qRow) {
        await supabase.from('user_card_quests')
          .update({ stages_cleared: (qRow.stages_cleared || 0) + 1, updated_at: new Date().toISOString() })
          .eq('id', qRow.id);
      } else {
        await supabase.from('user_card_quests')
          .insert([{ user_id: userId, quest_date: todayStr, stages_cleared: 1, claimed_quests: [] }]);
      }
    }

    res.json({
      success: true,
      isWin: true,
      isFirstClear,
      newStage,
      rewardDropped,
      rewards: rewardsGiven,
      message: rewardDropped ? 'Chiến thắng & nhận quà vượt ải thành công!' : 'Chiến thắng! (Màn này hôm nay bạn đã nhận quà rồi, mai đánh tiếp nhé!)'
    });
  } catch (err) {
    console.error('Lỗi kết quả vượt ải:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
