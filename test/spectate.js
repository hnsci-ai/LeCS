// test/spectate.js — 第三人称持枪可见 + 死亡观战显示队友武器
'use strict';
process.env.PORT = '8081';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  // 控制台客户端：建房 + 加 Bot
  const ctl = new WebSocket('ws://127.0.0.1:8081');
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
    ctl.send(JSON.stringify({ t: 'join', name: '房主', team: 't', mode: 'classic' }));
    res();
  }));
  await sleep(800);
  ctl.send(JSON.stringify({ t: 'addbot', diff: 'normal' }));
  await botReady;
  console.log('  房间:', code, '· Bot id:', botId);

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8081', { waitUntil: 'networkidle' });
  await page.fill('#nick', '观战测试');
  await page.selectOption('#team', 't'); // 与房主同队（房主 T，Bot 自动为 CT）
  await page.click('#btn-join'); // 打开房间列表面板（大厅已无房间码输入框）
  await page.waitForSelector('#rooms-panel:not(.hidden)', { timeout: 5000 });
  await page.fill('#rooms-code', code);
  await page.click('#rooms-join-code');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1000);
  await page.waitForFunction(() => window.__lecsLastSnap && window.__lecsLastSnap.phase === 'live', null, { timeout: 30000 });
  await sleep(1000);

  // 1. 第三人称：Bot 应持有与其武器一致的枪模型
  const guns = await page.evaluate(() => Render._debugPlayerGuns());
  const botSnapWeapon = await page.evaluate((bid) => {
    const p = window.__lecsLastSnap.players.find(x => x[0] === bid);
    return p ? p[10] : '';
  }, botId);
  console.log('  第三人称枪模型:', JSON.stringify(guns), '· Bot 实际武器:', botSnapWeapon);
  check(guns[botId] && guns[botId] === botSnapWeapon && botSnapWeapon.length > 0,
    'Bot 第三人称持枪模型与其武器一致（' + botSnapWeapon + '）✓');

  // 2. 击杀自己 → 观战同队队友（房主 id=1），应显示队友的武器
  await page.evaluate(() => {
    const my = window.__lecsLastSnap.players.find(p => p[0] === Main.myId);
    window.__lecsSend({ t: 'dev', cmd: 'dmg', id: my[0], amount: 1000 });
  });
  await sleep(800);
  const dead = await page.evaluate(() => {
    const my = window.__lecsLastSnap.players.find(p => p[0] === Main.myId);
    return my[9] === 0;
  });
  check(dead, '我已阵亡');
  await sleep(800);
  const specState = await page.evaluate((bid) => {
    const snap = window.__lecsLastSnap;
    const my = snap.players.find(p => p[0] === Main.myId);
    // 观战目标 = 第一个存活的同队队友（这里应是房主，T 队 id 最小）
    const target = snap.players.find(p => p[9] === 1 && p[8] === my[8] && p[0] !== my[0]);
    return {
      vmWeapon: VM.weaponId(),
      vmVisible: VM._debugVisible(),
      targetWeapon: target ? target[10] : '',
      deathScreen: !document.getElementById('death-screen').classList.contains('hidden'),
      hpShown: document.getElementById('hp-val').textContent,
      ammoShown: document.getElementById('ammo-mag').textContent + '/' + document.getElementById('ammo-res').textContent
    };
  }, botId);
  console.log('  观战状态:', JSON.stringify(specState));
  check(specState.vmVisible, '观战视角显示队友的枪 ✓ 关键修复');
  check(specState.targetWeapon && specState.vmWeapon === specState.targetWeapon,
    '观战显示的武器与队友一致（' + specState.vmWeapon + ' = ' + specState.targetWeapon + '）');
  check(specState.deathScreen, '死亡提示仍显示');
  check(/^\d+$/.test(specState.hpShown) && parseInt(specState.hpShown) > 0, 'HUD 显示观战目标血量（' + specState.hpShown + '）');

  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));

  ctl.close();
  await browser.close();
  console.log(failures === 0 ? '\n=== 观战/第三人称枪测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
