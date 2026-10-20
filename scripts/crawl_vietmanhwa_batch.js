const cheerio = require('cheerio');
const { syncVietManhwaStory } = require('../services/vietmanhwaCrawler');
const { resetStoryTypesCache } = require('../services/storyClassifier');

async function main() {
  console.log('--- STARTING VIETMANHWA COMIC CRAWLER BATCH ---');

  const storyUrls = new Set();
  const pagesToScan = [1, 2, 3];

  for (const page of pagesToScan) {
    const pageUrl = page === 1 ? 'https://vietmanhwa.com' : `https://vietmanhwa.com?page=${page}`;
    try {
      console.log(`Scanning page: ${pageUrl}`);
      const res = await fetch(pageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const html = await res.text();
      const $ = cheerio.load(html);

      $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && href.startsWith('/manhwa-18/')) {
          const parts = href.split('/').filter(Boolean);
          if (parts.length === 2) {
            storyUrls.add(`https://vietmanhwa.com/manhwa-18/${parts[1]}`);
          }
        }
      });
    } catch (e) {
      console.error(`Error scanning page ${page}:`, e.message);
    }
  }

  const list = Array.from(storyUrls);
  console.log(`Discovered ${list.length} target manhwa stories to sync.`);

  let totalNewChapters = 0;
  let totalStoriesUpdated = 0;

  for (let i = 0; i < list.length; i++) {
    const url = list[i];
    console.log(`\n[${i + 1}/${list.length}] Processing: ${url}`);
    try {
      // Crawl up to 15 chapters per story
      const res = await syncVietManhwaStory(url, { maxChapters: 15 });
      if (res && res.addedCount > 0) {
        totalNewChapters += res.addedCount;
        totalStoriesUpdated++;
        console.log(`🎉 SUCCESS: Added ${res.addedCount} chapters for "${res.title}" (Total: ${res.totalChapters})`);
      } else {
        console.log(`ℹ️ Up-to-date or no new chapters for "${res ? res.title : url}"`);
      }
    } catch (err) {
      console.error(`❌ Error syncing story ${url}:`, err.message);
    }

    // Delay between stories
    await new Promise(r => setTimeout(r, 800));
  }

  console.log(`\n==============================================`);
  console.log(`CRAWL COMPLETED!`);
  console.log(`Stories updated/added: ${totalStoriesUpdated}`);
  console.log(`Total new chapters inserted: ${totalNewChapters}`);
  console.log(`==============================================`);

  resetStoryTypesCache();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal crawler error:', err);
  process.exit(1);
});
