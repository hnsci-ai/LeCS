// test/roomlist.js — 大厅房间列表：浏览房间信息、双击加入并自动匹配模式、面板内直接输入房间码
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
  // 房主：创建 classic/dust 房间
  const host = new WebSocket('ws://127.0.0.1:8076');
  let code = '';
  host.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.t === 'joined') code = m.code; });
  await new Promise(res => host.on('open', () => { host.send(JSON.stringify({ t: 'join', name: '房主', team: 'ct', mode: 'classic', map: 'dust' })); res(); }));
  await sleep(400);
  check(!!code, '房主创建房间成功（' + code + '）');

  // 房间列表查询（无需加入）
  const probe = new WebSocket('ws://127.0.0.1:8076');
  let list = null;
  probe.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.t === 'rooms') list = m.rooms; });
  await new Promise(res => probe.on('open', () => { probe.send(JSON.stringify({ t: 'rooms' })); res(); }));
  await sleep(300);
  console.log('  房间列表:', JSON.stringify(list));
  check(list && list.some(r => r.code === code && r.mode === 'classic' && r.map === 'dust' && r.players === 1),
    '列表包含房间（码/模式/地图/人数 1/10）');
  probe.close();

  // 浏览器：大厅 → 不填码点「加入房间」→ 弹出列表 → 模式故意选 dm → 双击进入应自动匹配 classic
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8076', { waitUntil: 'networkidle' });
  await page.fill('#nick', '列表加入者');
  await page.selectOption('#mode', 'dm'); // 故意不一致 → 服务器应自动匹配房间模式
  await page.click('#btn-join');           // 未填码 → 打开列表
  await page.waitForSelector('#rooms-panel:not(.hidden)', { timeout: 5000 });
  await sleep(700);                        // 等列表刷新
  const rowText = await page.textContent('#rooms-list').catch(() => '');
  console.log('  面板内容:', (rowText || '').replace(/\s+/g, ' ').slice(0, 140));
  check(rowText.includes(code), '面板显示房主房间码');
  check(rowText.includes('经典爆破'), '面板显示模式名（经典爆破）');
  check(rowText.includes('仓库'), '面板显示地图名（仓库）');
  await page.screenshot({ path: 'test/artifacts/roomlist.png' });
  // 双击房间行 → 直接进入
  await page.dblclick('.room-row');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1500);
  const joinedMode = await page.evaluate(() => window.__lecsLastSnap ? window.__lecsLastSnap.mode : '?');
  console.log('  加入后模式:', joinedMode);
  check(joinedMode === 'classic', '双击进入且模式自动匹配为 classic（页面选的 dm 被忽略）');

  // 面板内直接输入房间码：第二个浏览器
  const host2 = new WebSocket('ws://127.0.0.1:8076');
  let code2 = '';
  host2.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.t === 'joined') code2 = m.code; });
  await new Promise(res => host2.on('open', () => { host2.send(JSON.stringify({ t: 'join', name: '房主2', team: 't', mode: 'dm' })); res(); }));
  await sleep(400);
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page2.goto('http://127.0.0.1:8076', { waitUntil: 'networkidle' });
  await page2.fill('#nick', '码进入者');
  await page2.click('#btn-join');
  await page2.waitForSelector('#rooms-panel:not(.hidden)', { timeout: 5000 });
  await page2.fill('#rooms-code', code2);
  await page2.click('#rooms-join-code');
  await page2.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1500);
  const joinedMode2 = await page2.evaluate(() => window.__lecsLastSnap ? window.__lecsLastSnap.mode : '?');
  console.log('  面板输码加入后模式:', joinedMode2);
  check(joinedMode2 === 'dm', '面板内输入房间码直接进入（模式自动匹配 dm）');

  await page.close(); await page2.close();
  await browser.close();
  host.close(); host2.close();
  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));
  console.log(failures === 0 ? '\n=== 房间列表测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
