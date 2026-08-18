// test/smoke-vision.js — 烟雾真实遮挡玩家视线：外面看不到里面、里面看不到外面
'use strict';
process.env.PORT = '8071';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
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
  // 观察员复活后摆到 (0,-3)（朝向 -z），Bot（静止）摆到 (0,-13) → Bot 在屏幕中心 10 米处
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'revive' }));
  await sleep(400);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'tp', x: 0, z: -3 }));
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', id: botId, x: 0, z: -16 })); // Bot 在烟雾落点后方（烟落于其身前）
  await sleep(800);

  const centerPixel = () => page.evaluate(() => {
    const c = document.getElementById('gl');
    const ctx = c.getContext('webgl2') || c.getContext('webgl');
    if (!ctx) return null;
    const buf = new Uint8Array(4);
    ctx.readPixels(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, buf);
    return { r: buf[0], g: buf[1], b: buf[2] };
  });

  // 1. 无烟时：屏幕中心是 Bot —— 验证参照
  const p0 = await centerPixel();
  console.log('  无烟时中心像素:', JSON.stringify(p0));
  check(p0 && p0.r + p0.g + p0.b > 100, '无烟时屏幕中心有内容（Bot 参照）');

  // 2. ctl 朝 Bot 方向投烟雾弹（落在 Bot 与观察员之间，盖住 Bot）
  ctl.send(JSON.stringify({ t: 'buy', id: 'smokegrenade' }));
  await sleep(300);
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', x: 0, z: -8 }));
  await sleep(300);
  // 切到 4 号位（烟雾弹）再投掷
  ctl.send(JSON.stringify({ t: 'input', seq: 1, keys: {}, slot: 4, yaw: 0, pitch: -0.9, tClient: Date.now() }));
  await sleep(300);
  console.log('  掷烟员状态:', JSON.stringify(await page.evaluate(() => {
    const p = window.__lecsLastSnap.players.find(q => q[16] === '掷烟员');
    return p ? { weapon: p[10], alive: p[9], x: p[1], z: p[3] } : null;
  })));
  ctl.send(JSON.stringify({ t: 'input', seq: 2, keys: { fire: true }, yaw: 0, pitch: -0.9, tClient: Date.now() }));
  await sleep(100);
  ctl.send(JSON.stringify({ t: 'input', seq: 3, keys: {}, yaw: 0, pitch: -0.9, tClient: Date.now() }));
  await sleep(5000); // 引信 + 扩散

  // 3. 外面看：Bot 被烟墙遮住
  console.log('  烟团快照:', JSON.stringify(await page.evaluate(() => window.__lecsLastSnap.smokes)),
    '· 可见烟球:', await page.evaluate(() => Render._debugSmokeSpheres()));
  const p1 = await centerPixel();
  console.log('  烟起后中心像素:', JSON.stringify(p1));

  // 4. 里面看：观察员进烟 → 四周是灰墙（看不到外面）
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'tp', x: 0, z: -12 })); // 进到烟团内部
  await sleep(800);
  // 外面视角：无烟 vs 有烟像素必须显著变化（Bot 被烟墙遮住）
  const dist = (a, b) => Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
  console.log('  无烟→有烟 像素距离:', dist(p0, p1).toFixed(0));
  check(dist(p0, p1) > 30, '外面看不到烟里的 Bot（烟墙遮挡视线）');
  // 里面视角：烟雾视界 overlay 生效（看不清外面）
  const overlayOn = await page.evaluate(() => !document.getElementById('smoke-overlay').classList.contains('hidden'));
  const p2 = await centerPixel();
  console.log('  烟内中心像素:', JSON.stringify(p2), '· 烟雾视界:', overlayOn);
  check(overlayOn, '站在烟里触发烟雾视界（看不清外面）');

  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));
  await browser.close();
  ctl.close();
  console.log(failures === 0 ? '\n=== 烟雾遮挡测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
