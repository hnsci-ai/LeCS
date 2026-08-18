// test/fade-test.js — 尸体淡出验证：击杀后 6.5 秒布娃娃应消失
'use strict';
process.env.PORT = '8068';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  // 控制台建房加 Bot
  const ctl = new WebSocket('ws://127.0.0.1:8068');
  let code = '', botId = 0;
  let resolveBot = null;
  const botReady = new Promise(res => { resolveBot = res; });
  ctl.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') code = m.code;
    if (m.t === 'roster') { const b = m.players.find(p => p.bot); if (b && !botId) { botId = b.id; resolveBot(); } }
  });
  await new Promise(res => ctl.on('open', () => { ctl.send(JSON.stringify({ t: 'join', name: '房主', team: 't', mode: 'classic' })); res(); }));
  await sleep(700);
  ctl.send(JSON.stringify({ t: 'addbot', diff: 'normal' }));
  await botReady;
  console.log('  房间:', code, 'Bot:', botId);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8068', { waitUntil: 'networkidle' });
  await page.fill('#nick', '淡出观察');
  await page.fill('#code', code);
  await page.click('#btn-join');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1000);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));
  await page.waitForFunction(() => window.__lecsLastSnap && window.__lecsLastSnap.phase === 'live', null, { timeout: 30000 });
  await sleep(500);

  // 击杀 bot → 布娃娃
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'dmg', id: botId, amount: 1000 }));
  await sleep(1500);
  const c1 = await page.evaluate(() => Ragdoll._debugCount());
  console.log('  击杀后布娃娃数:', c1);
  check(c1 === 1, '布娃娃已生成');

  // 等待约 4.5 秒淡出
  for (let i = 0; i < 9; i++) {
    await sleep(500);
    const n = await page.evaluate(() => Ragdoll._debugCount());
    if (i % 2 === 0) console.log('  t=' + ((i + 1) * 0.5 + 1.5).toFixed(1) + 's 布娃娃数:', n);
  }
  const c2 = await page.evaluate(() => Ragdoll._debugCount());
  check(c2 === 0, '约 4 秒后尸体下沉淡出移除 ✓');
  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));

  ctl.close();
  await browser.close();
  console.log(failures === 0 ? '\n=== 尸体淡出测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
