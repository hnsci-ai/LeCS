// test/ragdoll.js — 布娃娃专项测试：死亡生成、物理下落、重生清除、稳定性
'use strict';
process.env.PORT = '8088';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  // 控制台 WebSocket 客户端（与页面同房，用于杀/复活 Bot）
  const ctl = new WebSocket('ws://127.0.0.1:8088');
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
    ctl.send(JSON.stringify({ t: 'join', name: '测试控制台', team: 't', mode: 'classic' }));
    res();
  }));
  await sleep(800); // 等待 joined 消息
  ctl.send(JSON.stringify({ t: 'addbot', diff: 'normal' }));
  ctl.send(JSON.stringify({ t: 'addbot', diff: 'normal' }));
  await botReady;
  console.log('  房间:', code, '· Bot id:', botId);

  // 页面加入同一房间
  await page.goto('http://127.0.0.1:8088', { waitUntil: 'networkidle' });
  await page.fill('#nick', '布娃娃测试');
  await page.fill('#code', code);
  await page.click('#btn-join');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1500);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));
  await sleep(7000); // 等 live

  // 击杀 bot → 布娃娃生成
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'dmg', id: botId, amount: 1000 }));
  await sleep(800);
  const c1 = await page.evaluate(() => Ragdoll._debugCount());
  console.log('  击杀后活跃布娃娃数:', c1);
  check(c1 >= 1, '击杀后生成布娃娃尸体');

  // 物理下落：0.7 秒后 torso 高度应明显下降（尸体约 2 秒后淡出）
  await sleep(700);
  const st = await page.evaluate(() => Ragdoll._debugState());
  if (st.length) {
    console.log('  布娃娃状态:', JSON.stringify(st));
    check(st[0].torsoY < 1.0, '布娃娃躯干受重力塌落（y=' + st[0].torsoY + '）');
  } else {
    check(false, '布娃娃状态读取失败');
  }

  // 重生清除：复活 bot
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'revive', id: botId }));
  await sleep(1500);
  const c2 = await page.evaluate(() => Ragdoll._debugCount());
  console.log('  复活后活跃布娃娃数:', c2);
  check(c2 === 0, '玩家复活后旧尸体被清除');

  // 稳定性：连续击杀 3 次
  let kills = 0;
  for (let i = 0; i < 3; i++) {
    await sleep(500);
    ctl.send(JSON.stringify({ t: 'dev', cmd: 'dmg', id: botId, amount: 1000 }));
    await sleep(700);
    const n = await page.evaluate(() => Ragdoll._debugCount());
    if (n >= 1) kills++;
    ctl.send(JSON.stringify({ t: 'dev', cmd: 'revive', id: botId }));
  }
  console.log('  连续击杀测试: ' + kills + '/3 次生成布娃娃');
  check(kills === 3, '连续击杀均生成布娃娃（稳定性）');
  check(errors.length === 0, '全程无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));

  ctl.close();
  await browser.close();
  console.log(failures === 0 ? '\n=== 布娃娃测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
