// test/fade-multi.js — 多具尸体同时存在的淡出（3 杀后逐秒观察）
'use strict';
process.env.PORT = '8066';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  const ctl = new WebSocket('ws://127.0.0.1:8066');
  let code = '', bots = [];
  let resolveBots = null;
  const botsReady = new Promise(res => { resolveBots = res; });
  ctl.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') code = m.code;
    if (m.t === 'roster') {
      const bs = m.players.filter(p => p.bot).map(p => p.id);
      if (bs.length >= 3 && !bots.length) { bots = bs; resolveBots(); }
    }
  });
  await new Promise(res => ctl.on('open', () => { ctl.send(JSON.stringify({ t: 'join', name: '房主', team: 't', mode: 'classic' })); res(); }));
  await sleep(700);
  for (let i = 0; i < 3; i++) ctl.send(JSON.stringify({ t: 'addbot', diff: 'normal' }));
  await botsReady;
  console.log('  Bots:', bots);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8066', { waitUntil: 'networkidle' });
  await page.fill('#nick', '验尸官');
  await page.fill('#code', code);
  await page.click('#btn-join');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1000);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));
  await page.waitForFunction(() => window.__lecsLastSnap && window.__lecsLastSnap.phase === 'live', null, { timeout: 30000 });
  await sleep(500);

  // 同时击杀 2 个 bot（同队房主不会触发回合结束；房主 T，bots 2T1CT 或 1T2CT）
  // 只杀 CT 队 bot，避免误杀导致回合结束
  for (const b of bots) {
    ctl.send(JSON.stringify({ t: 'dev', cmd: 'dmg', id: b, amount: 1000 }));
    await sleep(200);
  }
  await sleep(1500);
  const c1 = await page.evaluate(() => Ragdoll._debugCount());
  console.log('  击杀后尸体数:', c1);
  check(c1 >= 1, '产生了尸体');

  // 逐秒观察 8 秒
  let lastN = c1;
  for (let i = 1; i <= 8; i++) {
    await sleep(1000);
    const n = await page.evaluate(() => Ragdoll._debugCount());
    console.log('  t+' + i + 's 尸体数:', n, n < lastN ? '↓' : '');
    lastN = n;
  }
  const c2 = await page.evaluate(() => Ragdoll._debugCount());
  check(c2 === 0, '全部尸体随时间淡出（当前 ' + c2 + '）✓');
  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 200) : ''));

  ctl.close();
  await browser.close();
  console.log(failures === 0 ? '\n=== 多尸体淡出测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
