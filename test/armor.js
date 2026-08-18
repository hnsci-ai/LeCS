// test/armor.js — 护甲外观测试：买防弹衣/头盔后人物模型显示背心与头盔，尸体保留
'use strict';
process.env.PORT = '8085';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  const ctl = new WebSocket('ws://127.0.0.1:8085');
  let code = '', botId = 0;
  let resolveBot = null;
  const botReady = new Promise(res => { resolveBot = res; });
  ctl.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') code = m.code;
    if (m.t === 'roster') {
      const bot = m.players.find(p => p.bot);
      if (bot && !botId) { botId = bot.id; resolveBot(); }
    }
  });
  await new Promise(res => ctl.on('open', () => {
    ctl.send(JSON.stringify({ t: 'join', name: '护甲控制台', team: 't', mode: 'classic' }));
    res();
  }));
  await sleep(800);
  ctl.send(JSON.stringify({ t: 'addbot', diff: 'normal' }));
  await botReady;
  console.log('  房间:', code, '· Bot id:', botId);

  await page.goto('http://127.0.0.1:8085', { waitUntil: 'networkidle' });
  await page.fill('#nick', '护甲测试');
  await page.fill('#code', code);
  await page.click('#btn-join');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1500);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));
  await sleep(7000); // 等 live

  // 1. 无护甲：背心/头盔均隐藏
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'armor', id: botId, armor: 0, helmet: false }));
  await sleep(1200);
  const a0 = await page.evaluate(() => Render._debugArmor());
  console.log('  无护甲状态:', JSON.stringify(a0[botId]));
  check(a0[botId] && a0[botId].vest === false && a0[botId].helm === false, '无护甲时不显示背心与头盔');

  // 2. 穿上防弹衣+头盔：两者均显示
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'armor', id: botId, armor: 100, helmet: true }));
  await sleep(1200);
  const a1 = await page.evaluate(() => Render._debugArmor());
  console.log('  全套护甲状态:', JSON.stringify(a1[botId]));
  check(a1[botId] && a1[botId].vest === true && a1[botId].helm === true, '购买防弹衣+头盔后显示背心与头盔');

  // 3. 死亡：布娃娃保留背心与头盔（extras=2）
  // 注：致命一击会消耗护甲，这里把护甲调高以保证死亡后仍有剩余（护甲>0 尸体保留背心）
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'armor', id: botId, armor: 1000, helmet: true }));
  await sleep(500);
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'dmg', id: botId, amount: 1000 }));
  await sleep(900);
  const ex1 = await page.evaluate(() => Ragdoll._debugExtras());
  console.log('  尸体护甲部件数:', JSON.stringify(ex1));
  check(ex1.length === 1 && ex1[0] === 2, '带护甲死亡，尸体保留背心与头盔');

  // 4. 复活 → 脱掉护甲 → 再击杀：尸体无护甲部件
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'revive', id: botId }));
  await sleep(1200);
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'armor', id: botId, armor: 0, helmet: false }));
  await sleep(800);
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'dmg', id: botId, amount: 1000 }));
  await sleep(900);
  const ex2 = await page.evaluate(() => Ragdoll._debugExtras());
  console.log('  无甲尸体护甲部件数:', JSON.stringify(ex2));
  check(ex2.length === 1 && ex2[0] === 0, '无护甲死亡，尸体不带护甲部件');

  check(errors.length === 0, '全程无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));

  ctl.close();
  await browser.close();
  console.log(failures === 0 ? '\n=== 护甲外观测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
