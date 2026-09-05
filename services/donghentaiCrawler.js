const cheerio = require('cheerio');
const supabase = require('../config/supabase');

const domain = 'https://donghentai.xyz';
const apiBase = 'https://api.damconuong.cx/api/v1';

function cleanTitle(str) {
  if (!str) return '';
  return str.toLowerCase()
    .replace(/\[.*?\]|\(.*?\)/g, ' ')
    .replace(/\b(18\+|one\s*shot|oneshot|raw|uncensored|khong che|khong\s*che|full|end\s*ss\d+|ss\d+|phan\s*\d+|mua\s*\d+)\b/gi, ' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function findExistingStory(storyName, storySlug) {
  const sourceUrl = `https://donghentai.xyz/manga/${storySlug}`;
  
  // 1. By exact source_url
  const { data: byUrl } = await supabase
    .from('stories')
    .select('id, title, source_url, status')
    .eq('source_url', sourceUrl)
    .limit(1);

  if (byUrl && byUrl.length > 0) return byUrl[0];

  // 2. By source_url ending with slug
  const { data: bySlug } = await supabase
    .from('stories')
    .select('id, title, source_url, status')
    .ilike('source_url', `%/${storySlug}`)
    .limit(1);

  if (bySlug && bySlug.length > 0) return bySlug[0];

  // 3. By exact title
  const { data: byTitle } = await supabase
    .from('stories')
    .select('id, title, source_url, status')
    .ilike('title', storyName)
    .limit(1);

  if (byTitle && byTitle.length > 0) return byTitle[0];

  // 4. By cleaned normalized title
  const cleanedTarget = cleanTitle(storyName);
  if (cleanedTarget) {
    const { data: allStories } = await supabase
      .from('stories')
      .select('id, title, source_url, status')
      .limit(1000);

    if (allStories) {
      const match = allStories.find(s => cleanTitle(s.title) === cleanedTarget);
      if (match) return match;
    }
  }

  return null;
}

/**
 * Hàm kiểm tra và tự động cập nhật các chương mới nhất từ DongHentai.xyz
 * @param {number} maxPages - Số trang gần đây cần quét (Ví dụ: 3 trang = ~150 truyện mới cập nhật nhất)
 */
async function syncLatestDongHentai(maxPages = 3) {
  console.log(`[CRON-CRAWLER] 🔄 Bắt đầu quét các truyện vừa cập nhật trên DongHentai (Quét ${maxPages} trang gần nhất)...`);
  let updatedStoriesCount = 0;
  let newChaptersCount = 0;

  for (let page = 1; page <= maxPages; page++) {
    try {
      const recentRes = await fetch(`${apiBase}/mangas/recent?page=${page}&per_page=50`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      if (recentRes.status !== 200) continue;
      const recentJson = await recentRes.json();
      const stories = recentJson.data || [];

      for (const item of stories) {
        try {
          const storySlug = item.slug;
          const storyName = item.name;
          const coverUrl = item.cover_full_url || '';
          const description = item.trim_pilot || `Truyện ${storyName} cập nhật tự động`;

          // 1. Lấy danh sách chương từ API nguồn trước
          const chapRes = await fetch(`${apiBase}/mangas/${storySlug}/chapters?page=1&per_page=100`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          if (chapRes.status !== 200) continue;
          const chapJson = await chapRes.json();
          const sourceChapters = chapJson.data || [];
          
          // YÊU CẦU: Nếu truyện có 0 chương (chưa có chương nào) -> BỎ QUA KHÔNG CÀO & KHÔNG TẠO TRUYỆN VÀO DB
          if (sourceChapters.length === 0) {
            continue;
          }

          // 2. Kiểm tra danh sách đen (nếu Admin đã chủ động XÓA bộ truyện này -> BỎ QUA KHÔNG BAO GIỜ CÀO LẠI)
          try {
            const { data: blacklisted } = await supabase
              .from('blacklisted_stories')
              .select('id')
              .ilike('title', storyName)
              .maybeSingle();

            if (blacklisted) {
              console.log(`[CRON-CRAWLER] 🚫 Bỏ qua truyện "${storyName}" (Đã bị Admin xóa và đưa vào Blacklist).`);
              continue;
            }
          } catch(bErr) {}

          // 3. Kiểm tra/Tạo truyện trong DB nếu truyện có chứa chương
          const existingStory = await findExistingStory(storyName, storySlug);

          let storyId;
          const isOneShot = /oneshot|one-shot|one shot/i.test(storyName) || /oneshot|one-shot|one shot/i.test(description);
          const targetStatus = isOneShot ? 'completed' : 'ongoing';

          if (existingStory) {
            storyId = existingStory.id;
            // Đảm bảo cập nhật source_url nếu chưa có
            const updateFields = {};
            if (!existingStory.source_url) {
              updateFields.source_url = `https://donghentai.xyz/manga/${storySlug}`;
            }
            if (isOneShot && existingStory.status !== 'completed') {
              updateFields.status = 'completed';
            }
            if (Object.keys(updateFields).length > 0) {
              await supabase.from('stories').update(updateFields).eq('id', storyId);
            }
          } else {
            // Lấy tên tác giả từ API hoặc đặt là Ẩn danh
            const authorName = (item.artist && item.artist.name) ? item.artist.name : 'Ẩn danh';

            const { data: newStory, error: storyErr } = await supabase
              .from('stories')
              .insert([{
                title: storyName,
                author: authorName,
                description: description,
                cover_url: coverUrl,
                status: targetStatus,
                story_type: 'comic',
                source_url: `https://donghentai.xyz/manga/${storySlug}`
              }])
              .select('id')
              .single();

            if (storyErr) continue;
            storyId = newStory.id;
            console.log(`[CRON-CRAWLER] ➕ Đã thêm bộ truyện mới: "${storyName}" (ID: ${storyId})`);
          }

          // 3. Lấy danh sách số chương hiện có trong DB của mình
          const { data: dbChaps } = await supabase
            .from('chapters')
            .select('chapter_number')
            .eq('story_id', storyId);

          const existingChapNums = new Set((dbChaps || []).map(c => c.chapter_number));

          // 4. Lọc các chương chưa có trong DB
          for (const sChap of sourceChapters) {
            const chapNum = Math.floor(parseFloat(sChap.chapter_number || sChap.order || 1));
            if (existingChapNums.has(chapNum)) continue; // Đã có trong DB -> Bỏ qua

            // Lấy ảnh của chương mới này
            const imgRes = await fetch(`${apiBase}/mangas/${storySlug}/chapters/${sChap.slug}/images`, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
              }
            });
            if (imgRes.status !== 200) continue;
            const imgJson = await imgRes.json();
            const images = imgJson.data?.images || [];
            if (images.length === 0) continue;

            const contentHtml = images
              .map(img => `<div style="text-align: center; margin-bottom: 10px;"><img src="${img}" style="max-width: 100%; height: auto; border-radius: 4px;" loading="lazy"></div>`)
              .join('');

            // Upsert vào DB
            const { error: insertErr } = await supabase
              .from('chapters')
              .upsert([{
                story_id: storyId,
                chapter_number: chapNum,
                title: sChap.name || `Chương ${chapNum}`,
                content: contentHtml
              }], { onConflict: 'story_id,chapter_number' });

            if (!insertErr) {
              newChaptersCount++;
              existingChapNums.add(chapNum);
              console.log(`[CRON-CRAWLER]   ➔ Đã cập nhật chương mới: ${storyName} - ${sChap.name} (${images.length} ảnh)`);
            }
          }

          updatedStoriesCount++;
        } catch (sErr) {
          console.error(`[CRON-CRAWLER] Lỗi xử lý truyện ${item.name}:`, sErr.message);
        }
      }

    } catch (pErr) {
      console.error(`[CRON-CRAWLER] Lỗi quét trang ${page}:`, pErr.message);
    }
  }

  console.log(`[CRON-CRAWLER] 🎉 Hoàn tất kiểm tra! Thêm mới/Cập nhật ${newChaptersCount} chương từ ${updatedStoriesCount} bộ truyện.`);
  return { updatedStoriesCount, newChaptersCount };
}

/**
 * Hàm cào 1 truyện cụ thể theo Slug từ DongHentai
 */
async function crawlSingleDongHentaiManga(storySlug) {
  try {
    const mangaRes = await fetch(`${apiBase}/mangas/${storySlug}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (mangaRes.status !== 200) return;
    const mangaJson = await mangaRes.json();
    const item = mangaJson.data;
    if (!item) return;

    const storyName = item.name;
    const coverUrl = item.cover_full_url || '';
    const description = item.trim_pilot || `Truyện ${storyName}`;

    // Lặp phân trang lấy TOÀN BỘ danh sách chương của truyện từ API nguồn (tránh giới hạn 100 chap/trang)
    let sourceChapters = [];
    let pageNum = 1;
    let hasMoreChaps = true;
    while (hasMoreChaps) {
      const chapRes = await fetch(`${apiBase}/mangas/${storySlug}/chapters?page=${pageNum}&per_page=100`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      if (chapRes.status !== 200) {
        hasMoreChaps = false;
        break;
      }
      const chapJson = await chapRes.json();
      const pageChapters = chapJson.data || [];
      if (pageChapters.length === 0) {
        hasMoreChaps = false;
        break;
      }
      sourceChapters = sourceChapters.concat(pageChapters);
      if (pageChapters.length < 100) {
        hasMoreChaps = false;
      } else {
        pageNum++;
      }
    }

    if (sourceChapters.length === 0) return { success: false, error: 'Truyện chưa có chương nào phía nguồn.' };

    // Kiểm tra DB
    const existingStory = await findExistingStory(storyName, storySlug);

    let storyId;
    const isOneShot = /oneshot|one-shot|one shot/i.test(storyName) || /oneshot|one-shot|one shot/i.test(description);
    const targetStatus = isOneShot ? 'completed' : 'ongoing';

    if (existingStory) {
      storyId = existingStory.id;
      const updateFields = {};
      if (!existingStory.source_url) {
        updateFields.source_url = `https://donghentai.xyz/manga/${storySlug}`;
      }
      if (isOneShot && existingStory.status !== 'completed') {
        updateFields.status = 'completed';
      }
      if (Object.keys(updateFields).length > 0) {
        await supabase.from('stories').update(updateFields).eq('id', storyId);
      }
    } else {
      // Lấy tên tác giả từ API hoặc đặt là Ẩn danh
      const authorName = (item.artist && item.artist.name) ? item.artist.name : 'Ẩn danh';

      const { data: newStory, error: storyErr } = await supabase
        .from('stories')
        .insert([{
          title: storyName,
          author: authorName,
          description: description,
          cover_url: coverUrl,
          status: targetStatus,
          story_type: 'comic',
          source_url: `https://donghentai.xyz/manga/${storySlug}`
        }])
        .select('id')
        .single();
      if (storyErr) return { success: false, error: storyErr.message };
      storyId = newStory.id;
      console.log(`➕ Thêm bộ truyện mới: "${storyName}" (ID: ${storyId})`);
    }

    const { data: dbChaps } = await supabase.from('chapters').select('chapter_number').eq('story_id', storyId);
    const existingChapNums = new Set((dbChaps || []).map(c => c.chapter_number));

    for (const sChap of sourceChapters) {
      const chapNum = Math.floor(parseFloat(sChap.chapter_number || sChap.order || 1));
      if (existingChapNums.has(chapNum)) continue;

      const imgRes = await fetch(`${apiBase}/mangas/${storySlug}/chapters/${sChap.slug}/images`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      if (imgRes.status !== 200) continue;
      const imgJson = await imgRes.json();
      const images = imgJson.data?.images || [];
      if (images.length === 0) continue;

      const contentHtml = images
        .map(img => `<div style="text-align: center; margin-bottom: 10px;"><img src="${img}" style="max-width: 100%; height: auto; border-radius: 4px;" loading="lazy"></div>`)
        .join('');

      await supabase.from('chapters').upsert([{
        story_id: storyId,
        chapter_number: chapNum,
        title: sChap.name || `Chương ${chapNum}`,
        content: contentHtml
      }], { onConflict: 'story_id,chapter_number' });

      console.log(`   ➔ Đã thêm: ${storyName} - ${sChap.name} (${images.length} ảnh)`);
    }
    return { success: true, title: storyName };
  } catch (e) {
    console.error(`Lỗi cào ${storySlug}:`, e.message);
    return { success: false, error: e.message };
  }
}

module.exports = { syncLatestDongHentai, crawlSingleDongHentaiManga };
