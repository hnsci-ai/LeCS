process.env.PORT = '8062';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => console.log('[PAGEERROR]', String(e).slice(0, 200), '||', (e.stack || '').split('\n').slice(1, 4).join(' | ')));
  page.on('console', m => { if (m.text().includes('[M3]') || m.text().includes('[DBG]')) console.log(m.text().slice(0, 400)); });
  await page.goto('http://127.0.0.1:8062', { waitUntil: 'networkidle' });
  await page.evaluate(() => {  }); // 禁用墙根阴影测试
  await page.evaluate(() => {
    window.addEventListener('error', e => {
      console.log('[INPAGE-ERR]', e.message, '||', (e.error && e.error.stack || '').split('\n').slice(1, 6).join(' | '));
    });
  });
  await page.fill('#nick', 'dbg');
  await page.fill('#botcount', '2');
  await page.click('#btn-practice');
  await sleep(15000);
  console.log('done');
  await browser.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
