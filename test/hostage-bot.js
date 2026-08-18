// test/hostage-bot.js — Bot 人质营救：带领 → 护送回营救区 → 获救
'use strict';
process.env.PORT = '8065';
process.env.ALLOW_DEV = '1';
require('../server/index');
const WebSocket = require('ws');
const URL = 'ws://127.0.0.1:8065';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

(async () => {
  const ws = new WebSocket(URL);
  let last = null, myId = 0;
  const events = [];
  ws.on('message', raw => {
    const m = JSON.parse(raw.toString());
    if (m.t === 'snap') last = m;
    if (m.t === 'joined') myId = m.id;
    if (m.t === 'event') events.push(m.ev);
  });
  await new Promise(res => ws.on('open', res));
  ws.send(JSON.stringify({ t: 'join', name: '人质观察员', team: 't', mode: 'hostage' }));
  await sleep(800);
  ws.send(JSON.stringify({ t: 'addbot', diff: 'normal' }));
  ws.send(JSON.stringify({ t: 'addbot', diff: 'normal' }));
  await sleep(1000);
  for (let i = 0; i < 50 && last.phase !== 'live'; i++) await sleep(200);

  // 找出 CT bot 与 T bot（观察员是 T，2 个 bot 自动平衡为 1T 1CT）
  const bots = last.players.filter(p => p[18] === 1);
  const ctBot = bots.find(p => p[8] === 1);
  const tBot = bots.find(p => p[8] === 0);
  console.log('  CT bot:', ctBot && ctBot[0], '· T bot:', tBot && tBot[0]);
  check(!!ctBot, '存在 CT bot');

  // 杀掉 T bot 排除干扰（人质模式 T 全灭不结束回合）
  if (tBot) ws.send(JSON.stringify({ t: 'dev', cmd: 'dmg', id: tBot[0], amount: 1000 }));
  await sleep(600);

  // 把 CT bot 传送到 A 点人质 (-25,-30) 旁 2 米处
  ws.send(JSON.stringify({ t: 'dev', cmd: 'tp', id: ctBot[0], x: -23, z: -30 }));
  await sleep(500);

  // 观察：人质应被带领（follow），随后护送回营救区获救（rescue）
  let followSeen = false, rescueSeen = false;
  for (let i = 0; i < 100; i++) { // 最多 50 秒
    await sleep(500);
    if (events.some(e => e.type === 'hostage' && e.event === 'follow')) followSeen = true;
    if (events.some(e => e.type === 'hostage' && e.event === 'rescue')) { rescueSeen = true; break; }
  }
  console.log('  带领:', followSeen, '· 获救:', rescueSeen);
  check(followSeen, 'CT bot 按 E 带领人质 ✓ 关键修复');
  check(rescueSeen, 'CT bot 护送人质回营救区并获救 ✓');
  check(last.rescued >= 1, '服务器营救计数 +1（' + last.rescued + '）');

  console.log(failures === 0 ? '\n=== Bot 人质营救测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e.message); process.exit(1); });
