// test/fade-combat.js — 真实交火下的尸体消失（观战者持续开火 + Bot 互打）
'use strict';
process.env.PORT = '8063';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  const ctl = new WebSocket('ws://127.0.0.1:8063');
  let code = '', bots = [];
  let resolveBots = null;
  const botsReady = new Promise(res => { resolveBots = res; });
  ctl.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') code = m.code;
    if (m.t === 'roster') { const bs = m.players.filter(p => p.bot).map(p => p.id); if (bs.length >= 2 && !bots.length) { bots = bs; resolveBots(); } }
  });
  await new Promise(res => ctl.on('open', () => { ctl.send(JSON.stringify({ t: 'join', name: '房主', team: 't', mode: 'classic' })); res(); }));
  await sleep(700);
  for (let i = 0; i < 2; i++) ctl.send(JSON.stringify({ t: 'addbot', diff: 'normal' }));
  await botsReady;

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  const warns = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.text()); });
  await page.goto('http://127.0.0.1:8063', { waitUntil: 'networkidle' });
  await page.fill('#nick', '乱斗观察');
  await page.fill('#code', code);
  await page.click('#btn-join');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1000);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'god' }));
  await page.waitForFunction(() => window.__lecsLastSnap && window.__lecsLastSnap.phase === 'live', null, { timeout: 30000 });

  // 60 秒乱斗：把两个 bot 反复传到一起互打，观战者持续开火（触发全部特效路径）
  let lastKill = 0;
  for (let i = 0; i < 60; i++) {
    if (i % 3 === 0) {
      ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', id: bots[0], x: -8 + (i % 5) * 2, z: 2 }));
      ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', id: bots[1], x: 0, z: 2 }));
      // 复活以防全灭
      for (const b of bots) ctl.send(JSON.stringify({ t: 'dev', cmd: 'revive', id: b }));
    }
    // 观战者朝 bot 方向开火
    await page.evaluate((bid) => {
      const snap = window.__lecsLastSnap;
      const t = snap.players.find(p => p[0] === bid);
      const my = snap.players.find(p => p[0] === Main.myId);
      if (t && my) {
        const dx = t[1] - my[1], dz = t[3] - my[3];
        const yaw = Math.atan2(-dx, -dz);
        window.__lecsSend({ t: 'input', seq: 1, keys: { fire: true }, yaw, pitch: 0, tClient: Date.now() });
      }
    }, bots[0]);
    await sleep(1000);
  }
  const finalCorpses = await page.evaluate(() => Ragdoll._debugCount());
  console.log('  60 秒乱斗后残留尸体数:', finalCorpses);
  console.log('  Ragdoll 异常日志数:', warns.filter(w => w.includes('Ragdoll')).length);
  warns.filter(w => w.includes('Ragdoll')).slice(0, 3).forEach(w => console.log('  异常:', w.slice(0, 300)));
  check(finalCorpses === 0, '乱斗结束后无残留尸体');
  check(errors.length === 0, '无页面错误');

  ctl.close();
  await browser.close();
  console.log(failures === 0 ? '\n=== 乱斗尸体测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
