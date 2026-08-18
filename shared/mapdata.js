// shared/mapdata.js — LeCS 地图数据（UMD：Node 与浏览器共用）
// 世界坐标：Y 向上，地面 y=0。64x64 米（x,z ∈ [-32,32]），dust2 风格布局。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MAPDATA = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WALL_H = 3.2; // 墙高
  var THICK = 0.5;  // 墙厚
  var BOUND = 32;   // 世界半径

  // ---------- 房间（矩形）定义：仅用于生成墙体与游戏区域，不直接渲染 ----------
  // 房间: { id, x1, z1, x2, z2, open: {n:[a,b], s:[a,b], e:[a,b], w:[a,b]} }
  // open 表示该边上的开口区间（沿边的局部坐标，单位米）
  var rooms = [
    { id: 'tspawn',  x1: -32, z1: 18, x2: -18, z2: 32, open: { n: [-26, -22], e: [18, 20, 24, 28] } },
    { id: 'longa',   x1: -28, z1: -16, x2: -18, z2: 18, open: { n: [-26, -22], s: [-26, -22] } },
    { id: 'asite',   x1: -32, z1: -32, x2: -14, z2: -16, open: { s: [-26, -22], e: [-23, -19] } },
    { id: 'ctspawna',x1: -14, z1: -24, x2: 20, z2: -18, open: { w: [-23, -19], e: [-23, -19], s: [6, 10] } },
    { id: 'midct',   x1: 4, z1: -18, x2: 12, z2: 14, open: { w: [-2, 1], n: [6, 10] } },
    { id: 'mid',     x1: -18, z1: -18, x2: 4, z2: 20, open: { w: [18, 20], e: [-2, 1] } },
    { id: 'ctspawn', x1: 20, z1: -32, x2: 32, z2: -18, open: { w: [-23, -19], s: [21, 25] } },
    { id: 'ctb',     x1: 20, z1: -18, x2: 26, z2: 16, open: { s: [21, 25], n: [21, 25] } },
    { id: 'bsite',   x1: 14, z1: 16, x2: 32, z2: 32, open: { w: [24, 28], n: [21, 25] } },
    { id: 'tunnel',  x1: -18, z1: 22, x2: 14, z2: 28, open: { w: [24, 28], e: [24, 28] } }
  ];

  function isBoundaryEdge(coord) { return Math.abs(Math.abs(coord) - BOUND) < 0.001; }

  function box(x1, y1, z1, x2, y2, z2) {
    return { x1: x1, y1: y1, z1: z1, x2: x2, y2: y2, z2: z2 };
  }

  // 从房间生成墙体盒子（去重）
  function wallsFromRooms() {
    var walls = [];
    var seen = {};
    function add(w) {
      var key = [w.x1, w.y1, w.z1, w.x2, w.y2, w.z2].map(function (v) { return v.toFixed(2); }).join('|');
      if (seen[key]) return;
      seen[key] = 1;
      walls.push(w);
    }
    rooms.forEach(function (r) {
      // 四条边: n(z1) s(z2) w(x1) e(x2)
      var edges = [
        { c1: r.x1, c2: r.x2, fixed: r.z1, axis: 'z', name: 'n' },
        { c1: r.x1, c2: r.x2, fixed: r.z2, axis: 'z', name: 's' },
        { c1: r.z1, c2: r.z2, fixed: r.x1, axis: 'x', name: 'w' },
        { c1: r.z1, c2: r.z2, fixed: r.x2, axis: 'x', name: 'e' }
      ];
      edges.forEach(function (ed) {
        if (isBoundaryEdge(ed.fixed)) return; // 世界边界由周长墙负责
        var opens = (r.open && r.open[ed.name]) ? r.open[ed.name].slice() : [];
        // 开口区间合并排序
        var segs = [];
        for (var i = 0; i < opens.length; i += 2) segs.push([opens[i], opens[i + 1]]);
        segs.sort(function (a, b) { return a[0] - b[0]; });
        // 按开口切分
        var span = [[ed.c1, ed.c2]];
        segs.forEach(function (o) {
          var next = [];
          span.forEach(function (s) {
            if (o[0] <= s[0] && o[1] >= s[1]) return; // 整段开口
            if (o[0] > s[1] || o[1] < s[0]) { next.push(s); return; }
            if (o[0] > s[0]) next.push([s[0], o[0]]);
            if (o[1] < s[1]) next.push([o[1], s[1]]);
          });
          span = next;
        });
        span.forEach(function (s) {
          var len = s[1] - s[0];
          if (len <= 0.01) return;
          // axis 'z'：墙沿 z 固定（南北墙，x 跨度）；axis 'x'：墙沿 x 固定（东西墙，z 跨度）
          if (ed.axis === 'z') add(box(s[0], 0, ed.fixed - THICK / 2, s[1], WALL_H, ed.fixed + THICK / 2));
          else add(box(ed.fixed - THICK / 2, 0, s[0], ed.fixed + THICK / 2, WALL_H, s[1]));
        });
      });
    });
    // 世界周长
    var B = BOUND, T = 0.5;
    add(box(-B - 1, 0, -B - 1, B + 1, 4, -B)); // 南
    add(box(-B - 1, 0, B, B + 1, 4, B + 1));   // 北
    add(box(-B - 1, 0, -B, -B, 4, B));         // 西
    add(box(B, 0, -B, B + 1, 4, B));           // 东
    return walls;
  }

  // ---------- 箱子（可掩体，碰撞体） ----------
  var crateDefs = [
    [-27, -27], [-19, -28], [-30, -20],          // A 点
    [27, 27], [19, 28], [30, 20],                // B 点
    [-6, -8], [0, 10],                           // 中路
    [-23, -4],                                   // 长道
    [-28, 28], [-24, 26],                        // T 家
    [28, -28], [24, -26],                        // CT 家
    [0, -22],                                    // CT→A 走廊
    [23, 8],                                     // CT→B 走廊
    [2, 25]                                      // 隧道
  ];
  var CRATE_S = 1.6, CRATE_H = 1.3;
  var crates = crateDefs.map(function (c) {
    var b = box(c[0] - CRATE_S / 2, 0, c[1] - CRATE_S / 2, c[0] + CRATE_S / 2, CRATE_H, c[1] + CRATE_S / 2);
    b.crate = true;
    return b;
  });

  // ---------- 新增掩体（沙袋/油桶/水泥墩，均为碰撞体） ----------
  // 尺寸：sandbag 2.4×0.9（低矮可蹲射）、barrel 0.8×1.05、block 1.5×1.2
  var coverDefs = {
    sandbag: [
      [-29, -19], [-17, -20],                     // A 点
      [26, 18], [15, 19],                         // B 点
      [-22, -10],                                 // 长道
      [-14, -2], [-2, 16],                        // 中路
      [-6, -22], [16, -21],                       // CT→A 走廊
      [8, 23],                                    // 隧道
      [23, 0]                                     // CT→B 走廊
    ],
    barrel: [
      [-17, -20.6],                               // A 点（箱旁）
      [30, 24],                                   // B 点
      [-19, 2],                                   // 长道
      [0, -12],                                   // 中路
      [25, -12],                                  // CT→B 走廊
      [-8, 26],                                   // 隧道
      [-26, 21],                                  // T 家
      [22, -24]                                   // CT 家
    ],
    block: [
      [-31, -25],                                 // A 点
      [17, 30],                                   // B 点
      [-12, 12],                                  // 中路
      [20, 6]                                     // CT→B 走廊
    ]
  };
  var COVER_SIZE = { sandbag: [2.4, 0.9], barrel: [0.8, 1.05], block: [1.5, 1.2] };
  var covers = [];
  Object.keys(coverDefs).forEach(function (type) {
    coverDefs[type].forEach(function (c) {
      var w = COVER_SIZE[type][0], h = COVER_SIZE[type][1];
      var b = box(c[0] - w / 2, 0, c[1] - w / 2, c[0] + w / 2, h, c[1] + w / 2);
      b.cover = type;
      covers.push(b);
    });
  });

  // ---------- 人质营救模式：人质刷新点（可行走、不在掩体内） ----------
  var hostageSpots = [
    { x: -25, z: -30 }, { x: -17, z: -22 },       // A 点
    { x: 25, z: 26 }, { x: 20, z: 19 }            // B 点
  ];

  var walls = wallsFromRooms().concat(crates).concat(covers);

  // ---------- 出生点 ----------
  var spawns = {
    t: [
      { x: -30, z: 30, yaw: 0.6 }, { x: -30, z: 24, yaw: 0.6 },
      { x: -24, z: 30, yaw: -0.4 }, { x: -28, z: 22, yaw: -0.4 },
      { x: -20, z: 26, yaw: 0.1 }
    ],
    ct: [
      { x: 30, z: -30, yaw: Math.PI - 0.6 }, { x: 30, z: -24, yaw: Math.PI - 0.6 },
      { x: 24, z: -30, yaw: Math.PI + 0.4 }, { x: 24, z: -24, yaw: Math.PI + 0.4 },
      { x: 23, z: -22, yaw: Math.PI - 0.1 }
    ]
  };

  var buyZones = {
    t: { x1: -32, z1: 18, x2: -18, z2: 32 },
    ct: { x1: 20, z1: -32, x2: 32, z2: -18 }
  };

  var sites = {
    a: { rect: { x1: -32, z1: -32, x2: -14, z2: -16 }, plant: { x: -23, z: -24 }, radius: 5, letter: 'A' },
    b: { rect: { x1: 14, z1: 16, x2: 32, z2: 32 }, plant: { x: 23, z: 24 }, radius: 5, letter: 'B' }
  };

  // ---------- 几何工具 ----------
  function pointInBox(px, py, pz, b, ex, ey, ez) {
    ex = ex || 0; ey = ey || 0; ez = ez || 0;
    return px >= b.x1 - ex && px <= b.x2 + ex && py >= b.y1 - ey && py <= b.y2 + ey && pz >= b.z1 - ez && pz <= b.z2 + ez;
  }

  // 线段 (x1,y1,z1)->(x2,y2,z2) 与 AABB 相交，返回最近交点距离（或 -1）
  function segBox(ox, oy, oz, dx, dy, dz, b) {
    var tmin = 0, tmax = 1e9;
    var p = [ox, oy, oz], d = [dx, dy, dz];
    var mn = [b.x1, b.y1, b.z1], mx = [b.x2, b.y2, b.z2];
    for (var i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
        if (p[i] < mn[i] || p[i] > mx[i]) return -1;
      } else {
        var t1 = (mn[i] - p[i]) / d[i], t2 = (mx[i] - p[i]) / d[i];
        if (t1 > t2) { var tmp = t1; t1 = t2; t2 = tmp; }
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return -1;
      }
    }
    if (tmax < 0) return -1;
    return tmin;
  }

  // 视线检测：射线与墙体（含箱子）相交。返回 {blocked, dist, wallHits}
  function raycast(ox, oy, oz, dx, dy, dz, maxDist, expand) {
    expand = expand === undefined ? 0 : expand;
    var best = -1, hits = 0, hitBox = null;
    for (var i = 0; i < walls.length; i++) {
      var t = segBox(ox, oy, oz, dx, dy, dz, {
        x1: walls[i].x1 - expand, y1: walls[i].y1 - expand, z1: walls[i].z1 - expand,
        x2: walls[i].x2 + expand, y2: walls[i].y2 + expand, z2: walls[i].z2 + expand
      });
      if (t >= 0 && t <= maxDist) {
        hits++;
        if (best < 0 || t < best) { best = t; hitBox = walls[i]; }
      }
    }
    return { blocked: best >= 0, dist: best, hits: hits, box: hitBox };
  }

  function losClear(x1, y1, z1, x2, y2, z2, expand) {
    var dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return true;
    return !raycast(x1, y1, z1, dx / len, dy / len, dz / len, len, expand).blocked;
  }

  // ---------- 导航网格 ----------
  var NAV_CELL = 1.0;
  var navOrigin = -31.5, navSize = 63;

  function cellIndex(cx, cz) {
    var i = Math.round((cx - navOrigin) / NAV_CELL), j = Math.round((cz - navOrigin) / NAV_CELL);
    if (i < 0 || i >= navSize || j < 0 || j >= navSize) return -1;
    return j * navSize + i;
  }

  function buildNav() {
    var n = navSize * navSize;
    var grid = new Uint8Array(n);
    var R = 0.45; // 玩家半径 + 余量
    for (var j = 0; j < navSize; j++) {
      for (var i = 0; i < navSize; i++) {
        var cx = navOrigin + (i + 0.5) * NAV_CELL, cz = navOrigin + (j + 0.5) * NAV_CELL;
        var walk = true;
        for (var k = 0; k < walls.length; k++) {
          var w = walls[k];
          if (cx > w.x1 - R && cx < w.x2 + R && cz > w.z1 - R && cz < w.z2 + R && 1.0 > w.y1 && 1.0 < w.y2 + 0.2) { walk = false; break; }
        }
        grid[j * navSize + i] = walk ? 1 : 0;
      }
    }
    return grid;
  }

  var nav = { grid: buildNav(), size: navSize, origin: navOrigin, cell: NAV_CELL };

  function navNeighbors(idx) {
    var j = Math.floor(idx / navSize), i = idx - j * navSize;
    var out = [];
    function push(ni, nj, cost, needA, needB) {
      if (ni < 0 || nj < 0 || ni >= navSize || nj >= navSize) return;
      var n = nj * navSize + ni;
      if (!nav.grid[n] || !nav.grid[needA] || !nav.grid[needB]) return;
      out.push([n, cost]);
    }
    if (i > 0) push(i - 1, j, 1, idx, idx);
    if (i < navSize - 1) push(i + 1, j, 1, idx, idx);
    if (j > 0) push(i, j - 1, 1, idx, idx);
    if (j < navSize - 1) push(i, j + 1, 1, idx, idx);
    var D = 1.4142;
    if (i > 0 && j > 0) push(i - 1, j - 1, D, j * navSize + (i - 1), (j - 1) * navSize + i);
    if (i < navSize - 1 && j > 0) push(i + 1, j - 1, D, j * navSize + (i + 1), (j - 1) * navSize + i);
    if (i > 0 && j < navSize - 1) push(i - 1, j + 1, D, j * navSize + (i - 1), (j + 1) * navSize + i);
    if (i < navSize - 1 && j < navSize - 1) push(i + 1, j + 1, D, j * navSize + (i + 1), (j + 1) * navSize + i);
    return out;
  }

  // 就近吸附到可行走格（用于 A* 起终点在箱子/墙边的情况）
  function snapWalkable(x, z) {
    var ci = cellIndex(x, z);
    if (ci >= 0 && nav.grid[ci]) return { x: x, z: z };
    var best = null, bestD = 25;
    for (var dj = -2; dj <= 2; dj++) for (var di = -2; di <= 2; di++) {
      var nx = x + di, nz = z + dj;
      var ni = cellIndex(nx, nz);
      if (ni >= 0 && nav.grid[ni]) {
        var d = di * di + dj * dj;
        if (d < bestD) { bestD = d; best = { x: nx, z: nz }; }
      }
    }
    return best;
  }

  // A*：返回网格路径（索引数组）或 null
  function findPath(sx, sz, tx, tz) {
    var sSnap = snapWalkable(sx, sz), tSnap = snapWalkable(tx, tz);
    if (!sSnap || !tSnap) return null;
    var s = cellIndex(sSnap.x, sSnap.z), t = cellIndex(tSnap.x, tSnap.z);
    if (s < 0 || t < 0 || !nav.grid[s] || !nav.grid[t]) return null;
    var open = [s], g = new Float64Array(navSize * navSize).fill(Infinity), came = new Int32Array(navSize * navSize).fill(-1);
    var closed = new Uint8Array(navSize * navSize);
    g[s] = 0;
    function h(idx) {
      var j = Math.floor(idx / navSize), i = idx - j * navSize;
      var dx = (navOrigin + (i + 0.5) * NAV_CELL) - tx, dz = (navOrigin + (j + 0.5) * NAV_CELL) - tz;
      return Math.sqrt(dx * dx + dz * dz);
    }
    var f = function (idx) { return g[idx] + h(idx) * 1.001; };
    var guard = 0;
    while (open.length && guard++ < 200000) {
      // 取 f 最小
      var bi = 0;
      for (var i = 1; i < open.length; i++) if (f(open[i]) < f(open[bi])) bi = i;
      var cur = open.splice(bi, 1)[0];
      if (cur === t) {
        var path = [cur];
        while (came[cur] >= 0) { cur = came[cur]; path.push(cur); }
        path.reverse();
        return path;
      }
      if (closed[cur]) continue;
      closed[cur] = 1;
      var nbs = navNeighbors(cur);
      for (var k = 0; k < nbs.length; k++) {
        var n = nbs[k][0], ng = g[cur] + nbs[k][1];
        if (closed[n] || ng >= g[n]) continue;
        g[n] = ng; came[n] = cur;
        open.push(n);
      }
    }
    return null;
  }

  function idxToPos(idx) {
    var j = Math.floor(idx / navSize), i = idx - j * navSize;
    return { x: navOrigin + (i + 0.5) * NAV_CELL, z: navOrigin + (j + 0.5) * NAV_CELL };
  }

  // 平滑路径（视线捷径）
  function smoothPath(cells) {
    if (!cells) return null;
    var pts = cells.map(idxToPos);
    var out = [pts[0]];
    var cur = 0;
    while (cur < pts.length - 1) {
      var far = cur + 1, best = cur + 1;
      for (var k = cur + 1; k < pts.length; k++) {
        if (losClear(pts[cur].x, 1.0, pts[cur].z, pts[k].x, 1.0, pts[k].z, 0.35)) far = k;
      }
      if (far === cur) far = cur + 1;
      out.push(pts[far]);
      cur = far;
      if (out.length > 200) break;
    }
    return out;
  }

  function findPathSmooth(sx, sz, tx, tz) {
    return smoothPath(findPath(sx, sz, tx, tz));
  }

  return {
    bounds: { min: -BOUND, max: BOUND },
    wallHeight: WALL_H,
    rooms: rooms,
    walls: walls,
    crates: crates,
    covers: covers,
    hostageSpots: hostageSpots,
    spawns: spawns,
    buyZones: buyZones,
    sites: sites,
    nav: nav,
    findPath: findPath,
    findPathSmooth: findPathSmooth,
    losClear: losClear,
    raycast: raycast,
    segBox: segBox,
    pointInBox: pointInBox,
    cellIndex: cellIndex,
    idxToPos: idxToPos
  };
});
