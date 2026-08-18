// test/fade-real.js — 真实混战下尸体淡出（4 Bot 互打 60 秒）
'use strict';
process.env.PORT = '8067';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  const ctl = new WebSocket('ws://127.0.0.1:8067');
  let code = '';
  const ready = new Promise(res => ctl.on('open', () => { ctl.send(JSON.stringify({ t: 'join', name: '房主', team: 't', mode: 'classic' })); res(); }));
  ctl.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.t === 'joined') code = m.code; });
  await ready;
  await sleep(700);
  for (let i = 0; i < 4; i++) ctl.send(JSON.stringify({ t: 'addbot', diff: ['easy', 'normal', 'hard', 'normal'][i] }));
  await sleep(1000);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8067', { waitUntil: 'networkidle' });
  await page.fill('#nick', '观尸员');
  await page.fill('#code', code);
  await page.click('#btn-join');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1000);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));
  await page.waitForFunction(() => window.__lecsLastSnap && window.__lecsLastSnap.phase === 'live', null, { timeout: 30000 });

  // 观察 60 秒：尸体数应在 0~8 之间波动（有死亡也有淡出）
  let maxCount = 0, minCount = 99, seenCorpse = false;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    const n = await page.evaluate(() => Ragdoll._debugCount());
    if (n > 0) seenCorpse = true;
    maxCount = Math.max(maxCount, n);
    minCount = Math.min(minCount, n);
    if (i % 10 === 0) console.log('  t=' + ((i + 1) * 0.5).toFixed(0) + 's 尸体数:', n);
  }
  const finalCount = await page.evaluate(() => Ragdoll._debugCount());
  console.log(`  统计: 出现过尸体=${seenCorpse} 峰值=${maxCount} 谷值=${minCount} 当前=${finalCount}`);
  check(seenCorpse, '混战中产生了尸体');
  check(maxCount <= 8, '尸体数不超过上限 8');
  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));

  ctl.close();
  await browser.close();
  console.log(failures === 0 ? '\n=== 真实混战尸体测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
