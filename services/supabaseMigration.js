const supabase = require('../config/supabase');

const OLD_SUPABASE_HOST = 'xlaqupbqiwpoprywnkgi.supabase.co';
const NEW_BUCKET = 'uploads';

// URL kiểm tra xem Supabase cũ đã mở khóa hay chưa (trả về 200 thay vì 402/403)
const PROBE_URL = 'https://xlaqupbqiwpoprywnkgi.supabase.co/storage/v1/object/public/uploads/1783789504546-996253389.jpg';

/**
 * Kiểm tra xem Supabase cũ đã mở lại băng thông hay chưa
 */
async function checkOldSupabaseAvailability() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(PROBE_URL, { method: 'HEAD', signal: controller.signal });
    clearTimeout(timeout);
    return {
      available: res.ok,
      status: res.status,
      statusText: res.statusText
    };
  } catch (err) {
    return {
      available: false,
      status: 0,
      statusText: err.message
    };
  }
}

/**
 * Tải ảnh từ URL Supabase cũ và đẩy lên Supabase mới
 */
async function migrateImageToNewSupabase(oldUrl) {
  if (!oldUrl || typeof oldUrl !== 'string' || !oldUrl.includes(OLD_SUPABASE_HOST)) {
    return oldUrl;
  }
  try {
    const filename = oldUrl.split('/').pop().split('?')[0];
    const res = await fetch(oldUrl);
    if (!res.ok) {
      console.warn(`[MIGRATION] Không tải được ảnh cũ ${oldUrl}: HTTP ${res.status}`);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = res.headers.get('content-type') || 'image/jpeg';

    const { error: uploadErr } = await supabase.storage
      .from(NEW_BUCKET)
      .upload(filename, buffer, { contentType, upsert: true });

    if (uploadErr) {
      console.error(`[MIGRATION] Lỗi đẩy ảnh ${filename} lên Supabase mới:`, uploadErr.message);
      return null;
    }

    const { data: pubData } = supabase.storage.from(NEW_BUCKET).getPublicUrl(filename);
    return pubData ? pubData.publicUrl : null;
  } catch (err) {
    console.error(`[MIGRATION] Ngoại lệ khi chuyển ảnh ${oldUrl}:`, err.message);
    return null;
  }
}

/**
 * Quét toàn bộ database và di chuyển ảnh từ Supabase cũ về Supabase mới ngay khi mở
 */
async function runAutoMigration() {
  console.log('[MIGRATION] 🔍 Kiểm tra trạng thái Supabase cũ (xlaqupbqiwpoprywnkgi)...');
  const probe = await checkOldSupabaseAvailability();
  if (!probe.available) {
    console.log(`[MIGRATION] ⏳ Supabase cũ hiện vẫn đang bị khóa (HTTP ${probe.status}: ${probe.statusText}). Tiếp tục chờ mở khóa.`);
    return {
      success: false,
      unlocked: false,
      status: probe.status,
      message: `Supabase cũ hiện trả về HTTP ${probe.status} (${probe.statusText}). Hệ thống sẽ tự động quét và tải lại ngay khi mở.`
    };
  }

  console.log('[MIGRATION] 🎉 SUPABASE CŨ ĐÃ MỞ KHÓA! Lập tức tiến hành tải toàn bộ ảnh về Supabase mới...');
  
  let migratedStories = 0;
  let migratedUsers = 0;
  let migratedBanners = 0;
  let migratedHeroes = 0;
  let errors = [];

  // 1. Quét ảnh bìa truyện (stories)
  const { data: stories } = await supabase.from('stories').select('id, title, cover_url');
  const oldStories = (stories || []).filter(s => s.cover_url && s.cover_url.includes(OLD_SUPABASE_HOST));
  console.log(`[MIGRATION] Tìm thấy ${oldStories.length} bìa truyện cần phục hồi.`);

  for (const s of oldStories) {
    const newUrl = await migrateImageToNewSupabase(s.cover_url);
    if (newUrl) {
      await supabase.from('stories').update({ cover_url: newUrl }).eq('id', s.id);
      migratedStories++;
      console.log(`[MIGRATION] ✅ Đã phục hồi bìa truyện [${s.id}] "${s.title}"`);
    } else {
      errors.push(`Story ID ${s.id} (${s.title})`);
    }
  }

  // 2. Quét avatar thành viên (users)
  const { data: users } = await supabase.from('users').select('id, display_name, avatar, equipped_avatar');
  const oldUsers = (users || []).filter(u => 
    (u.avatar && u.avatar.includes(OLD_SUPABASE_HOST)) || 
    (u.equipped_avatar && u.equipped_avatar.includes(OLD_SUPABASE_HOST))
  );
  console.log(`[MIGRATION] Tìm thấy ${oldUsers.length} tài khoản người dùng có avatar cần phục hồi.`);

  for (const u of oldUsers) {
    let updateFields = {};
    if (u.avatar && u.avatar.includes(OLD_SUPABASE_HOST)) {
      const newAv = await migrateImageToNewSupabase(u.avatar);
      if (newAv) updateFields.avatar = newAv;
    }
    if (u.equipped_avatar && u.equipped_avatar.includes(OLD_SUPABASE_HOST)) {
      const newEq = await migrateImageToNewSupabase(u.equipped_avatar);
      if (newEq) updateFields.equipped_avatar = newEq;
    }
    if (Object.keys(updateFields).length > 0) {
      await supabase.from('users').update(updateFields).eq('id', u.id);
      migratedUsers++;
      console.log(`[MIGRATION] ✅ Đã phục hồi avatar người dùng [${u.display_name}]`);
    }
  }

  // 3. Quét Banner (banners)
  const { data: banners } = await supabase.from('banners').select('id, image_url');
  const oldBanners = (banners || []).filter(b => b.image_url && b.image_url.includes(OLD_SUPABASE_HOST));
  for (const b of oldBanners) {
    const newB = await migrateImageToNewSupabase(b.image_url);
    if (newB) {
      await supabase.from('banners').update({ image_url: newB }).eq('id', b.id);
      migratedBanners++;
    }
  }

  // 4. Quét Nữ tướng (heroes)
  const { data: heroes } = await supabase.from('heroes').select('id, name, avatar_url, card_image_url');
  const oldHeroes = (heroes || []).filter(h => 
    (h.avatar_url && h.avatar_url.includes(OLD_SUPABASE_HOST)) || 
    (h.card_image_url && h.card_image_url.includes(OLD_SUPABASE_HOST))
  );
  for (const h of oldHeroes) {
    let updateH = {};
    if (h.avatar_url && h.avatar_url.includes(OLD_SUPABASE_HOST)) {
      const newAv = await migrateImageToNewSupabase(h.avatar_url);
      if (newAv) updateH.avatar_url = newAv;
    }
    if (h.card_image_url && h.card_image_url.includes(OLD_SUPABASE_HOST)) {
      const newCard = await migrateImageToNewSupabase(h.card_image_url);
      if (newCard) updateH.card_image_url = newCard;
    }
    if (Object.keys(updateH).length > 0) {
      await supabase.from('heroes').update(updateH).eq('id', h.id);
      migratedHeroes++;
    }
  }

  const summary = {
    success: true,
    unlocked: true,
    migratedStories,
    migratedUsers,
    migratedBanners,
    migratedHeroes,
    errors
  };

  console.log('[MIGRATION] 🏁 Hoàn tất phục hồi ảnh từ Supabase cũ về Supabase mới:', summary);
  return summary;
}

module.exports = {
  checkOldSupabaseAvailability,
  runAutoMigration,
  migrateImageToNewSupabase
};
