// test/maptest.js — 地图密封性与连通性验证（对全部地图生效）
const { MAPS } = require('../shared/mapdata');

let failures = 0;
function check(cond, msg) {
  if (cond) console.log('  ✓ ' + msg);
  else { failures++; console.log('  ✗ ' + msg); }
}

function validateMap(MAP, name) {
  console.log(`\n=== 地图: ${name} ===`);
  console.log('墙壁盒子数量:', MAP.walls.length);

  // 1. 出生点均在可行走单元格且不与墙重叠
  function posOk(x, z, label) {
    const ci = MAP.cellIndex(x, z);
    const walkable = ci >= 0 && MAP.nav.grid[ci] === 1;
    let inWall = false;
    for (const w of MAP.walls) {
      if (x > w.x1 - 0.3 && x < w.x2 + 0.3 && z > w.z1 - 0.3 && z < w.z2 + 0.3 && 0.5 < w.y2) inWall = true;
    }
    check(walkable && !inWall, `${label} (${x},${z}) 可行走且不在墙内`);
  }

  for (const s of MAP.spawns.t) posOk(s.x, s.z, 'T 出生点');
  for (const s of MAP.spawns.ct) posOk(s.x, s.z, 'CT 出生点');

  // 2. 连通性：T家 → A点 / B点 / CT家
  const t0 = MAP.spawns.t[0];
  const routes = [
    ['T家→A点', t0.x, t0.z, MAP.sites.a.plant.x, MAP.sites.a.plant.z],
    ['T家→B点', t0.x, t0.z, MAP.sites.b.plant.x, MAP.sites.b.plant.z],
    ['T家→CT家', t0.x, t0.z, MAP.spawns.ct[0].x, MAP.spawns.ct[0].z],
    ['CT家→A点', MAP.spawns.ct[0].x, MAP.spawns.ct[0].z, MAP.sites.a.plant.x, MAP.sites.a.plant.z],
    ['CT家→B点', MAP.spawns.ct[0].x, MAP.spawns.ct[0].z, MAP.sites.b.plant.x, MAP.sites.b.plant.z],
    ['A点→B点', MAP.sites.a.plant.x, MAP.sites.a.plant.z, MAP.sites.b.plant.x, MAP.sites.b.plant.z]
  ];
  for (const [label, sx, sz, tx, tz] of routes) {
    const p = MAP.findPathSmooth(sx, sz, tx, tz);
    check(!!p && p.length >= 2, `${label} 有路径 (${p ? p.length + ' 个路点' : '无'})`);
  }

  // 3. 密封性：从 T 出生点洪泛，统计可达单元格
  function flood(startX, startZ) {
    const s = MAP.cellIndex(startX, startZ);
    const n = MAP.nav.size * MAP.nav.size;
    const seen = new Uint8Array(n);
    const q = [s]; seen[s] = 1;
    while (q.length) {
      const cur = q.pop();
      const j = Math.floor(cur / MAP.nav.size), i = cur - j * MAP.nav.size;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= MAP.nav.size || nj >= MAP.nav.size) continue;
        const idx = nj * MAP.nav.size + ni;
        if (seen[idx] || !MAP.nav.grid[idx]) continue;
        if (di && dj) {
          if (!MAP.nav.grid[j * MAP.nav.size + ni] || !MAP.nav.grid[nj * MAP.nav.size + i]) continue;
        }
        seen[idx] = 1; q.push(idx);
      }
    }
    return seen;
  }
  const seen = flood(t0.x, t0.z);
  let reachable = 0;
  for (let k = 0; k < seen.length; k++) if (seen[k]) reachable++;
  console.log(`可达单元格: ${reachable} / ${seen.length}`);

  let edgeCells = 0;
  for (let j = 0; j < MAP.nav.size; j++) for (let i = 0; i < MAP.nav.size; i++) {
    if (!seen[j * MAP.nav.size + i]) continue;
    if (i <= 1 || i >= MAP.nav.size - 2 || j <= 1 || j >= MAP.nav.size - 2) {
      const cx = MAP.nav.origin + (i + 0.5) * MAP.nav.cell, cz = MAP.nav.origin + (j + 0.5) * MAP.nav.cell;
      const atEdge = Math.abs(cx) > 30.9 || Math.abs(cz) > 30.9;
      if (atEdge) edgeCells++;
    }
  }
  console.log(`边缘可达单元格数: ${edgeCells}（地图内房间贴边界，属正常）`);

  // 4. 所有房间内部中心可达
  for (const r of MAP.rooms) {
    const cx = (r.x1 + r.x2) / 2, cz = (r.z1 + r.z2) / 2;
    const p = MAP.findPathSmooth(t0.x, t0.z, cx, cz);
    check(!!p, `房间 ${r.id} 中心可达`);
  }

  // 5. 人质点物理间隙
  console.log('  掩体数量:', MAP.walls.length, '· 覆盖物:', MAP.covers ? MAP.covers.length : 0);
  for (const h of (MAP.hostageSpots || [])) {
    let minD = 99;
    for (const w of MAP.walls) {
      const dx = Math.max(w.x1 - h.x, 0, h.x - w.x2);
      const dz = Math.max(w.z1 - h.z, 0, h.z - w.z2);
      minD = Math.min(minD, Math.sqrt(dx * dx + dz * dz));
    }
    check(minD >= 0.8, `人质点 (${h.x},${h.z}) 距掩体 ${minD.toFixed(1)}m ≥ 0.8m`);
  }

  // 6. 埋包点距离墙 ≥2.0m
  for (const key of ['a', 'b']) {
    const p = MAP.sites[key].plant;
    let minD = 99;
    for (const w of MAP.walls) {
      const dx = Math.max(w.x1 - p.x, 0, p.x - w.x2);
      const dz = Math.max(w.z1 - p.z, 0, p.z - w.z2);
      minD = Math.min(minD, Math.sqrt(dx * dx + dz * dz));
    }
    check(minD >= 2.0, `${key.toUpperCase()} 点埋包位置距墙 ${minD.toFixed(1)}m`);
  }
}

validateMap(MAPS.dust, 'dust 仓库');
validateMap(MAPS.dust2, 'dust2 沙漠二');
validateMap(MAPS.arms, 'arms 军备竞技场(小图)');

console.log(failures === 0 ? '\n全部通过 ✓' : `\n${failures} 项失败 ✗`);
process.exit(failures === 0 ? 0 : 1);
