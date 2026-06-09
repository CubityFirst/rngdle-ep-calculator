// Screenshot the beta renderer for a few numbers (classic + beta + a badge hover).
import pw from 'file:///C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.js';
const { chromium } = pw;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 760, height: 1100 } });

const n = process.argv[2] || '110011';
await page.goto(`http://127.0.0.1:8787/?n=${n}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(400);
await page.screenshot({ path: 'test/pw-beta-classic.png', fullPage: true });

// Turn on beta
await page.click('#beta-toggle');
await page.waitForTimeout(400);
await page.screenshot({ path: 'test/pw-beta-on.png', fullPage: true });

// Hover the bookends badge (highlights [0,1,4,5]) — find a badge whose label includes "Bookends"
const handle = await page.evaluateHandle(() => {
  return [...document.querySelectorAll('.bn-b')].find(b => /bookends/i.test(b.textContent)) || document.querySelector('.bn-b');
});
const el = handle.asElement();
if (el) { await el.hover(); await page.waitForTimeout(400); }
await page.screenshot({ path: 'test/pw-beta-hover.png', fullPage: true });

// Report which digits got highlighted
const hl = await page.$$eval('.bn-d.hl', els => els.map(e => e.dataset.i));
console.log('hovered badge highlighted digit indices:', hl.join(','));
await browser.close();
