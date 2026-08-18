// test/ragdoll-fade.js — 尸体机制（全模式统一）：永久保留、可堆叠、带护甲外观
'use strict';
process.env.PORT = '8082';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  const ctl = new WebSocket('ws://127.0.0.1:8082');
  let code = '', botId = 0;
  let rb; const botReady = new Promise(r => { rb = r; });
  ctl.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') code = m.code;
    if (m.t === 'roster') { const bot = m.players.find(p => p.bot); if (bot && !botId) { botId = bot.id; rb(); } }
  });
  await new Promise(res => ctl.on('open', () => { ctl.send(JSON.stringify({ t: 'join', name: 'ctl', team: 't', mode: 'classic' })); res(); }));
  await sleep(500);
  ctl.send(JSON.stringify({ t: 'addbot', diff: 'normal' }));
  await botReady;

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8082', { waitUntil: 'networkidle' });
  await page.fill('#nick', '观尸');
  await page.fill('#code', code);
  await page.click('#btn-join');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));
  await page.waitForFunction(() => window.__lecsLastSnap && window.__lecsLastSnap.phase === 'live', null, { timeout: 30000 });
  await sleep(1000);

  console.log('== 1. 经典模式尸体永久保留 ==');
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'armor', id: botId, armor: 1000, helmet: true })); // 致命一击会消耗护甲，调高保证死后仍有剩余
  await sleep(300);
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'dmg', id: botId, amount: 1000 }));
  await sleep(1200);
  const n1 = await page.evaluate(() => Ragdoll._debugCount());
  check(n1 === 1, '击杀生成布娃娃尸体');
  await sleep(5000); // 5 秒后仍应保留
  const n1b = await page.evaluate(() => Ragdoll._debugCount());
  const extras = await page.evaluate(() => Ragdoll._debugExtras());
  console.log('  5 秒后尸体数:', n1b, '· 护甲部件:', JSON.stringify(extras));
  check(n1b === 1, '5 秒后尸体仍保留（永久，全模式统一）');
  check(extras.length === 1 && extras[0] === 2, '带护甲尸体保留背心与头盔');

  console.log('== 2. 复活再杀 → 尸体堆叠 ==');
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'revive', id: botId }));
  await sleep(1500);
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'dmg', id: botId, amount: 1000 }));
  await sleep(1200);
  const n2 = await page.evaluate(() => Ragdoll._debugCount());
  console.log('  堆叠后尸体数:', n2);
  check(n2 === 2, '同一目标再次死亡堆叠第二具尸体');

  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));

  ctl.close();
  await browser.close();
  console.log(failures === 0 ? '\n=== 尸体机制测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
