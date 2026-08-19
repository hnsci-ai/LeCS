// test/ammo.js — 三种特殊子弹（穿甲/破肢/燃烧）+ 雷达只显示队友
'use strict';
process.env.PORT = '8087';
process.env.ALLOW_DEV = '1';
require('../server/index');
const { chromium } = require('playwright-core');
const { WebSocket } = require('ws');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  const ctl = new WebSocket('ws://127.0.0.1:8087');
  let code = '', botId = 0, botHp = -1;
  ctl.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'joined') code = m.code;
    if (m.t === 'roster') { const b = m.players.find(p => p.bot); if (b && !botId) botId = b.id; }
    if (m.t === 'snap') {
      const b = (m.players || []).find(q => q[0] === botId);
      if (b) botHp = b[6];
    }
  });
  await new Promise(res => ctl.on('open', () => { ctl.send(JSON.stringify({ t: 'join', name: '枪手', team: 't', mode: 'test' })); res(); }));
  await sleep(400);
  ctl.send(JSON.stringify({ t: 'addbot', diff: 'easy' }));
  await sleep(400);
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'armor', id: botId, armor: 100 })); // Bot 满甲
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'give', weapon: 'glock' })); // Glock 25 伤 / armorPen 0.5

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:8087', { waitUntil: 'networkidle' });
  await page.fill('#nick', '观察员');
  await page.click('#btn-join');
  await page.waitForSelector('#rooms-panel:not(.hidden)', { timeout: 5000 });
  await page.fill('#rooms-code', code);
  await page.click('#rooms-join-code');
  await page.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
  await sleep(1500);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'revive' }));
  await sleep(400);
  await page.evaluate(() => window.__lecsSend({ t: 'dev', cmd: 'tp', x: 6, z: 6 }));

  // 枪手 (0,-2)，Bot (0,-8)：6 米外；腰射 pitch -0.1（躯干）、-0.213（腿）
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', x: 0, z: -2 }));
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'hp', id: botId, hp: 100 }));
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'tp', id: botId, x: 0, z: -8 }));
  await sleep(400);
  async function shoot(pitch, n) {
    for (let i = 0; i < n; i++) {
      ctl.send(JSON.stringify({ t: 'input', seq: 100 + i * 2, keys: { fire: true }, yaw: 0, pitch, tClient: Date.now() }));
      await sleep(120);
      ctl.send(JSON.stringify({ t: 'input', seq: 101 + i * 2, keys: {}, yaw: 0, pitch, tClient: Date.now() }));
      await sleep(400);
    }
    await sleep(300);
  }

  console.log('== 1. 穿甲弹：无视护甲直接打肉 ==');
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'hp', id: botId, hp: 100 }));
  await sleep(300);
  await shoot(-0.1, 1);
  const normalDrop = 100 - botHp;
  ctl.send(JSON.stringify({ t: 'buy', id: 'ammo_ap' }));
  await sleep(300);
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'hp', id: botId, hp: 100 }));
  await sleep(300);
  await shoot(-0.1, 1);
  const apDrop = 100 - botHp;
  console.log('  普通子弹掉血:', normalDrop, '· 穿甲弹掉血:', apDrop);
  check(apDrop >= normalDrop * 1.6, '穿甲弹无视护甲（' + apDrop + ' vs 普通 ' + normalDrop + '）');

  console.log('== 2. 破肢弹：打腿比普通多 35% ==');
  ctl.send(JSON.stringify({ t: 'buy', id: 'ammo_limb' }));
  await sleep(300);
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'hp', id: botId, hp: 100 }));
  await sleep(300);
  await shoot(-0.213, 1);
  const limbDrop = 100 - botHp;
  const expectNormalLeg = 16; // 25×0.75×距离衰减0.835 ≈ 16
  console.log('  破肢弹打腿掉血:', limbDrop, '（普通打腿约', expectNormalLeg, '）');
  check(limbDrop >= expectNormalLeg * 1.25, '破肢弹打腿伤害 +35%（' + limbDrop + ' vs ' + expectNormalLeg + '）');

  console.log('== 3. 燃烧弹：中弹后持续灼烧 ==');
  ctl.send(JSON.stringify({ t: 'buy', id: 'ammo_incendiary' }));
  await sleep(300);
  ctl.send(JSON.stringify({ t: 'dev', cmd: 'hp', id: botId, hp: 100 }));
  await sleep(300);
  await shoot(-0.1, 1);
  await sleep(150);
  const h1 = botHp;
  await sleep(4000);
  const h2 = botHp;
  console.log('  中弹后 HP:', h1, '→ 4 秒后 HP:', h2, '（灼烧', h1 - h2, '点）');
  check(h1 - h2 >= 8, '燃烧弹持续灼烧（4 秒约 12 点，实测 ' + (h1 - h2) + '）');

  console.log('== 4. 雷达只显示队友 ==');
  await sleep(600);
  const radarInfo = await page.evaluate(() => ({
    ids: HUD._debugRadar(),
    myTeam: (() => { const p = (window.__lecsLastSnap.players || []).find(q => q[16] === '观察员'); return p ? p[8] : -1; })(),
    teams: (window.__lecsLastSnap.players || []).map(q => [q[0], q[16], q[8]])
  }));
  console.log('  雷达人员:', JSON.stringify(radarInfo.ids), '· 我的队伍:', radarInfo.myTeam, '· 全员:', JSON.stringify(radarInfo.teams));
  const obsTeam = radarInfo.myTeam;
  const allTeams = radarInfo.teams;
  const enemyCount = allTeams.filter(q => q[2] !== obsTeam).length;
  const radarShowsEnemy = radarInfo.ids.some(id => {
    const p = allTeams.find(q => q[0] === id);
    return p && p[2] !== obsTeam;
  });
  check(enemyCount > 0 && !radarShowsEnemy, '雷达不显示敌人（敌人 ' + enemyCount + ' 人，雷达仅队友）');

  check(errors.length === 0, '无 JS 错误' + (errors.length ? ': ' + errors[0].slice(0, 150) : ''));
  await browser.close();
  ctl.close();
  console.log(failures === 0 ? '\n=== 特殊子弹/雷达测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
