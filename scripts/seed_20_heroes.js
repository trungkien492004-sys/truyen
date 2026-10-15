const { Client } = require('pg');

const cs = 'postgresql://postgres.hdfwyfdrgkueatxkxuky:Yugiki4910%40@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';

const HEROES = [
  {
    id: 1,
    name: "Liễu Như Yên",
    title: "Hỏa Vũ Yêu Cơ",
    rarity: "R",
    element: "fire",
    role: "dps",
    hp: 1080,
    atk: 170,
    def: 68,
    spd: 90,
    crit: 7.0,
    shards: 10,
    ulti_rate: 1.7,
    bio: "Kiêu kỳ, thích trêu người; váy lụa đỏ và quạt phượng.",
    skill_basic: { name: "Hỏa Vũ Tiêu Dao", desc: "Phất quạt phóng hỏa tiễn vào mục tiêu", dmg_rate: 1.0, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Phượng Hoàng Liệt Hỏa", desc: "Triệu hồi phượng hoàng lửa thiêu rụi mục tiêu", dmg_rate: 1.7, rage_cost: 100, target: "single" },
    skill_passive: { name: "Yêu Cơ Mị Hoặc", desc: "Tăng vĩnh viễn 7% Công và 5% Bạo kích" }
  },
  {
    id: 2,
    name: "Tô Mộng Dao",
    title: "Nguyệt Ảnh Hồng Nhan",
    rarity: "R",
    element: "water",
    role: "support",
    hp: 1150,
    atk: 155,
    def: 75,
    spd: 92,
    crit: 6.0,
    shards: 10,
    ulti_rate: 0,
    bio: "Dịu dàng, kín đáo; áo lụa hồng trễ vai, trang sức trăng.",
    skill_basic: { name: "Thủy Nguyệt Ba", desc: "Bắn tia sáng nước tấn công mục tiêu", dmg_rate: 1.0, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Nguyệt Hoa Tẩy Lễ", desc: "Ánh trăng dịu mát hồi phục sinh lực toàn đội", dmg_rate: 0, rage_cost: 100, target: "heal_all" },
    skill_passive: { name: "Thanh Tâm Lạc", desc: "Tăng 10% Lượng trị liệu và 8% Máu" }
  },
  {
    id: 3,
    name: "Bạch Linh Nhi",
    title: "Tuyết Quốc Tiên Tử",
    rarity: "R",
    element: "wind",
    role: "mage",
    hp: 1020,
    atk: 180,
    def: 65,
    spd: 95,
    crit: 8.0,
    shards: 10,
    ulti_rate: 1.1,
    bio: "Lạnh lùng nhưng dễ đỏ mặt; cổ phục xanh băng.",
    skill_basic: { name: "Phong Nhẫn Băng Tiễn", desc: "Lưỡi đao gió băng tấn công kẻ địch", dmg_rate: 1.0, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Bão Tuyết Cuồng Phong", desc: "Gió lốc băng giá càn quét toàn bộ đội hình đối phương", dmg_rate: 1.1, rage_cost: 100, target: "all" },
    skill_passive: { name: "Băng Tâm", desc: "Tăng 8% Sát thương kỹ năng diện rộng" }
  },
  {
    id: 4,
    name: "Hạ Vân Nhi",
    title: "Ảnh Vũ",
    rarity: "R",
    element: "thunder",
    role: "assassin",
    hp: 1000,
    atk: 195,
    def: 60,
    spd: 105,
    crit: 10.0,
    shards: 10,
    ulti_rate: 1.8,
    bio: "Tinh nghịch, bí ẩn; giáp da đen tím và khăn voan.",
    skill_basic: { name: "Ám Lôi Trảo", desc: "Tia chớp đen xé rách phòng ngự kẻ địch", dmg_rate: 1.0, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Vũ Điệu Lôi Quang", desc: "Ám ảnh dịch chuyển đâm xuyên tim mục tiêu", dmg_rate: 1.8, rage_cost: 100, target: "single" },
    skill_passive: { name: "Bóng Đêm Thần Tốc", desc: "Tăng 10 Tốc độ và 10% Bạo kích" }
  },
  {
    id: 5,
    name: "Diệp Tâm",
    title: "Thánh Quang Tiểu Thư",
    rarity: "R",
    element: "light",
    role: "tank",
    hp: 1350,
    atk: 140,
    def: 95,
    spd: 85,
    crit: 5.0,
    shards: 10,
    ulti_rate: 0,
    bio: "Ấm áp, cứng cỏi; áo giáp trắng vàng và áo choàng.",
    skill_basic: { name: "Quang Minh Thuẫn Kích", desc: "Dùng khiên nện mạnh kẻ địch", dmg_rate: 1.0, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Thánh Vực Bất Hoại", desc: "Dựng kết giới thánh quang giảm 35% sát thương nhận vào toàn đội", dmg_rate: 0, rage_cost: 100, target: "buff_all" },
    skill_passive: { name: "Ý Chí Kiên Cường", desc: "Tăng 15% Máu và 10% Thủ" }
  },
  {
    id: 6,
    name: "Mộ Dung Nguyệt",
    title: "U Minh Ma Nữ",
    rarity: "SR",
    element: "dark",
    role: "dps",
    hp: 1600,
    atk: 240,
    def: 100,
    spd: 100,
    crit: 12.0,
    shards: 20,
    ulti_rate: 2.2,
    bio: "Sắc sảo, thích khiêu khích; váy nhung tím hở vai.",
    skill_basic: { name: "U Hồn Trảm", desc: "Kiếm khí u tối chém đứt mục tiêu", dmg_rate: 1.0, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Ma Thần Hắc Hỏa", desc: "Bùng nổ ngọn lửa địa ngục hủy diệt kẻ thù", dmg_rate: 2.2, rage_cost: 100, target: "single" },
    skill_passive: { name: "Ma Khí Triều Tịch", desc: "Khi máu dưới 50%, tăng thêm 20% Công" }
  },
  {
    id: 7,
    name: "Cố Thanh Hà",
    title: "Hàn Giang Kiếm Tiên",
    rarity: "SR",
    element: "water",
    role: "assassin",
    hp: 1450,
    atk: 285,
    def: 82,
    spd: 120,
    crit: 19.0,
    shards: 20,
    ulti_rate: 2.2,
    bio: "Ít nói, trung thành; trường kiếm và trang phục xanh bạc.",
    skill_basic: { name: "Lạc Diệp Vô Ngân", desc: "Mũi kiếm nhanh như gió lướt qua yếu huyệt", dmg_rate: 1.05, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Hàn Băng Thập Tam Kiếm", desc: "Mười ba nhát kiếm băng tuyết dồn dập trí mạng", dmg_rate: 2.2, rage_cost: 100, target: "single" },
    skill_passive: { name: "Kiếm Tâm Minh Kính", desc: "Tăng 15 Tốc độ và 12% Tỉ lệ Bạo kích" }
  },
  {
    id: 8,
    name: "Lâm Yên Nhi",
    title: "Hoa Gian Tà Nữ",
    rarity: "SR",
    element: "fire",
    role: "mage",
    hp: 1450,
    atk: 260,
    def: 95,
    spd: 105,
    crit: 13.0,
    shards: 20,
    ulti_rate: 1.5,
    bio: "Lém lỉnh, mê hoa; kimono đỏ với dây nơ lớn.",
    skill_basic: { name: "Bách Hoa Hỏa Diễm", desc: "Cánh hoa lửa bay tới thiêu đốt địch", dmg_rate: 1.0, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Vạn Hoa Diệt Tuyệt", desc: "Cơn bão biển hoa lửa quét sạch trận địa kẻ địch", dmg_rate: 1.5, rage_cost: 100, target: "all" },
    skill_passive: { name: "Hỏa Hoa Dẫn Dụ", desc: "Mỗi đòn đánh thường có 30% gây bỏng thêm sát thương" }
  },
  {
    id: 9,
    name: "Thẩm Mộng Dao",
    title: "Song Sinh Yêu Cơ",
    rarity: "SR",
    element: "wind",
    role: "support",
    hp: 1700,
    atk: 200,
    def: 120,
    spd: 110,
    crit: 12.0,
    shards: 20,
    ulti_rate: 0,
    bio: "Hay đùa, chữa lành đồng đội; váy xanh ngọc xẻ tà.",
    skill_basic: { name: "Ngọc Phong Ba", desc: "Gió lành tấn công địch, hồi chút sinh lực cho bản thân", dmg_rate: 1.0, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Thần Phong Tái Sinh", desc: "Cơn gió sinh mệnh phục hồi lượng máu lớn cho toàn đội", dmg_rate: 0, rage_cost: 100, target: "heal_all" },
    skill_passive: { name: "Song Thần Hộ Thể", desc: "Tăng 12% Máu và hồi 5 Nộ mỗi hiệp cho đồng đội" }
  },
  {
    id: 10,
    name: "Ngọc Khê",
    title: "Tử Điện Công Chúa",
    rarity: "SR",
    element: "thunder",
    role: "tank",
    hp: 2100,
    atk: 180,
    def: 145,
    spd: 90,
    crit: 10.0,
    shards: 20,
    ulti_rate: 0,
    bio: "Ngạo kiều, bảo vệ kẻ yếu; giáp tím ánh điện.",
    skill_basic: { name: "Lôi Đình Chùy", desc: "Dùng sấm sét cường hóa cú đập", dmg_rate: 1.0, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Thiên Lôi Hộ Trận", desc: "Tạo lưới điện bảo vệ toàn quân, phản lại 25% sát thương", dmg_rate: 0, rage_cost: 100, target: "buff_all" },
    skill_passive: { name: "Lôi Cương Thể", desc: "Tăng 20% Phòng thủ và miễn nhiễm khống chế" }
  },
  {
    id: 11,
    name: "Thiên Thiên",
    title: "Kim Ô Thánh Nữ",
    rarity: "SSR",
    element: "fire",
    role: "dps",
    hp: 2200,
    atk: 320,
    def: 150,
    spd: 115,
    crit: 16.0,
    shards: 30,
    ulti_rate: 2.6,
    bio: "Tự tin, kiêu sa; váy vàng đỏ và trâm phượng.",
    skill_basic: { name: "Thái Dương Chân Hỏa", desc: "Tia lửa mặt trời chói lọi thiêu rụi mục tiêu", dmg_rate: 1.1, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Kim Ô Phần Thiên", desc: "Thần điểu Kim Ô giáng trần hủy diệt mục tiêu", dmg_rate: 2.6, rage_cost: 100, target: "single" },
    skill_passive: { name: "Thánh Dương Chi Thể", desc: "Tăng 15% Công và 10% Tỉ lệ Bạo kích" }
  },
  {
    id: 12,
    name: "Lạc Băng Tâm",
    title: "Băng Nguyệt Nữ Hoàng",
    rarity: "SSR",
    element: "water",
    role: "mage",
    hp: 2100,
    atk: 340,
    def: 130,
    spd: 120,
    crit: 18.0,
    shards: 30,
    ulti_rate: 2.0,
    bio: "Điềm tĩnh, có phần xa cách; đầm băng lam lấp lánh.",
    skill_basic: { name: "Hàn Băng Tinh Thể", desc: "Mảnh băng sắc nhọn bắn thẳng vào mục tiêu", dmg_rate: 1.1, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Cực Hàn Tuyệt Vực", desc: "Đóng băng vĩnh cửu toàn bộ quân địch với uy lực cực lớn", dmg_rate: 2.0, rage_cost: 100, target: "all" },
    skill_passive: { name: "Nữ Hoàng Băng Tuyết", desc: "Tăng 20% Sát thương nguyên tố Băng và Thủy" }
  },
  {
    id: 13,
    name: "Hàn Tuyết Nhi",
    title: "Ảnh Nguyệt Sát Thủ",
    rarity: "SSR",
    element: "dark",
    role: "assassin",
    hp: 1750,
    atk: 420,
    def: 105,
    spd: 140,
    crit: 24.0,
    shards: 30,
    ulti_rate: 2.7,
    bio: "Quyến rũ, nguy hiểm; váy đen và đôi đoản đao.",
    skill_basic: { name: "Ám Nguyệt Đoản Đao", desc: "Lưỡi đao bóng tối cắt vào cổ họng", dmg_rate: 1.15, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Tử Thần Dạ Khúc", desc: "Tuyệt kỹ ám sát chớp nhoáng với sát thương bộc phá chí mạng", dmg_rate: 2.7, rage_cost: 100, target: "single" },
    skill_passive: { name: "Huyết Nguyệt Chi Nhãn", desc: "Tăng 20% Sát thương bạo kích và 15 Tốc độ" }
  },
  {
    id: 14,
    name: "Triệu Vô Song",
    title: "Chiến Thần Mỹ Nhân",
    rarity: "SSR",
    element: "thunder",
    role: "tank",
    hp: 3000,
    atk: 240,
    def: 205,
    spd: 98,
    crit: 15.0,
    shards: 30,
    ulti_rate: 0,
    bio: "Mạnh mẽ, hào sảng; giáp chiến màu đỏ thẫm.",
    skill_basic: { name: "Bá Vương Thương", desc: "Thương đâm dũng mãnh đẩy lùi kẻ địch", dmg_rate: 1.0, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Bất Khả Xâm Phạm", desc: "Hóa thành tường thành sấm sét, hấp thụ 50% sát thương đồng đội", dmg_rate: 0, rage_cost: 100, target: "buff_all" },
    skill_passive: { name: "Chiến Thần Chi Khu", desc: "Tăng 25% Máu tối đa và 15% Phòng thủ" }
  },
  {
    id: 15,
    name: "Thái Lan",
    title: "Thánh Quang Hiền Hậu",
    rarity: "SSR",
    element: "light",
    role: "support",
    hp: 2650,
    atk: 240,
    def: 180,
    spd: 120,
    crit: 15.0,
    shards: 30,
    ulti_rate: 0,
    bio: "Bao dung, tinh tế; lễ phục trắng vàng đính đá.",
    skill_basic: { name: "Quang Huy Chúc Phúc", desc: "Ánh sáng chiếu rọi kẻ địch và gia cố giáp đồng đội", dmg_rate: 1.0, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Thần Tích Giáng Lâm", desc: "Hồi phục 40% máu và tăng 25% Công cho toàn thể đồng minh", dmg_rate: 0, rage_cost: 100, target: "heal_all" },
    skill_passive: { name: "Mẫu Nghi Thiên Hạ", desc: "Tăng 15% Thủ cho toàn đội khi còn sống" }
  },
  {
    id: 16,
    name: "Sở Nhan",
    title: "Phong Hoa Tuyệt Đại",
    rarity: "UR",
    element: "fire",
    role: "assassin",
    hp: 2600,
    atk: 540,
    def: 145,
    spd: 150,
    crit: 29.0,
    shards: 50,
    ulti_rate: 3.2,
    bio: "Nồng nhiệt, khiêu khích; trường bào đỏ cắt xẻ thanh lịch.",
    skill_basic: { name: "Chu Tước Hồng Trảm", desc: "Tia kiếm lửa đỏ rực xé toạc không gian", dmg_rate: 1.25, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Cửu U Liệt Diệt", desc: "Hóa thân thần kiếm Chu Tước đoạt mạng kẻ thù trong một đòn", dmg_rate: 3.2, rage_cost: 100, target: "single" },
    skill_passive: { name: "Hỏa Thần Niết Bàn", desc: "Tăng 25% Công, 20 Tốc độ và 15% Tỉ lệ Bạo kích" }
  },
  {
    id: 17,
    name: "Cửu Thiên Nguyệt",
    title: "Ma Tôn",
    rarity: "UR",
    element: "dark",
    role: "mage",
    hp: 2800,
    atk: 450,
    def: 180,
    spd: 135,
    crit: 23.0,
    shards: 50,
    ulti_rate: 2.5,
    bio: "Lạnh lẽo, quyền lực; đầm tím đen, vương miện trăng.",
    skill_basic: { name: "Ma Hoàng U Quang", desc: "Chùm sáng hắc ám áp chế thần hồn", dmg_rate: 1.2, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Hắc Dạ Tận Diệt", desc: "Mở ra cổng địa ngục nuốt chửng toàn bộ đội hình đối phương", dmg_rate: 2.5, rage_cost: 100, target: "all" },
    skill_passive: { name: "Vạn Ma Chi Tôn", desc: "Tăng 25% Sát thương toàn thể và giảm 20% nộ của kẻ địch bị đánh" }
  },
  {
    id: 18,
    name: "Kỷ Nhan",
    title: "Tiên Giới Mộng Chủ",
    rarity: "UR",
    element: "water",
    role: "support",
    hp: 3550,
    atk: 315,
    def: 240,
    spd: 140,
    crit: 21.0,
    shards: 50,
    ulti_rate: 0,
    bio: "Tinh nghịch mà nhân hậu; váy hồng và voan ngọc.",
    skill_basic: { name: "Mộng Điệp Tiên Ba", desc: "Đàn bướm tiên thần bí tấn công kẻ thù", dmg_rate: 1.1, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Mộng Cảnh Hồi Xuân", desc: "Hồi sinh hoặc hồi đầy 50% HP cho toàn bộ đồng đội", dmg_rate: 0, rage_cost: 100, target: "heal_all" },
    skill_passive: { name: "Mộng Giới Chi Chủ", desc: "Tăng 30% Lượng trị liệu và tạo khiên chắn cho đồng minh yếu nhất" }
  },
  {
    id: 19,
    name: "Vân Chi Hi",
    title: "Thiên Hạ Đệ Nhất Kiếm",
    rarity: "UR",
    element: "wind",
    role: "dps",
    hp: 3100,
    atk: 420,
    def: 190,
    spd: 128,
    crit: 21.0,
    shards: 50,
    ulti_rate: 3.1,
    bio: "Chính trực, bướng bỉnh; áo kiếm tiên trắng bạc.",
    skill_basic: { name: "Thái Hư Kiếm Khí", desc: "Kiếm khí hư vô vô ảnh vô hình xuyên phá giáp", dmg_rate: 1.2, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Vạn Kiếm Quy Nhất", desc: "Triệu hồi vạn đạo kiếm tiên chém rách bầu trời tiêu diệt mục tiêu", dmg_rate: 3.1, rage_cost: 100, target: "single" },
    skill_passive: { name: "Kiếm Thánh Chi Hồn", desc: "Bỏ qua 30% Giáp phòng ngự của kẻ địch trong mọi đòn đánh" }
  },
  {
    id: 20,
    name: "Ninh Tuyết",
    title: "Thần Tộc Chi Nữ",
    rarity: "UR",
    element: "light",
    role: "tank",
    hp: 4400,
    atk: 285,
    def: 285,
    spd: 95,
    crit: 18.0,
    shards: 50,
    ulti_rate: 0,
    bio: "Kiêu hãnh, bảo hộ nhân gian; giáp thiên sứ trắng vàng.",
    skill_basic: { name: "Thần Quang Phạt Tội", desc: "Thần kiếm thánh quang trừng phạt tà ma", dmg_rate: 1.0, rage_gain: 25, target: "single" },
    skill_ultimate: { name: "Bất Diệt Thần Giới", desc: "Khiến toàn đội bất tử trong 1 hiệp và giảm 50% sát thương nhận vào", dmg_rate: 0, rage_cost: 100, target: "buff_all" },
    skill_passive: { name: "Bất Hoại Chi Thân", desc: "Tăng 35% Máu tối đa và 30% Phòng thủ vĩnh viễn" }
  }
];

async function run() {
  const client = new Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to PostgreSQL!');

  // Clear references
  await client.query('UPDATE user_card_teams SET slot_1 = NULL, slot_2 = NULL, slot_3 = NULL;');
  await client.query('DELETE FROM user_heroes;');
  await client.query('DELETE FROM card_heroes;');
  console.log('Cleared old heroes & user rosters.');

  const insertSql = `
    INSERT INTO card_heroes (
      id, name, title, bio, rarity, element, role,
      base_hp, base_atk, base_def, base_spd, base_crit,
      shards_to_summon, avatar_url, card_image_url,
      skill_basic, skill_ultimate, skill_passive
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12,
      $13, $14, $15,
      $16, $17, $18
    );
  `;

  for (const h of HEROES) {
    const imgUrl = `/uploads/heroes/hero_${h.id}.jpg`;
    await client.query(insertSql, [
      h.id, h.name, h.title, h.bio, h.rarity, h.element, h.role,
      h.hp, h.atk, h.def, h.spd, h.crit,
      h.shards, imgUrl, imgUrl,
      JSON.stringify(h.skill_basic), JSON.stringify(h.skill_ultimate), JSON.stringify(h.skill_passive)
    ]);
    console.log(`Inserted [${h.rarity}] ${h.name} (${h.title})`);
  }

  // Set sequence
  await client.query("SELECT setval('card_heroes_id_seq', 20, true);");

  // Give all users starter hero: Liễu Như Yên (id: 1)
  const { rows: users } = await client.query('SELECT id FROM users;');
  for (const u of users) {
    await client.query(`
      INSERT INTO user_heroes (user_id, hero_id, is_unlocked, shards, level, star)
      VALUES ($1, 1, true, 0, 1, 1)
      ON CONFLICT (user_id, hero_id) DO NOTHING;
    `, [u.id]);
    await client.query(`
      INSERT INTO user_heroes (user_id, hero_id, is_unlocked, shards, level, star)
      VALUES ($1, 2, false, 8, 1, 1)
      ON CONFLICT (user_id, hero_id) DO NOTHING;
    `, [u.id]);
    await client.query(`
      UPDATE user_card_teams
      SET slot_1 = 1, combat_power = 1200
      WHERE user_id = $1;
    `, [u.id]);
  }

  console.log('Seeded 20 heroes and initial rosters for all users!');
  await client.end();
}

run().catch(err => {
  console.error('Seeding error:', err);
  process.exit(1);
});
