const cheerio = require('cheerio');
const supabase = require('../config/supabase');

/**
 * Fetch helper with timeout and User-Agent to avoid blocking
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        ...(options.headers || {})
      }
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

/**
 * Crawl new chapters for a single story by ID
 */
async function crawlNewChapters(storyId) {
  console.log(`[CRAWLER] 🔄 Checking updates for story ID: ${storyId}`);
  
  // 1. Fetch story information from DB
  const { data: story, error: storyErr } = await supabase
    .from('stories')
    .select('*')
    .eq('id', storyId)
    .single();

  if (storyErr || !story) {
    throw new Error(`Story ID ${storyId} not found in database.`);
  }

  const sourceUrl = story.source_url;
  if (!sourceUrl) {
    console.log(`[CRAWLER] ℹ️ Story "${story.title}" has no source URL. Skipping.`);
    return { success: true, message: 'No source URL configured.', newChaptersCount: 0 };
  }

  // 2. Determine source domain
  let domain = '';
  try {
    const parsed = new URL(sourceUrl);
    domain = parsed.hostname.toLowerCase();
  } catch (err) {
    throw new Error(`Invalid source URL: ${sourceUrl}`);
  }

  // 3. Get maximum chapter number in DB
  const { data: summary } = await supabase
    .from('story_chapters_summary')
    .select('last_chapter_number')
    .eq('story_id', storyId)
    .maybeSingle();

  const maxDbChapter = summary && summary.last_chapter_number ? Math.floor(summary.last_chapter_number) : 0;
  console.log(`[CRAWLER] Current max chapter in DB: ${maxDbChapter}`);

  let newChaptersCount = 0;

  // 4. Crawl based on domain
  if (domain.includes('donghentai')) {
    // === COMIC CRAWLER: donghentai.xyz ===
    // Source URL format: https://donghentai.xyz/manga/nghich-chuyen
    console.log(`[CRAWLER] Detected DongHentai source: ${sourceUrl}`);
    
    // Fetch detail page to get all chapter links
    const detailRes = await fetchWithTimeout(sourceUrl);
    if (!detailRes.ok) throw new Error(`Failed to fetch DongHentai detail page. Status: ${detailRes.status}`);
    const detailHtml = await detailRes.text();
    const $ = cheerio.load(detailHtml);

    // Extract chapter links
    const sourceChapters = [];
    $('a').each((idx, el) => {
      const href = $(el).attr('href') || '';
      // Chapter link format: /manga/nghich-chuyen/chuong-33
      if (href.includes('/chuong-') || href.includes('/chapter-')) {
        const numMatch = href.match(/(?:chuong|chapter)-(\d+)/i);
        if (numMatch) {
          const chapNum = parseInt(numMatch[1]);
          if (chapNum > maxDbChapter) {
            sourceChapters.push({
              chapter_number: chapNum,
              url: `https://donghentai.xyz${href}`,
              title: $(el).text().replace(/Chương\s+\d+|Chapter\s+\d+/gi, '').replace(/\s+/g, ' ').trim() || `Chương ${chapNum}`
            });
          }
        }
      }
    });

    // Remove duplicates and sort ascending
    const uniqueChapters = [];
    const seen = new Set();
    for (const c of sourceChapters) {
      if (!seen.has(c.chapter_number)) {
        seen.add(c.chapter_number);
        uniqueChapters.push(c);
      }
    }
    uniqueChapters.sort((a, b) => a.chapter_number - b.chapter_number);

    console.log(`[CRAWLER] Found ${uniqueChapters.length} new chapters to crawl.`);

    // Crawl each chapter page (limit to 30 chapters to prevent timeout)
    const limitChapters = uniqueChapters.slice(0, 30);
    for (const c of limitChapters) {
      console.log(`[CRAWLER] Crawling DongHentai chapter ${c.chapter_number}: ${c.url}`);
      const chapRes = await fetchWithTimeout(c.url);
      if (!chapRes.ok) {
        console.error(`[CRAWLER] Failed to fetch chapter page: ${c.url}`);
        continue;
      }
      const chapHtml = await chapRes.text();
      const $c = cheerio.load(chapHtml);

      // Extract images
      const images = [];
      $c('img').each((idx, el) => {
        const src = $c(el).attr('src') || '';
        const alt = $c(el).attr('alt') || '';
        // Real page images alt starting with "Page"
        if (alt.toLowerCase().startsWith('page')) {
          images.push(src);
        }
      });

      if (images.length === 0) {
        console.warn(`[CRAWLER] No comic pages found for chapter ${c.chapter_number}. Skipping.`);
        continue;
      }

      // Build content HTML
      const contentHtml = images
        .map(img => `<div style="text-align: center; margin-bottom: 10px;"><img src="${img}" style="max-width: 100%; height: auto; border-radius: 4px;" loading="lazy"></div>`)
        .join('');

      // Insert chapter
      const { error: insErr } = await supabase
        .from('chapters')
        .insert([{
          story_id: storyId,
          chapter_number: c.chapter_number,
          title: `Chương ${c.chapter_number}${c.title ? ': ' + c.title : ''}`,
          content: contentHtml
        }]);

      if (insErr) {
        console.error(`[CRAWLER] Failed to insert chapter ${c.chapter_number}:`, insErr.message);
      } else {
        newChaptersCount++;
        console.log(`[CRAWLER] Successfully added chapter ${c.chapter_number}`);
      }
      // Delay to avoid rate limits
      await new Promise(r => setTimeout(r, 1000));
    }

  } else if (domain.includes('truyenmoiss')) {
    // === NOVEL CRAWLER: truyenmoiss.org ===
    console.log(`[CRAWLER] Detected TruyenMoiSS source: ${sourceUrl}`);
    const baseUrl = sourceUrl.replace(/\/+$/, '');
    
    let num = maxDbChapter + 1;
    let consecutiveErrors = 0;
    const maxChaptersPerRun = 50;

    while (newChaptersCount < maxChaptersPerRun && consecutiveErrors < 3) {
      const chapUrl = `${baseUrl}/chuong-${num}`;
      console.log(`[CRAWLER] Checking TruyenMoiSS chapter ${num}: ${chapUrl}`);
      
      try {
        const chapRes = await fetchWithTimeout(chapUrl);
        if (chapRes.status === 404) {
          console.log(`[CRAWLER] Chapter ${num} not found (404). Stopping crawl loop.`);
          break;
        }
        if (!chapRes.ok) {
          throw new Error(`HTTP ${chapRes.status}`);
        }

        const html = await chapRes.text();
        const $c = cheerio.load(html);

        // Parse Title
        const fullTitleText = $c('h2').text().trim() || $c('title').text().trim();
        const titleMatch = fullTitleText.match(/Chương\s+\d+\s*:\s*(.*)/i) || fullTitleText.match(/Chương\s+\d+\s*-\s*(.*)/i) || [null, fullTitleText];
        const subTitle = titleMatch[1] ? titleMatch[1].trim() : fullTitleText;
        const finalTitle = `Chương ${num}: ${subTitle}`;

        // Parse Content
        const contentContainer = $c('.chapter-content, #chapter-c, .content, #chapter-content').first();
        if (contentContainer.length === 0) {
          throw new Error('No content element found');
        }

        // Clean ads/scripts
        contentContainer.find('script, iframe, style, .ads, .social-share').remove();
        
        let contentHtml = '';
        const pTags = contentContainer.find('p');
        if (pTags.length > 0) {
          pTags.each((idx, el) => {
            let text = $c(el).text().trim();
            if (text && !text.includes('Có thể bạn cũng muốn đọc')) {
              contentHtml += `<p>${text}</p>`;
            }
          });
        } else {
          let rawText = contentContainer.html() || '';
          const paras = rawText.split(/<br\s*\/?>\s*<br\s*\/?>|<br\s*\/?>/i);
          paras.forEach(p => {
            const cleanP = cheerio.load(p).text().trim();
            if (cleanP && !cleanP.includes('Có thể bạn cũng muốn đọc')) {
              contentHtml += `<p>${cleanP}</p>`;
            }
          });
        }

        if (!contentHtml.trim()) {
          throw new Error('Parsed content is empty');
        }

        // Insert to DB
        const { error: insErr } = await supabase
          .from('chapters')
          .insert([{
            story_id: storyId,
            chapter_number: num,
            title: finalTitle,
            content: contentHtml
          }]);

        if (insErr) {
          throw insErr;
        }

        newChaptersCount++;
        consecutiveErrors = 0;
        console.log(`[CRAWLER] Successfully added chapter ${num}`);
        num++;
      } catch (err) {
        console.error(`[CRAWLER] Error crawling chapter ${num}:`, err.message);
        consecutiveErrors++;
        num++;
      }

      await new Promise(r => setTimeout(r, 1500));
    }

  } else if (domain.includes('truyenfull')) {
    // === NOVEL CRAWLER: truyenfull.io / truyenfull.vn ===
    console.log(`[CRAWLER] Detected TruyenFull source: ${sourceUrl}`);
    const baseUrl = sourceUrl.replace(/\/+$/, '');
    
    let num = maxDbChapter + 1;
    let consecutiveErrors = 0;
    const maxChaptersPerRun = 50;

    while (newChaptersCount < maxChaptersPerRun && consecutiveErrors < 3) {
      const chapUrl = `${baseUrl}/chuong-${num}/`;
      console.log(`[CRAWLER] Checking TruyenFull chapter ${num}: ${chapUrl}`);
      
      try {
        const chapRes = await fetchWithTimeout(chapUrl);
        if (chapRes.status === 404) {
          console.log(`[CRAWLER] Chapter ${num} not found (404). Stopping crawl loop.`);
          break;
        }
        if (!chapRes.ok) {
          throw new Error(`HTTP ${chapRes.status}`);
        }

        const html = await chapRes.text();
        const $c = cheerio.load(html);

        // Parse Title
        const fullTitleText = $c('.chapter-title').text().trim() || $c('title').text().trim();
        const titleMatch = fullTitleText.match(/Chương\s+\d+\s*:\s*(.*)/i) || fullTitleText.match(/Chương\s+\d+\s*-\s*(.*)/i) || [null, fullTitleText];
        const subTitle = titleMatch[1] ? titleMatch[1].trim() : fullTitleText;
        const finalTitle = `Chương ${num}: ${subTitle}`;

        // Parse Content
        const contentContainer = $c('.chapter-c').first();
        if (contentContainer.length === 0) {
          throw new Error('No .chapter-c element found');
        }

        // Clean ads/scripts
        contentContainer.find('script, style, iframe, .ads, .social-share').remove();
        
        let contentHtml = '';
        const pTags = contentContainer.find('p');
        if (pTags.length > 0) {
          pTags.each((idx, el) => {
            let text = $c(el).text().trim();
            if (text && !text.toLowerCase().includes('truyenfull') && !text.toLowerCase().includes('bạn đang đọc')) {
              contentHtml += `<p>${text}</p>`;
            }
          });
        } else {
          let rawText = contentContainer.html() || '';
          const paras = rawText.split(/<br\s*\/?>\s*<br\s*\/?>|<br\s*\/?>/i);
          paras.forEach(p => {
            const cleanP = cheerio.load(p).text().trim();
            if (cleanP && !cleanP.toLowerCase().includes('truyenfull') && !cleanP.toLowerCase().includes('bạn đang đọc')) {
              contentHtml += `<p>${cleanP}</p>`;
            }
          });
        }

        if (!contentHtml.trim()) {
          throw new Error('Parsed content is empty');
        }

        // Insert to DB
        const { error: insErr } = await supabase
          .from('chapters')
          .insert([{
            story_id: storyId,
            chapter_number: num,
            title: finalTitle,
            content: contentHtml
          }]);

        if (insErr) {
          throw insErr;
        }

        newChaptersCount++;
        consecutiveErrors = 0;
        console.log(`[CRAWLER] Successfully added chapter ${num}`);
        num++;
      } catch (err) {
        console.error(`[CRAWLER] Error crawling chapter ${num}:`, err.message);
        consecutiveErrors++;
        num++;
      }

      await new Promise(r => setTimeout(r, 1500));
    }

  } else if (domain.includes('tangthuvien')) {
    // === NOVEL CRAWLER: tangthuvien.vn ===
    console.log(`[CRAWLER] Detected TangThuVien source: ${sourceUrl}`);
    const baseUrl = sourceUrl.replace(/\/+$/, '');
    
    let num = maxDbChapter + 1;
    let consecutiveErrors = 0;
    const maxChaptersPerRun = 50;

    while (newChaptersCount < maxChaptersPerRun && consecutiveErrors < 3) {
      const chapUrl = `${baseUrl}/chuong-${num}`;
      console.log(`[CRAWLER] Checking TangThuVien chapter ${num}: ${chapUrl}`);
      
      try {
        const chapRes = await fetchWithTimeout(chapUrl);
        if (chapRes.status === 404) {
          console.log(`[CRAWLER] Chapter ${num} not found (404). Stopping crawl loop.`);
          break;
        }
        if (!chapRes.ok) {
          throw new Error(`HTTP ${chapRes.status}`);
        }

        const html = await chapRes.text();
        const $c = cheerio.load(html);

        // Parse Title
        const fullTitleText = $c('.chapter-title, h2, h3').first().text().trim() || $c('title').text().trim();
        const titleMatch = fullTitleText.match(/Chương\s+\d+\s*:\s*(.*)/i) || fullTitleText.match(/Chương\s+\d+\s*-\s*(.*)/i) || [null, fullTitleText];
        const subTitle = titleMatch[1] ? titleMatch[1].trim() : fullTitleText;
        const finalTitle = `Chương ${num}: ${subTitle}`;

        // Parse Content
        const contentContainer = $c('.box-chap, .chapter-content-read').first();
        if (contentContainer.length === 0) {
          throw new Error('No content element found');
        }

        // Clean ads/scripts
        contentContainer.find('script, style, iframe, .ads').remove();
        
        let contentHtml = '';
        const pTags = contentContainer.find('p');
        if (pTags.length > 0) {
          pTags.each((idx, el) => {
            let text = $c(el).text().trim();
            if (text && !text.toLowerCase().includes('tangthuvien')) {
              contentHtml += `<p>${text}</p>`;
            }
          });
        } else {
          let rawText = contentContainer.html() || '';
          const paras = rawText.split(/<br\s*\/?>\s*<br\s*\/?>|<br\s*\/?>/i);
          paras.forEach(p => {
            const cleanP = cheerio.load(p).text().trim();
            if (cleanP && !cleanP.toLowerCase().includes('tangthuvien')) {
              contentHtml += `<p>${cleanP}</p>`;
            }
          });
        }

        if (!contentHtml.trim()) {
          throw new Error('Parsed content is empty');
        }

        // Insert to DB
        const { error: insErr } = await supabase
          .from('chapters')
          .insert([{
            story_id: storyId,
            chapter_number: num,
            title: finalTitle,
            content: contentHtml
          }]);

        if (insErr) {
          throw insErr;
        }

        newChaptersCount++;
        consecutiveErrors = 0;
        console.log(`[CRAWLER] Successfully added chapter ${num}`);
        num++;
      } catch (err) {
        console.error(`[CRAWLER] Error crawling chapter ${num}:`, err.message);
        consecutiveErrors++;
        num++;
      }

      await new Promise(r => setTimeout(r, 1500));
    }
  } else {
    console.log(`[CRAWLER] ⚠️ Domain "${domain}" is not supported for auto-crawl.`);
    return { success: false, error: `Domain ${domain} is not supported.` };
  }

  // 5. Update last_update_at for the story if new chapters were crawled
  if (newChaptersCount > 0) {
    await supabase
      .from('stories')
      .update({ last_update_at: new Date().toISOString() })
      .eq('id', storyId);
  }

  return {
    success: true,
    newChaptersCount,
    message: `Finished crawl. Added ${newChaptersCount} new chapters.`
  };
}

/**
 * Automatically runs through all active stories in the database that have a non-null source_url
 */
async function syncAllActiveStories() {
  console.log(`[CRAWLER-CRON] 🌐 Scanning all stories with source URLs...`);
  const { data: stories, error } = await supabase
    .from('stories')
    .select('id, title, source_url')
    .not('source_url', 'is', null);

  if (error) {
    console.error('[CRAWLER-CRON] Failed to fetch stories:', error.message);
    return { success: false, error: error.message };
  }

  console.log(`[CRAWLER-CRON] Found ${stories.length} stories to check.`);
  let totalAdded = 0;

  for (const s of stories) {
    try {
      const res = await crawlNewChapters(s.id);
      if (res.success) {
        totalAdded += res.newChaptersCount || 0;
      }
    } catch (err) {
      console.error(`[CRAWLER-CRON] Error syncing story "${s.title}" (ID: ${s.id}):`, err.message);
    }
  }

  console.log(`[CRAWLER-CRON] 🏁 Sync completed. Total new chapters added across all stories: ${totalAdded}`);
  return { success: true, totalAdded };
}

module.exports = { crawlNewChapters, syncAllActiveStories };
