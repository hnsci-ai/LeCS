// test/barrel.js — 油桶可被打爆：射击若干次后爆炸，产生范围伤害，客户端变焦黑残骸
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
  // dm + dust 图：立即开战、免费武器，dust 图有 5 个油桶（索引 3 在 (0,-12) 中路）
  const ctl = new WebSocket('ws://127.0.0.1:8077');
  let code = '';
  ctl.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.t === 'joined') code = m.code; });
  await new Promise(res => ctl.on('open', () => { ctl.send(JSON.stringify({ t: 'join', name: '枪手', team: 't', mode: 'dm', map: 'dust' })); res(); }));
  await sleep(500);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8077', { waitUntil: 'networkidle' });
  await page.fill('#nick', '观察员');
  await page.click('#btn-join'); // 房间列表面板
  await page.waitForSelector('#rooms-panel:not(.hidden)', { timeout: 5000 });
  await page.fill('#rooms-code', code);
  await page.click('#rooms-join-code');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1500);

  // 观察员站到 (3,-12)：距油桶 (0,-12) 约 3 米（爆炸伤害范围内，避开射击线）
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'revive' }));
  await sleep(400);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'tp', x: 3, z: -12 }));
  // 枪手到 (0,-16)（油桶南侧 4 米），发一把 Glock（20 伤害 → 45 血油桶需 3 发）
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'give', weapon: 'glock' }));
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', x: 0, z: -16 }));
  await sleep(600);

  console.log('== 1. 射击前状态 ==');
  const diag = await page.evaluate(() => ({
    snapMap: window.__lecsLastSnap ? window.__lecsLastSnap.map : '?',
    snapMode: window.__lecsLastSnap ? window.__lecsLastSnap.mode : '?',
    barrelCount: (window.MAPDATA && window.MAPDATA.covers) ? window.MAPDATA.covers.filter(c => c.cover === 'barrel').length : -1
  }));
  console.log('  客户端诊断:', JSON.stringify(diag));
  const before = await page.evaluate(() => Render._debugBarrel(3));
  const hpBefore = await page.evaluate(() => document.getElementById('hp-val').textContent);
  console.log('  油桶实例:', JSON.stringify(before), '· 观察员 HP:', hpBefore);
  check(before && before.r > 0.9, '油桶为原始红色（颜色乘数=白）');
  check(hpBefore === '100', '观察员满血');

  console.log('== 2. 朝油桶 (0,-12) 射击（Glock，需 3 发打爆）==');
  for (let i = 0; i < 5; i++) {
    ctl.send(JSON.stringify({ t: 'input', seq: 100 + i, keys: { fire: true }, yaw: Math.PI, pitch: -0.26, tClient: Date.now() }));
    await sleep(120);
    ctl.send(JSON.stringify({ t: 'input', seq: 200 + i, keys: {}, yaw: Math.PI, pitch: -0.26, tClient: Date.now() }));
    await sleep(380);
  }
  await sleep(800);

  const after = await page.evaluate(() => Render._debugBarrel(3));
  const hpAfter = await page.evaluate(() => document.getElementById('hp-val').textContent);
  console.log('  油桶实例:', JSON.stringify(after), '· 观察员 HP:', hpAfter);
  check(after && after.r < 0.5 && after.scaleX < 0.8, '油桶被打爆：焦黑（r=' + (after ? after.r : '?') + '）且压扁（scaleX=' + (after ? after.scaleX : '?') + '）');
  check(parseInt(hpAfter, 10) < 100, '爆炸范围伤害生效（观察员 HP 100 → ' + hpAfter + '）');
  await page.screenshot({ path: 'test/artifacts/barrel-exploded.png' });

  console.log('== 3. 再射击残骸：不应再有爆炸事件（已销毁）==');
  let hitEvents = 0;
  await page.evaluate(() => { window.__barrelHits = 0; });
  const orig = await page.evaluate(() => Render._debugBarrel(3));
  for (let i = 0; i < 3; i++) {
    ctl.send(JSON.stringify({ t: 'input', seq: 300 + i, keys: { fire: true }, yaw: Math.PI, pitch: -0.26, tClient: Date.now() }));
    await sleep(120);
    ctl.send(JSON.stringify({ t: 'input', seq: 400 + i, keys: {}, yaw: Math.PI, pitch: -0.26, tClient: Date.now() }));
    await sleep(380);
  }
  const after2 = await page.evaluate(() => Render._debugBarrel(3));
  check(after2 && Math.abs(after2.r - orig.r) < 0.01, '残骸不再响应射击（状态不变）');

  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));
  await browser.close();
  ctl.close();
  console.log(failures === 0 ? '\n=== 油桶爆炸测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
