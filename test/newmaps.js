// test/newmaps.js — 新地图 cross/lanes：建房、Bot 移动、客户端渲染
'use strict';
process.env.PORT = '8073';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

async function mapRoom(mapName, expectRooms) {
  const ctl = new WebSocket('ws://127.0.0.1:8073');
  let code = '', botId = 0, joinedMap = '';
  let rb; const botReady = new Promise(r => { rb = r; });
  ctl.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') { code = m.code; joinedMap = m.map || ''; }
    if (m.t === 'roster') { const bot = m.players.find(p => p.bot); if (bot && !botId) { botId = bot.id; rb(); } }
  });
  await new Promise(res => ctl.on('open', () => {
    ctl.send(JSON.stringify({ t: 'join', name: '房主', team: 't', mode: 'classic', map: mapName }));
    res();
  }));
  await sleep(500);
  ctl.send(JSON.stringify({ t: 'addbot', diff: 'easy' }));
  await botReady;
  check(joinedMap === mapName, mapName + ' 建房成功（joined.map）');
  // Bot 移动
  let moved = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    await sleep(500);
    const m = await new Promise(res => {
      const onMsg = raw => {
        const mm = JSON.parse(raw.toString());
        if (mm.t === 'snap') { ctl.removeListener('message', onMsg); res(mm); }
      };
      ctl.on('message', onMsg);
    });
    const bot = m.players.find(p => p[0] === botId);
    if (bot && bot[9] === 1 && m.phase === 'live') moved = true;
    if (moved) break;
  }
  check(moved, mapName + ' 上 Bot 正常行动');
  // 浏览器渲染
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8073', { waitUntil: 'networkidle' });
  await page.fill('#nick', '观图');
  await page.selectOption('#map', mapName);
  await page.fill('#code', code);
  await page.click('#btn-join');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(2500);
  const roomsIds = await page.evaluate(() => MAPDATA.rooms.map(r => r.id).join(','));
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
  console.log('  ' + mapName + ' 房间:', roomsIds, '· 像素采样:', pixels);
  check(roomsIds === expectRooms, mapName + ' 客户端地图数据正确');
  check(pixels > 100, mapName + ' 场景正常渲染');
  check(errors.length === 0, mapName + ' 无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 120) : ''));
  await browser.close();
  ctl.close();
}

(async () => {
  console.log('== cross 十字路口 ==');
  await mapRoom('cross', 'center,north,south,west,east');
  console.log('== lanes 双道突袭 ==');
  await mapRoom('lanes', 'tyard,ctyard,laneW,laneE,mid');
  console.log(failures === 0 ? '\n=== 新地图测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
