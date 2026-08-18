// test/ragdoll-fade.js — 尸体必须快速消失：带护甲/无护甲都在 ~1.7 秒淡出，定时兜底 2.5 秒
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

async function round(ctl, page, botId, withArmor) {
  if (withArmor) ctl.send(JSON.stringify({ t: 'dev', cmd: 'armor', id: botId, armor: 100, helmet: true }));
  await sleep(300);
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'dmg', id: botId, amount: 1000 }));
  await sleep(1200);
  const alive = await page.evaluate(() => Ragdoll._debugCount());
  const okAlive = alive >= 1;
  await sleep(2500); // 距死亡 3.7 秒：淡出(1.7s)与定时兜底(2.5s)均应已完成
  const gone = await page.evaluate(() => Ragdoll._debugCount());
  return { okAlive, gone };
}

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

  console.log('== 1. 无护甲尸体淡出 ==');
  let r1 = await round(ctl, page, botId, false);
  check(r1.okAlive, '死亡后生成布娃娃');
  check(r1.gone === 0, '1.7 秒内淡出移除（3.7 秒时已无尸体）');
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'revive', id: botId }));
  await sleep(1200);

  console.log('== 2. 带护甲尸体淡出 ==');
  let r2 = await round(ctl, page, botId, true);
  check(r2.okAlive, '带护甲死亡生成布娃娃（含背心/头盔）');
  check(r2.gone === 0, '带护甲尸体同样按时淡出移除');
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'revive', id: botId }));
  await sleep(1200);

  console.log('== 3. 连续击杀快速清理 ==');
  let okAll = true;
  for (let i = 0; i < 3; i++) {
    ctl.send(JSON.stringify({ t: 'dev', cmd: 'dmg', id: botId, amount: 1000 }));
    await sleep(600);
    ctl.send(JSON.stringify({ t: 'dev', cmd: 'revive', id: botId }));
    await sleep(600);
  }
  await sleep(2800);
  const finalN = await page.evaluate(() => Ragdoll._debugCount());
  check(finalN === 0, '连续击杀后无尸体残留（当前 ' + finalN + '）');
  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));

  ctl.close();
  await browser.close();
  console.log(failures === 0 ? '\n=== 尸体消失测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
