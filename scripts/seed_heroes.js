const { Client } = require('C:/Users/Kien/.gemini/antigravity/scratch/truyen/node_modules/pg');

const cs = 'postgresql://postgres.hdfwyfdrgkueatxkxuky:Yugiki4910%40@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';

const sampleHeroes = [
  {
    name: 'Nhiễm Nhiễm',
    title: 'Cực Phẩm Mị Hoặc',
    bio: 'Nàng thơ nổi danh bậc nhất với vẻ đẹp phong tình vạn chủng, ánh mắt mê hoặc lòng người và thân hình tuyệt mỹ.',
    rarity: 'SSR',
    element: 'water',
    role: 'dps',
    base_hp: 1200,
    base_atk: 280,
    base_def: 90,
    base_spd: 105,
    base_crit: 15.0,
    avatar_url: 'https://xlaqupbqiwpoprywnkgi.supabase.co/storage/v1/object/public/uploads/1784104128733-667218828.jpg',
    card_image_url: 'https://xlaqupbqiwpoprywnkgi.supabase.co/storage/v1/object/public/uploads/1784104128733-667218828.jpg',
    skill_basic: {
      name: 'Mị Hoặc Chi Nhãn',
      desc: 'Tấn công 1 kẻ địch gây 100% sát thương, hồi 25 Nộ và giảm 10% Công đối phương.',
      dmg_rate: 1.0,
      rage_gain: 25,
      target: 'single'
    },
    skill_ultimate: {
      name: 'Dục Hải Triều Dâng',
      desc: 'Tiêu hao 100 Nộ. Gây 220% sát thương toàn đội hình địch, có 50% cơ hội làm Mê Hoặc khiến kẻ địch không thể hành động 1 hiệp.',
      dmg_rate: 2.2,
      rage_cost: 100,
      target: 'all',
      effect: 'stun',
      effect_rate: 0.5
    },
    skill_passive: {
      name: 'Thủy Linh Thể',
      desc: 'Tự tăng 15% Tỷ lệ Chí Mạng và hồi phục 5% Máu mỗi khi bắt đầu hiệp đấu.'
    },
    shards_to_summon: 50
  },
  {
    name: 'Liễu Như Yên',
    title: 'Băng Tuyết Kiếm Tiên',
    bio: 'Thánh nữ Băng Cung lãnh diễm thanh cao, kiếm pháp xuất thần nhập hóa, một kiếm định đoạt càn khôn.',
    rarity: 'SSR',
    element: 'wind',
    role: 'dps',
    base_hp: 1100,
    base_atk: 310,
    base_def: 75,
    base_spd: 115,
    base_crit: 20.0,
    avatar_url: 'https://hdfwyfdrgkueatxkxuky.supabase.co/storage/v1/object/public/uploads/1788606722709-580559886.jpg',
    card_image_url: 'https://hdfwyfdrgkueatxkxuky.supabase.co/storage/v1/object/public/uploads/1788606722709-580559886.jpg',
    skill_basic: {
      name: 'Hàn Băng Kiếm Khí',
      desc: 'Phóng kiếm khí sắc lạnh tấn công 1 kẻ địch gây 110% sát thương, hồi 25 Nộ.',
      dmg_rate: 1.1,
      rage_gain: 25,
      target: 'single'
    },
    skill_ultimate: {
      name: 'Vạn Kiếm Quy Tông',
      desc: 'Tiêu hao 100 Nộ. Ngưng tụ ngàn đạo băng kiếm chém 3 liên kích dồn dập vào mục tiêu gây 350% sát thương cực đại.',
      dmg_rate: 3.5,
      rage_cost: 100,
      target: 'single',
      effect: 'crit_burst'
    },
    skill_passive: {
      name: 'Tật Phong Bộ',
      desc: 'Tăng vĩnh viễn 15 Tốc độ (SPD), luôn chiếm quyền xuất chiêu trước đối thủ.'
    },
    shards_to_summon: 50
  },
  {
    name: 'Cố Thanh Y',
    title: 'Yêu Nhi Diệu Thủ',
    bio: 'Truyền nhân Y Đạo xinh đẹp dịu dàng nhưng không kém phần quyến rũ, một tay cứu nhân, một tay trừ ma.',
    rarity: 'SR',
    element: 'fire',
    role: 'healer',
    base_hp: 1350,
    base_atk: 180,
    base_def: 100,
    base_spd: 95,
    base_crit: 5.0,
    avatar_url: 'https://hdfwyfdrgkueatxkxuky.supabase.co/storage/v1/object/public/uploads/1788617259092-94684534.png',
    card_image_url: 'https://hdfwyfdrgkueatxkxuky.supabase.co/storage/v1/object/public/uploads/1788617259092-94684534.png',
    skill_basic: {
      name: 'Hỏa Châm Kích',
      desc: 'Bắn kim châm rực lửa gây 80% sát thương lên 1 kẻ địch, hồi 25 Nộ.',
      dmg_rate: 0.8,
      rage_gain: 25,
      target: 'single'
    },
    skill_ultimate: {
      name: 'Cửu Chuyển Hồi Xuân',
      desc: 'Tiêu hao 100 Nộ. Khởi tạo trận pháp sinh mệnh hồi phục 35% Máu tối đa cho toàn bộ đội hình.',
      dmg_rate: 0.0,
      rage_cost: 100,
      target: 'all_allies',
      heal_rate: 0.35,
      effect: 'heal_team'
    },
    skill_passive: {
      name: 'Dược Vương Thân',
      desc: 'Tăng 20% khả năng Hồi máu cho toàn bộ kỹ năng của bản thân.'
    },
    shards_to_summon: 30
  },
  {
    name: 'Bạch Dao',
    title: 'Tiểu Hồ Ly Tinh Quái',
    bio: 'Thiếu nữ Hồ Tộc tinh nghịch đáng yêu, sở hữu lôi điện thần thông linh hoạt thoắt ẩn thoắt hiện.',
    rarity: 'R',
    element: 'thunder',
    role: 'dps',
    base_hp: 950,
    base_atk: 210,
    base_def: 70,
    base_spd: 100,
    base_crit: 10.0,
    avatar_url: 'https://xlaqupbqiwpoprywnkgi.supabase.co/storage/v1/object/public/uploads/1785133067969-205456273.png',
    card_image_url: 'https://xlaqupbqiwpoprywnkgi.supabase.co/storage/v1/object/public/uploads/1785133067969-205456273.png',
    skill_basic: {
      name: 'Lôi Cào',
      desc: 'Vuốt hồ ly mang điện chém 1 mục tiêu gây 100% sát thương, hồi 25 Nộ.',
      dmg_rate: 1.0,
      rage_gain: 25,
      target: 'single'
    },
    skill_ultimate: {
      name: 'Thiên Lôi Phạt',
      desc: 'Tiêu hao 100 Nộ. Triệu hồi sấm sét giáng xuống gây 180% sát thương lên 2 kẻ địch ngẫu nhiên, có 30% làm Tê Liệt.',
      dmg_rate: 1.8,
      rage_cost: 100,
      target: 'random_2',
      effect: 'paralyze',
      effect_rate: 0.3
    },
    skill_passive: {
      name: 'Linh Động',
      desc: 'Tăng vĩnh viễn 10% Tỷ lệ Né tránh đòn đánh.'
    },
    shards_to_summon: 20
  }
];

async function seed() {
  const client = new Client({ connectionString: cs });
  try {
    await client.connect();
    console.log('Seeding sample heroes...');
    
    for (const h of sampleHeroes) {
      await client.query(`
        INSERT INTO card_heroes (name, title, bio, rarity, element, role, base_hp, base_atk, base_def, base_spd, base_crit, avatar_url, card_image_url, skill_basic, skill_ultimate, skill_passive, shards_to_summon)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT DO NOTHING;
      `, [
        h.name, h.title, h.bio, h.rarity, h.element, h.role,
        h.base_hp, h.base_atk, h.base_def, h.base_spd, h.base_crit,
        h.avatar_url, h.card_image_url,
        JSON.stringify(h.skill_basic),
        JSON.stringify(h.skill_ultimate),
        JSON.stringify(h.skill_passive),
        h.shards_to_summon
      ]);
    }
    console.log('Seeded 4 sample heroes successfully!');
  } catch (err) {
    console.error('Seed error:', err);
  } finally {
    await client.end();
  }
}

seed();
