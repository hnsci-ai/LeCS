// test/smoke-vision.js — 烟雾真实遮挡玩家视线：外面看不到烟里的目标、烟内看不到外面
// 分层结构：内壁烟墙（BackSide）+ 双层外壳（FrontSide）+ 云絮精灵 + 相机前烟絮板 + 烟内指数雾
// 场地几何（test 地图 ±14，周长墙在 z=-14）：
//   掷烟员 (0,-2) 投烟 → 落点约 (0,-8)，烟团半径 5.5 → 覆盖 z -2.5..-13.5（全部在场内）
//   观察员 (0,-1) 在场外看 → Bot 在烟内 (0,-9) 应被烟遮住
//   观察员进烟 (0,-7) → Bot 移开 (3,-9) → 朝场边墙看应只看到灰烟墙
'use strict';
process.env.PORT = '8071';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const fs = require('fs');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }
const dist = (a, b) => Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);

(async () => {
  fs.mkdirSync('test/artifacts', { recursive: true });
  const ctl = new WebSocket('ws://127.0.0.1:8071');
  let code = '', botId = 0;
  let rb; const botReady = new Promise(r => { rb = r; });
  ctl.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') code = m.code;
    if (m.t === 'roster') { const bot = m.players.find(p => p.bot); if (bot && !botId) { botId = bot.id; rb(); } }
  });
  await new Promise(res => ctl.on('open', () => { ctl.send(JSON.stringify({ t: 'join', name: '掷烟员', team: 't', mode: 'test' })); res(); }));
  await sleep(500);
  ctl.send(JSON.stringify({ t: 'addbot', diff: 'easy' }));
  await botReady;

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8071', { waitUntil: 'networkidle' });
  await page.fill('#nick', '观察员');
  await page.selectOption('#mode', 'test'); // 与房间模式一致（服务器会拒绝不匹配的加入）
  await page.fill('#code', code);
  await page.click('#btn-join');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1500);
  // 观察员摆到 (0,-1)（烟团前方场外），Bot 摆到 (0,-9)（烟团内部，屏幕中心 8 米处）；
  // 掷烟员先挪到场外 (0,10)，避免其模型挡在观察员与 Bot 之间
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'revive' }));
  await sleep(400);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'tp', x: 0, z: -1 }));
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', id: botId, x: 0, z: -9 }));
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', x: 0, z: 10 })); // 掷烟员场外
  await sleep(800);

  const centerPixel = () => page.evaluate(() => {
    const c = document.getElementById('gl');
    const ctx = c.getContext('webgl2') || c.getContext('webgl');
    if (!ctx) return null;
    const buf = new Uint8Array(4);
    ctx.readPixels(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
    return { r: buf[0], g: buf[1], b: buf[2] };
  });
  // 网格采样：7×3 个点 [灰/彩+亮度]，readPixels 的 y 从底部起算 → 第 1 行是画面下方
  const gridInfo = () => page.evaluate(() => {
    const c = document.getElementById('gl');
    const ctx = c.getContext('webgl2') || c.getContext('webgl');
    if (!ctx) return null;
    const buf = new Uint8Array(4);
    const rows = [];
    for (let gy = 0; gy < 3; gy++) {
      const row = [];
      for (let gx = 0; gx < 7; gx++) {
        const x = Math.floor(c.width * (0.1 + gx * 0.1333));
        const y = Math.floor(c.height * (0.25 + gy * 0.25));
        ctx.readPixels(x, y, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
        const mx = Math.max(buf[0], buf[1], buf[2]), mn = Math.min(buf[0], buf[1], buf[2]);
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        row.push((sat < 0.18 ? '灰' : '彩') + Math.round((buf[0] + buf[1] + buf[2]) / 3));
      }
      rows.push(row.join(' '));
    }
    return rows.join(' | ');
  });

  // 中心列纵向剖面：x=中心，y 从 10% 到 90%（readPixels y 从底部起算）
  const colProfile = (xfrac) => page.evaluate((xf) => {
    const c = document.getElementById('gl');
    const ctx = c.getContext('webgl2') || c.getContext('webgl');
    if (!ctx) return null;
    const buf = new Uint8Array(4);
    const out = [];
    for (let i = 0; i < 13; i++) {
      const y = Math.floor(c.height * (0.06 + i * 0.07));
      ctx.readPixels(Math.floor(c.width * xf), y, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
      const mx = Math.max(buf[0], buf[1], buf[2]), mn = Math.min(buf[0], buf[1], buf[2]);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      out.push((sat < 0.18 ? '灰' : '彩') + Math.round((buf[0] + buf[1] + buf[2]) / 3));
    }
    return out.join(' ');
  }, xfrac);

  // 1. 无烟时：屏幕中心是 Bot —— 验证参照（Bot 现戴便帽/头巾，头部像素偏暗，放宽阈值）
  const p0 = await centerPixel();
  console.log('  无烟时中心像素:', JSON.stringify(p0), '· 网格:', await gridInfo());
  check(p0 && p0.r + p0.g + p0.b > 60, '无烟时屏幕中心有内容（Bot 参照）');
  await page.screenshot({ path: 'test/artifacts/smoke-01-outside-no-smoke.png' });

  // 2. 掷烟员到 (0,-2) 朝 -z 投烟雾弹（落点约 (0,-10)，盖住 Bot），投完立即退回场外
  ctl.send(JSON.stringify({ t: 'buy', id: 'smokegrenade' }));
  await sleep(300);
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', x: 0, z: -2 }));
  await sleep(300);
  ctl.send(JSON.stringify({ t: 'input', seq: 1, keys: {}, slot: 4, yaw: 0, pitch: -0.9, tClient: Date.now() }));
  await sleep(300);
  ctl.send(JSON.stringify({ t: 'input', seq: 2, keys: { fire: true }, yaw: 0, pitch: -0.9, tClient: Date.now() }));
  await sleep(100);
  ctl.send(JSON.stringify({ t: 'input', seq: 3, keys: {}, yaw: 0, pitch: -0.9, tClient: Date.now() }));
  await sleep(300);
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', x: 0, z: 10 })); // 掷烟员退回场外（离开观察员视线）
  await sleep(6000); // 引信 + 扩散（r 3.5 秒长满）

  // 3. 外面看：烟内的 Bot 被双层外壳+云絮遮住
  console.log('  玩家位置:', JSON.stringify(await page.evaluate(() =>
    (window.__lecsLastSnap.players || []).map(p => [p[16], p[1], p[3]]))),
    '· 烟团快照:', JSON.stringify(await page.evaluate(() => window.__lecsLastSnap.smokes)),
    '· 烟debug:', JSON.stringify(await page.evaluate(() => Render._debugSmoke())));
  const p1 = await centerPixel();
  console.log('  烟起后中心像素:', JSON.stringify(p1), '· 网格:', await gridInfo());
  console.log('  中心列剖面:', await colProfile(0.5), '· 侧列(x=0.37):', await colProfile(0.37));
  await page.screenshot({ path: 'test/artifacts/smoke-02-outside-in-smoke.png' });
  const dOut = dist(p0, p1);
  console.log('  无烟→有烟 像素距离:', dOut.toFixed(0));
  check(dOut > 60, '外面看不到烟里的 Bot（双层烟壳+云絮遮挡，像素距离>60）');

  // 4. 里面看：观察员进烟，Bot 移开 → 朝场边墙看只看到灰烟墙+雾
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'tp', x: 0, z: -7 })); // 进到烟团内部
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', id: botId, x: 3, z: -9 })); // Bot 移出中心视线
  await sleep(1200);
  const overlayOn = await page.evaluate(() => !document.getElementById('smoke-overlay').classList.contains('hidden'));
  const dbg2 = await page.evaluate(() => Render._debugSmoke());
  const p2 = await centerPixel();
  console.log('  烟内中心像素:', JSON.stringify(p2), '· 网格:', await gridInfo(),
    '· 烟debug:', JSON.stringify(dbg2), '· 烟雾视界:', overlayOn);
  await page.screenshot({ path: 'test/artifacts/smoke-03-inside.png' });
  check(overlayOn, '站在烟里触发烟雾视界（overlay 开启）');
  check(dbg2 && dbg2.strength > 0.1, '烟内强度生效（smokeStrength>0.1）');
  check(dbg2 && dbg2.fogDensity > 0.02, '烟内指数雾生效（fogDensity>0.02）');
  check(p2 && Math.abs(p2.r - p2.g) < 30 && Math.abs(p2.g - p2.b) < 30 && p2.r + p2.g + p2.b > 250,
    '烟内画面呈灰烟色（外面世界被烟墙+雾遮住）');

  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));
  await browser.close();
  ctl.close();
  console.log(failures === 0 ? '\n=== 烟雾遮挡测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
