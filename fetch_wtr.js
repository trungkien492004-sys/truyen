const puppeteer = require('puppeteer');
const fs = require('fs');

async function run() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.goto('https://wtr-lab.com/en/novel/56585/death-rewind-48-hours-to-save-the-world/chapter-384?service=web', { waitUntil: 'networkidle2' });
  
  const content = await page.evaluate(() => {
    const container = document.querySelector('.reader-container');
    return container ? container.innerText : null;
  });
  
  fs.writeFileSync('wtr_content.txt', content || 'Not found', 'utf8');
  console.log("Saved content to wtr_content.txt, length:", content ? content.length : 0);
  
  await browser.close();
}

run().catch(console.error);
