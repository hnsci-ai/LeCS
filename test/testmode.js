// test/testmode.js — 测试靶场：Bot 完全静止、空旷小场地、Bot 尸体永久保留
'use strict';
process.env.PORT = '8076';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  const ctl = new WebSocket('ws://127.0.0.1:8076');
  let code = '', botId = 0, joinedMap = '';
  let rb; const botReady = new Promise(r => { rb = r; });
  ctl.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') { code = m.code; joinedMap = m.map || ''; }
    if (m.t === 'roster') { const bot = m.players.find(p => p.bot); if (bot && !botId) { botId = bot.id; rb(); } }
  });
  await new Promise(res => ctl.on('open', () => {
    ctl.send(JSON.stringify({ t: 'join', name: '靶场主', team: 't', mode: 'test', map: 'dust' })); // 故意选 dust，服务器须强制 test 图
    res();
  }));
  await sleep(500);
  ctl.send(JSON.stringify({ t: 'addbot', diff: 'easy' }));
  await botReady;
  console.log('  房间:', code, '· joined.map =', joinedMap);
  check(joinedMap === 'test', '测试模式强制空旷小图 test（无视所选地图）');

  const snapOnce = () => new Promise(res => {
    const onMsg = raw => {
      const m = JSON.parse(raw.toString());
      if (m.t === 'snap') { ctl.removeListener('message', onMsg); res(m); }
    };
    ctl.on('message', onMsg);
  });

  // 等 live，取 Bot 位置 → 3 秒后必须纹丝不动
  await sleep(1500);
  let m = await snapOnce();
  let pos1 = null;
  {
    const bot = m.players.find(p => p[0] === botId);
    pos1 = bot ? [bot[1], bot[3]] : null;
  }
  await sleep(3000);
  m = await snapOnce();
  const bot2 = m.players.find(p => p[0] === botId);
  const pos2 = bot2 ? [bot2[1], bot2[3]] : null;
  console.log('  Bot 位置: 3秒前', JSON.stringify(pos1), '→ 现在', JSON.stringify(pos2));
  check(pos1 && pos2 && Math.hypot(pos1[0] - pos2[0], pos1[1] - pos2[1]) < 0.01, 'Bot 完全静止不动 ✓');

  // 浏览器端：观察尸体保留
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8076', { waitUntil: 'networkidle' });
  await page.fill('#nick', '观尸员');
  await page.selectOption('#mode', 'test');
  const selState = await page.evaluate(() => ({ val: document.getElementById('map').value, disabled: document.getElementById('map').disabled }));
  console.log('  大厅选择:', JSON.stringify(selState));
  check(selState.val === 'test' && selState.disabled, '选测试模式后地图强制为靶场且不可改 ✓');
  await page.fill('#code', code);
  await page.click('#btn-join');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(2500);
  const info = await page.evaluate(() => ({
    rooms: MAPDATA.rooms.map(r => r.id).join(','),
    bounds: MAPDATA.bounds.max,
    covers: MAPDATA.covers.length,
    persistent: Ragdoll._debugInfo().persistent
  }));
  console.log('  靶场地图:', JSON.stringify(info));
  check(info.rooms === 'field' && info.bounds === 14 && info.covers === 0, '空旷小场地（28×28、零掩体）✓');
  check(info.persistent === true, '测试模式尸体保留开关已启用 ✓');

  // 击杀 Bot → 尸体保留 → Bot 复活 → 再杀 → 尸体堆叠
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'dmg', id: botId, amount: 1000 }));
  await sleep(1200);
  const c1 = await page.evaluate(() => Ragdoll._debugCount());
  console.log('  第一次击杀后尸体数:', c1);
  check(c1 === 1, '击杀生成布娃娃尸体 ✓');
  await sleep(4000); // 4 秒后：普通模式早已消失，测试模式应保留
  const c1b = await page.evaluate(() => Ragdoll._debugCount());
  check(c1b === 1, '4 秒后尸体仍保留（永久）✓');
  // Bot 已复活（1.5s），再杀一次 → 堆两具尸体
  const botAlive = await snapOnce().then(m2 => { const b = m2.players.find(p => p[0] === botId); return b ? b[9] === 1 : false; });
  check(botAlive, 'Bot 已自动复活 ✓');
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'dmg', id: botId, amount: 1000 }));
  await sleep(1200);
  const c2 = await page.evaluate(() => Ragdoll._debugCount());
  console.log('  第二次击杀后尸体数:', c2);
  check(c2 === 2, '同 ID 可堆叠第二具尸体（永久保留）✓');
  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));

  await browser.close();
  ctl.close();
  console.log(failures === 0 ? '\n=== 测试靶场模式通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
