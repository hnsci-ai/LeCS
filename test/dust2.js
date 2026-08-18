// test/dust2.js — 新地图 dust2：建房、Bot 移动、击杀掉箱、浏览器渲染
'use strict';
process.env.PORT = '8078';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  const ctl = new WebSocket('ws://127.0.0.1:8078');
  let code = '', botId = 0, joinedMap = '';
  let rb; const botReady = new Promise(r => { rb = r; });
  ctl.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') { code = m.code; joinedMap = m.map || ''; }
    if (m.t === 'roster') { const bot = m.players.find(p => p.bot); if (bot && !botId) { botId = bot.id; rb(); } }
  });
  await new Promise(res => ctl.on('open', () => {
    ctl.send(JSON.stringify({ t: 'join', name: 'dust2房主', team: 't', mode: 'classic', map: 'dust2' }));
    res();
  }));
  await sleep(500);
  ctl.send(JSON.stringify({ t: 'addbot', diff: 'normal' }));
  await botReady;
  console.log('  房间:', code, '· joined.map =', joinedMap);
  check(joinedMap === 'dust2', '建房地图为 dust2（joined 返回）');

  // 等 live，Bot 应在 dust2 地图上移动
  let botPos = null, moved = false, snapMap = '';
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
    if (bot && bot[9] === 1) {
      if (!botPos) botPos = [bot[1], bot[3]];
      else if (Math.hypot(bot[1] - botPos[0], bot[3] - botPos[1]) > 1) moved = true;
    }
    if (m.phase === 'live' && moved) break;
  }
  check(snapMap === 'dust2', '快照携带地图名 dust2');
  check(moved, 'Bot 在 dust2 上正常移动');

  // 击杀 Bot → 3 秒后掉箱（dust2 的箱子逻辑与地图无关，但验证整链）
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'dmg', id: botId, amount: 1000 }));
  await sleep(3800);
  const m2 = await new Promise(res => {
    const onMsg = raw => {
      const mm = JSON.parse(raw.toString());
      if (mm.t === 'snap') { ctl.removeListener('message', onMsg); res(mm); }
    };
    ctl.on('message', onMsg);
  });
  check((m2.crates || []).length >= 1, 'dust2 上击杀掉落战利品箱');

  // 浏览器端：选 dust2 建房 → 场景渲染 + 无 JS 错误
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8078', { waitUntil: 'networkidle' });
  await page.fill('#nick', 'dust2观战');
  await page.selectOption('#map', 'dust2');
  await page.fill('#code', code);
  await page.click('#btn-join');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(2500);
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
  console.log('  渲染像素采样:', pixels);
  check(pixels > 100, 'dust2 场景正常渲染');
  const activeMap = await page.evaluate(() => MAPDATA.rooms.map(r => r.id).join(','));
  console.log('  客户端活动地图房间:', activeMap);
  check(activeMap.includes('tuns') && activeMap.includes('asite'), '客户端已切换到 dust2 地图数据');
  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));

  await browser.close();
  ctl.close();
  console.log(failures === 0 ? '\n=== dust2 地图测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
