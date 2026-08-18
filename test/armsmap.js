// test/armsmap.js — 军备竞赛专用小图：强制 arms 地图、升级阶梯、浏览器渲染
'use strict';
process.env.PORT = '8077';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  const ctl = new WebSocket('ws://127.0.0.1:8077');
  let code = '', botId = 0, joinedMap = '', ctlId = 0;
  let rb; const botReady = new Promise(r => { rb = r; });
  ctl.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') { code = m.code; joinedMap = m.map || ''; ctlId = m.id; }
    if (m.t === 'roster') { const bot = m.players.find(p => p.bot); if (bot && !botId) { botId = bot.id; rb(); } }
  });
  await new Promise(res => ctl.on('open', () => {
    // 故意选 dust 地图，服务器必须强制换成 arms
    ctl.send(JSON.stringify({ t: 'join', name: '枪王', team: 't', mode: 'armsrace', map: 'dust' }));
    res();
  }));
  await sleep(500);
  ctl.send(JSON.stringify({ t: 'addbot', diff: 'easy' }));
  await botReady;
  console.log('  房间:', code, '· joined.map =', joinedMap);
  check(joinedMap === 'arms', '军备竞赛强制专用小图 arms（无视所选地图）');

  // 等 live + Bot 移动（小图更容易遭遇）
  let moved = false;
  let snapMap = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    await sleep(500);
    const m = await new Promise(res => {
      const onMsg = raw => {
        const mm = JSON.parse(raw.toString());
        if (mm.t === 'snap') { ctl.removeListener('message', onMsg); res(mm); }
      };
      ctl.on('message', onMsg);
    });
    snapMap = m.map || '';
    const bot = m.players.find(p => p[0] === botId);
    if (bot && bot[9] === 1) moved = true;
    if (m.phase === 'live' && moved) break;
  }
  check(snapMap === 'arms', '快照携带地图名 arms');
  check(moved, 'Bot 在小图上正常行动');

  // 击杀 → 军备竞赛升级阶梯推进
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'dmg', id: botId, amount: 1000 }));
  await sleep(800);
  const m2 = await new Promise(res => {
    const onMsg = raw => {
      const mm = JSON.parse(raw.toString());
      if (mm.t === 'snap') { ctl.removeListener('message', onMsg); res(mm); }
    };
    ctl.on('message', onMsg);
  });
  const me = m2.players.find(p => p[0] === ctlId);
  console.log('  击杀后 armsLevel:', me ? me[30] : -1, '· 阶梯长度:', (m2.armsLadder || []).length);
  check(me && me[30] === 1, '击杀后升级到阶梯第 2 级 ✓');
  check((m2.armsLadder || []).length === 25, '25 级武器阶梯完整 ✓');

  // 浏览器端：选军备竞赛 → 自动切到小图渲染
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8077', { waitUntil: 'networkidle' });
  await page.fill('#nick', '小图观战');
  await page.selectOption('#mode', 'armsrace');
  const selState = await page.evaluate(() => ({ val: document.getElementById('map').value, disabled: document.getElementById('map').disabled }));
  console.log('  大厅地图选择:', JSON.stringify(selState));
  check(selState.val === 'arms' && selState.disabled, '选军备竞赛后地图强制为小图且不可改 ✓');
  await page.fill('#code', code);
  await page.click('#btn-join');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(2500);
  const roomsIds = await page.evaluate(() => MAPDATA.rooms.map(r => r.id).join(','));
  const bounds = await page.evaluate(() => MAPDATA.bounds.max);
  console.log('  客户端地图:', roomsIds, '· bounds.max =', bounds);
  check(roomsIds === 'north,south,west,east', '客户端已切换到小图数据 ✓');
  check(bounds === 16, '小图世界半径 16（32×32 紧凑竞技场）✓');
  const pixels = await page.evaluate(() => {
    const c = document.getElementById('gl');
    const ctx = c.getContext('webgl2') || c.getContext('webgl');
    if (!ctx) return 0;
    const buf = new Uint8Array(c.width * c.height * 4);
    ctx.readPixels(0, 0, c.width, c.height, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
    let n = 0;
    for (let i = 0; i < buf.length; i += 400) if (buf[i + 3] > 0) n++;
    return n;
  });
  check(pixels > 100, '小图场景正常渲染');
  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));

  await browser.close();
  ctl.close();
  console.log(failures === 0 ? '\n=== 军备竞赛小图测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
