// test/jump.js — 掩体跳跃：低沙袋(0.8m)可跳上站顶，高木箱(1.3m)跳不上（玩家：低掩体可站）
'use strict';
const MOV = require('../shared/movement');

let failures = 0;
function check(cond, msg) { if (cond) console.log('  ✓ ' + msg); else { failures++; console.log('  ✗ ' + msg); } }

function run(wall, label) {
  // 玩家从 x=-3 面向 +x 助跑跳跃
  const p = { x: -3, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: -Math.PI / 2, onGround: true, crouch: false, h: 1.72, eye: 1.62 };
  const dt = 1 / 60;
  let jumped = false, stoodTop = false;
  for (let i = 0; i < 180; i++) {
    const inp = { f: true, b: false, l: false, r: false, walk: false, crouch: false, jump: !jumped && i > 5 };
    if (inp.jump) jumped = true;
    MOV.step(p, inp, dt, [wall]);
    if (jumped && p.onGround && p.y > 0.7) stoodTop = true; // 曾在低掩体顶面站立
  }
  console.log(`  ${label}: 最终 x=${p.x.toFixed(2)} y=${p.y.toFixed(2)} 曾站顶=${stoodTop}`);
  return { p, stoodTop };
}

const bag = run({ x1: -1.2, y1: 0, z1: -1.2, x2: 1.2, y2: 0.8, z2: 1.2 }, '沙袋(0.8m)');
check(bag.stoodTop, '沙袋可跳上并站顶（0.8m 低掩体）');
check(bag.p.x > 1.2, '站顶后可持续前进越过沙袋');

const crate = run({ x1: -1.2, y1: 0, z1: -1.2, x2: 1.2, y2: 1.3, z2: 1.2 }, '木箱(1.3m)');
check(!crate.stoodTop, '高木箱跳不上去（无法站顶）');
check(crate.p.x < 0, '被高木箱挡住（x=' + crate.p.x.toFixed(2) + '）');

console.log(failures === 0 ? '\n=== 跳跃测试通过 ✓ ===' : `\n=== ${failures} 项失败 ✗ ===`);
process.exit(failures === 0 ? 0 : 1);
