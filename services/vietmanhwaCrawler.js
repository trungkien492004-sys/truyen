const https = require('https');
const cheerio = require('cheerio');
const supabase = require('../config/supabase');

/**
 * Normalizes title string for duplicate matching
 */
function normalizeTitle(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, '') // remove special characters
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch Helper
 */
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

/**
 * Parse VietManhwa React Router stream response
 */
function parseVietmanhwaStream(html) {
  const reg = /enqueue\("([\s\S]*?)"\);/g;
  let match;
  let fullStream = '';
  while ((match = reg.exec(html)) !== null) {
    try {
      const unescaped = JSON.parse('"' + match[1] + '"');
      fullStream += unescaped;
    } catch (e) {
      fullStream += match[1];
    }
  }
  return fullStream;
}

/**
 * Extract detail information for a manga from vietmanhwa
 * URL e.g. https://vietmanhwa.com/manhwa-18/ky-nghi-uot-ac-khong-che
 */
async function fetchVietManhwaStoryDetail(storyUrl) {
  // Fix sitemap URLs ending with '-2' redirect issue
  const cleanUrl = storyUrl.replace(/-2$/, '');
  console.log(`[VIETMANHWA] Fetching story details: ${cleanUrl} (Original: ${storyUrl})`);
  const html = await fetchUrl(cleanUrl);
  const stream = parseVietmanhwaStream(html);

  // Extract title, description, cover from stream or HTML meta
  const $ = cheerio.load(html);
  let title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || $('title').text() || '';
  title = title.replace(/\s*-\s*VietManhwa.*$/i, '').trim();

  if (!title || title.includes('Không tìm thấy trang') || title.includes('404')) {
    console.log(`[VIETMANHWA] ⚠️ 404 page detected for ${storyUrl}. Skipping.`);
    return {
      title: '',
      normalizedTitle: '',
      author: '',
      description: '',
      coverUrl: '',
      sourceUrl: storyUrl,
      chapters: []
    };
  }

  let description = $('meta[property="og:description"]').attr('content') || '';
  
  // Find cover image from stream or meta
  const cdnImages = stream.match(/https:\/\/cdn\.vietmanhwa\.com\/[^\s"<>'\\]+/g) || [];
  let coverUrl = cdnImages.find(img => img.includes('manga-posters/') || img.includes('poster-') || img.includes('story-images/')) 
    || $('meta[property="og:image"]').attr('content') 
    || '/css/default-cover.jpg';

  // Extract author if available in stream
  let author = 'VietManhwa';
  const authorMatch = stream.match(/"author",\s*"([^"]+)"/i) || stream.match(/"authorName",\s*"([^"]+)"/i);
  if (authorMatch) author = authorMatch[1];

  // Extract all chapter slugs/paths from stream
  // Pattern in stream: "chuong-15", "chuong-14", ... or "chap-1"
  const chapMatches = stream.match(/chuong-\d+|chap-\d+/gi);
  const chapters = [];
  if (chapMatches) {
    const uniqueChaps = Array.from(new Set(chapMatches));
    uniqueChaps.forEach(ch => {
      const numMatch = ch.match(/\d+/);
      if (numMatch) {
        chapters.push({
          slug: ch,
          number: parseFloat(numMatch[0]),
          url: `${storyUrl.replace(/\/+$/, '')}/${ch}`
        });
      }
    });
  }

  // Sort chapters ascending (Chap 1 -> Chap N)
  chapters.sort((a, b) => a.number - b.number);

  return {
    title,
    normalizedTitle: normalizeTitle(title),
    author,
    description,
    coverUrl,
    sourceUrl: storyUrl,
    chapters
  };
}

/**
 * Fetch chapter content (list of images) for a specific chapter URL
 */
async function fetchVietManhwaChapterContent(chapterUrl) {
  console.log(`[VIETMANHWA] Fetching chapter content: ${chapterUrl}`);
  const html = await fetchUrl(chapterUrl);
  const stream = parseVietmanhwaStream(html);

  // Extract CDN images
  const cdnMatches = stream.match(/https:\/\/cdn\.vietmanhwa\.com\/[^\s"<>'\\]+/g);
  if (!cdnMatches) {
    throw new Error('No CDN images found in chapter stream');
  }

  // Filter only manga image files
  const images = Array.from(new Set(cdnMatches)).filter(img => 
    img.includes('/manga-images/') || img.includes('/test/images-story/') || img.endsWith('.jpg') || img.endsWith('.webp') || img.endsWith('.png')
  );

  if (images.length === 0) {
    throw new Error('Filtered image list is empty');
  }

  // Sort images if needed (usually 001, 002, 003...)
  images.sort((a, b) => a.localeCompare(b));

  // Build HTML content for DB
  const contentHtml = images
    .map(img => `<div style="text-align: center; margin-bottom: 10px;"><img src="${img}" style="max-width: 100%; height: auto; border-radius: 4px;" loading="lazy"></div>`)
    .join('');

  return {
    imagesCount: images.length,
    contentHtml
  };
}

/**
 * Deduplicate and upsert a VietManhwa story into DB
 */
async function syncVietManhwaStory(storyUrl, options = {}) {
  const { maxChapters = 50 } = options;
  const detail = await fetchVietManhwaStoryDetail(storyUrl);

  if (!detail.title) {
    throw new Error(`Could not parse title from ${storyUrl}`);
  }

  // 1. Check duplicate by source_url
  let { data: existingStory } = await supabase
    .from('stories')
    .select('id, title, source_url')
    .eq('source_url', storyUrl)
    .maybeSingle();

  // 2. If not found by source_url, check duplicate by title / normalized title
  if (!existingStory) {
    const { data: allStories } = await supabase
      .from('stories')
      .select('id, title, source_url');

    if (allStories) {
      const match = allStories.find(s => normalizeTitle(s.title) === detail.normalizedTitle);
      if (match) {
        existingStory = match;
        console.log(`[VIETMANHWA] 🎯 Matched duplicate story by Title: "${detail.title}" -> DB ID: ${existingStory.id}`);
        // Update source_url if empty
        if (!existingStory.source_url) {
          await supabase.from('stories').update({ source_url: storyUrl }).eq('id', existingStory.id);
        }
      }
    }
  }

  let storyId;
  const isOneShot = /oneshot|one-shot|one shot/i.test(detail.title) || /oneshot|one-shot|one shot/i.test(detail.description);
  const targetStatus = isOneShot ? 'completed' : 'ongoing';

  if (existingStory) {
    storyId = existingStory.id;
    console.log(`[VIETMANHWA] Using existing story ID: ${storyId} ("${existingStory.title}")`);
    if (isOneShot) {
      await supabase.from('stories').update({ status: 'completed' }).eq('id', storyId);
    }
  } else {
    // Insert new story
    const { data: newStory, error: insErr } = await supabase
      .from('stories')
      .insert([{
        title: detail.title,
        author: detail.author,
        description: detail.description,
        cover_url: detail.coverUrl || '/css/default-cover.jpg',
        status: targetStatus,
        story_type: 'comic',
        source_url: storyUrl
      }])
      .select('*')
      .single();

    if (insErr) {
      throw new Error(`Failed to insert story: ${insErr.message}`);
    }

    storyId = newStory.id;
    console.log(`[VIETMANHWA] ➕ Created new story ID: ${storyId} ("${detail.title}")`);

    // Add comic genre (ID: 9) and Adult/Hentai genre if applicable
    await supabase.from('story_genres').insert([
      { story_id: storyId, genre_id: 9 }
    ]);
  }

  // 3. Fetch existing chapter numbers in DB
  const { data: existingChapters } = await supabase
    .from('chapters')
    .select('chapter_number')
    .eq('story_id', storyId);

  const existingNumSet = new Set(existingChapters ? existingChapters.map(c => c.chapter_number) : []);

  // Filter missing chapters
  const missingChaps = detail.chapters.filter(ch => !existingNumSet.has(ch.number));
  console.log(`[VIETMANHWA] Found ${detail.chapters.length} total chapters, ${missingChaps.length} missing in DB.`);

  let addedCount = 0;
  const toProcess = missingChaps.slice(0, maxChapters);

  for (const ch of toProcess) {
    try {
      const contentData = await fetchVietManhwaChapterContent(ch.url);
      const title = `Chương ${ch.number}`;

      const { error: chErr } = await supabase
        .from('chapters')
        .insert([{
          story_id: storyId,
          chapter_number: ch.number,
          title,
          content: contentData.contentHtml
        }]);

      if (chErr) {
        console.error(`[VIETMANHWA] Error saving chapter ${ch.number}:`, chErr.message);
      } else {
        addedCount++;
        console.log(`[VIETMANHWA] ✅ Added Chapter ${ch.number} (${contentData.imagesCount} images)`);
      }
    } catch (err) {
      console.error(`[VIETMANHWA] Error crawling chapter ${ch.number} (${ch.url}):`, err.message);
    }
    // Respectful delay
    await new Promise(r => setTimeout(r, 1200));
  }

  return {
    storyId,
    title: detail.title,
    totalChapters: detail.chapters.length,
    addedCount
  };
}

module.exports = {
  fetchVietManhwaStoryDetail,
  fetchVietManhwaChapterContent,
  syncVietManhwaStory,
  normalizeTitle
};
