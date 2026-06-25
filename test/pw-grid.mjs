// Headless smoke test for /grid (monochrome count heatmap + computed badge filter).
import pw from 'file:///C:/Users/Admin/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright-core/index.js';
const { chromium } = pw;

const base = process.env.BASE || 'http://127.0.0.1:8803';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
page.on('console', m => { if (m.type() === 'error') console.log('PAGE ERR:', m.text()); });
page.on('pageerror', e => console.log('PAGE EXCEPTION:', e.message));

// ---- /grid ----------------------------------------------------------------
await page.goto(`${base}/grid`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('ov').style.display === 'none', null, { timeout: 120000 });
const cnt = await page.evaluate(() => document.querySelectorAll('#list .item').length);
console.log('grid: badge list items (expect 204):', cnt);
await page.screenshot({ path: 'test/pw-grid-count.png' });

// Pick the Palindrome badge -> should switch to its membership map.
await page.fill('#search', 'Palindrome');
await page.click('#list .item:has-text("Palindrome")');
await page.waitForFunction(() => document.getElementById('vtitle').textContent.includes('/ 1,000,000'), null, { timeout: 15000 });
const vtitle = await page.evaluate(() => document.getElementById('vtitle').textContent);
console.log('grid: badge view title:', vtitle);
await page.screenshot({ path: 'test/pw-grid-badge.png' });

// Click a cell -> navigates to /?n=<number under cursor>.
const box = await page.locator('#grid').boundingBox();
const cx = box.x + box.width * 0.6, cy = box.y + box.height * 0.5;
for (let i = 0; i < 14; i++) await page.mouse.wheel(0, -120);
await page.waitForTimeout(120);
const expected = await page.evaluate(({ cx, cy }) => {
  const r = document.getElementById('grid').getBoundingClientRect();
  return window.__numAt(cx - r.left, cy - r.top);
}, { cx, cy });
let navTo = null;
page.on('framenavigated', f => { if (f === page.mainFrame()) navTo = f.url(); });
await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(400);
console.log('grid: expected n', expected, '-> navigated', navTo, '-> match:', !!navTo && navTo.endsWith('/?n=' + expected));

await browser.close();
