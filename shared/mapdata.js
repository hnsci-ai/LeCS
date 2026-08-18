// shared/mapdata.js — LeCS 地图数据（UMD：Node 与浏览器共用）
// 世界坐标：Y 向上，地面 y=0。64x64 米（x,z ∈ [-32,32]）。
// 导出：MAPS = { dust, dust2 }，MAPDATA = MAPS.dust（默认，向后兼容）。
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    var m = factory();
    root.MAPS = m.MAPS;
    root.MAPDATA = m.MAPDATA;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WALL_H = 3.2; // 墙高
  var THICK = 0.5;  // 墙厚
  var NAV_CELL = 1.0;

  function isBoundaryEdge(coord, bound) { return Math.abs(Math.abs(coord) - bound) < 0.001; }

  function box(x1, y1, z1, x2, y2, z2) {
    return { x1: x1, y1: y1, z1: z1, x2: x2, y2: y2, z2: z2 };
  }

  // ---------- 箱子（可掩体，碰撞体）----------
  var CRATE_S = 1.6, CRATE_H = 1.3;
  function buildCrates(defs) {
    return defs.map(function (c) {
      var b = box(c[0] - CRATE_S / 2, 0, c[1] - CRATE_S / 2, c[0] + CRATE_S / 2, CRATE_H, c[1] + CRATE_S / 2);
      b.crate = true;
      return b;
    });
  }

  // ---------- 掩体（沙袋/油桶/水泥墩，均为碰撞体） ----------
  var COVER_SIZE = { sandbag: [2.4, 0.8], barrel: [0.8, 1.05], block: [1.5, 1.2], tall: [1.6, 2.2] }; // sandbag 可跳上站立；tall 高过人
  function buildCovers(coverDefs) {
    var covers = [];
    Object.keys(coverDefs).forEach(function (type) {
      coverDefs[type].forEach(function (c) {
        var w = COVER_SIZE[type][0], h = COVER_SIZE[type][1];
        var b = box(c[0] - w / 2, 0, c[1] - w / 2, c[0] + w / 2, h, c[1] + w / 2);
        b.cover = type;
        covers.push(b);
      });
    });
    return covers;
  }

  // ---------- 从房间生成墙体盒子（去重） ----------
  function wallsFromRooms(rooms, BOUND) {
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
        if (isBoundaryEdge(ed.fixed, BOUND)) return; // 世界边界由周长墙负责
        var opens = (r.open && r.open[ed.name]) ? r.open[ed.name].slice() : [];
        var segs = [];
        for (var i = 0; i < opens.length; i += 2) segs.push([opens[i], opens[i + 1]]);
        segs.sort(function (a, b) { return a[0] - b[0]; });
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

  // ---------- 纯几何工具（与地图无关） ----------
  function pointInBox(px, py, pz, b, ex, ey, ez) {
    ex = ex || 0; ey = ey || 0; ez = ez || 0;
    return px >= b.x1 - ex && px <= b.x2 + ex && py >= b.y1 - ey && py <= b.y2 + ey && pz >= b.z1 - ez && pz <= b.z2 + ez;
  }

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

  function makeRaycast(walls) {
    return function raycast(ox, oy, oz, dx, dy, dz, maxDist, expand) {
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
    };
  }

  // ---------- 构建一张地图 ----------
  function buildMap(def) {
    var BOUND = def.bound || 32;           // 世界半径（小地图可用更小的 bound）
    var navOrigin = -BOUND + 0.5;
    var navSize = Math.round(BOUND * 2) - 1;
    var rooms = def.rooms;
    var crates = buildCrates(def.crateDefs);
    var covers = buildCovers(def.coverDefs);
    var hostageSpots = def.hostageSpots;
    var spawns = def.spawns;
    var buyZones = def.buyZones;
    var sites = def.sites;

    var extraWalls = (def.extraWalls || []).map(function (w) {
      return { x1: w.x1, y1: w.y1 || 0, z1: w.z1, x2: w.x2, y2: w.y2 || WALL_H, z2: w.z2 };
    });
    var walls = wallsFromRooms(rooms, BOUND).concat(extraWalls).concat(crates).concat(covers);
    var raycast = makeRaycast(walls);

    function losClear(x1, y1, z1, x2, y2, z2, expand) {
      var dx = x2 - x1, dy = y2 - y1, dz = z2 - z1;
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1e-6) return true;
      return !raycast(x1, y1, z1, dx / len, dy / len, dz / len, len, expand).blocked;
    }

    // ---------- 导航网格 ----------
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
            // 导航格阻挡：高于 0.55m 的物体都算障碍（沙袋可跳上但 A* 无跳跃概念，路径绕行）
            if (cx > w.x1 - R && cx < w.x2 + R && cz > w.z1 - R && cz < w.z2 + R && 1.0 > w.y1 && w.y2 > 0.55) { walk = false; break; }
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

    function smoothPath(cells) {
      if (!cells) return null;
      var pts = cells.map(idxToPos);
      var out = [pts[0]];
      var cur = 0;
      while (cur < pts.length - 1) {
        var far = cur + 1;
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
  }

  // ================= 地图一：dust（原版仓库风格） =================
  var dustDef = {
    rooms: [
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
    ],
    crateDefs: [
      [-27, -27], [-19, -28], [-30, -20],          // A 点
      [27, 27], [19, 28], [30, 20],                // B 点
      [-6, -8], [0, 10],                           // 中路
      [-23, -4],                                   // 长道
      [-28, 28], [-24, 26],                        // T 家
      [28, -28], [24, -26],                        // CT 家
      [0, -22],                                    // CT→A 走廊
      [23, 8],                                     // CT→B 走廊
      [2, 25]                                      // 隧道
    ],
    coverDefs: {
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
    },
    hostageSpots: [
      { x: -25, z: -30 }, { x: -17, z: -22 },       // A 点
      { x: 25, z: 26 }, { x: 20, z: 19 }            // B 点
    ],
    spawns: {
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
    },
    buyZones: {
      t: { x1: -32, z1: 18, x2: -18, z2: 32 },
      ct: { x1: 20, z1: -32, x2: 32, z2: -18 }
    },
    sites: {
      a: { rect: { x1: -32, z1: -32, x2: -14, z2: -16 }, plant: { x: -23, z: -24 }, radius: 5, letter: 'A' },
      b: { rect: { x1: 14, z1: 16, x2: 32, z2: 32 }, plant: { x: 23, z: 24 }, radius: 5, letter: 'B' }
    }
  };

  // ================= 地图二：dust2（仿 de_dust2 布局） =================
  // 布局：T 家(北) / CT 家(南) / A 点(西南) / B 点(东北) / A 大道(西) / 中路(中) / B 通道(东) / 中路广场
  var dust2Def = {
    rooms: [
      { id: 'longa',   x1: -32, z1: -16, x2: -16, z2: 32,  open: { e: [-12, -8, 24, 28], s: [-28, -24] } },
      { id: 'tspawn',  x1: -16, z1: 16,  x2: 12,  z2: 32,  open: { w: [24, 28], s: [-12, -8], e: [20, 24] } },
      { id: 'bsite',   x1: 12,  z1: 16,  x2: 32,  z2: 32,  open: { w: [20, 24], s: [14, 18] } },
      { id: 'asite',   x1: -32, z1: -32, x2: -12, z2: -16, open: { n: [-28, -24], e: [-28, -24] } },
      { id: 'ctspawn', x1: -12, z1: -32, x2: 12,  z2: -16, open: { w: [-28, -24], n: [-8, -6], e: [-28, -24] } },
      { id: 'mid',     x1: -16, z1: -16, x2: -4,  z2: 16,  open: { w: [-12, -8], n: [-12, -8], s: [-8, -6], e: [-16, 16] } },
      { id: 'tuns',    x1: 12,  z1: -32, x2: 32,  z2: 16,  open: { w: [-28, -24, 4, 8], n: [14, 18] } }
    ],
    crateDefs: [
      [-27, -27], [-19, -28], [-30, -20],   // A 点
      [27, 27], [19, 28], [30, 20],         // B 点
      [-6, 0], [2, 4],                      // 中路广场
      [-24, 8], [-24, -4],                  // A 大道
      [18, -6], [27, -12],                  // B 通道
      [-13, 26],                            // T 家
      [-9, -25], [6, -28]                   // CT 家
    ],
    coverDefs: {
      sandbag: [
        [-29, -19], [-17, -20],             // A 点
        [26, 18], [15, 19],                 // B 点
        [-22, 8],                           // A 大道
        [0, -2], [-2, 10],                  // 中路广场
        [18, 4], [26, 12],                  // B 通道
        [0, -18], [0, 18]                   // CT/T 出口
      ],
      barrel: [
        [-17, -20.6],                       // A 点
        [30, 24],                           // B 点
        [-19, 2],                           // A 大道
        [6, -12],                           // 中路广场
        [25, -12],                          // B 通道
        [-8, 26],                           // T 家
        [22, -24], [14, -24],               // CT→B
        [-26, 21]                           // A 大道北段
      ],
      block: [
        [-31, -25],                         // A 点
        [17, 30],                           // B 点
        [-12, 12],                          // 中路
        [20, 6]                             // B 通道
      ]
    },
    hostageSpots: [
      { x: -29, z: -29 }, { x: -20, z: -26 },   // A 点
      { x: 24, z: 30 }, { x: 22, z: 30 }        // B 点
    ],
    spawns: {
      t: [
        { x: -10, z: 28, yaw: 0.4 }, { x: -6, z: 28, yaw: 0.4 },
        { x: -2, z: 28, yaw: -0.4 }, { x: 2, z: 26, yaw: -0.4 },
        { x: 6, z: 28, yaw: 0.1 }
      ],
      ct: [
        { x: -8, z: -28, yaw: Math.PI - 0.4 }, { x: -4, z: -28, yaw: Math.PI - 0.4 },
        { x: 0, z: -28, yaw: Math.PI + 0.4 }, { x: 4, z: -26, yaw: Math.PI + 0.4 },
        { x: 8, z: -28, yaw: Math.PI - 0.1 }
      ]
    },
    buyZones: {
      t: { x1: -16, z1: 16, x2: 12, z2: 32 },
      ct: { x1: -12, z1: -32, x2: 12, z2: -16 }
    },
    sites: {
      a: { rect: { x1: -32, z1: -32, x2: -12, z2: -16 }, plant: { x: -22, z: -24 }, radius: 5, letter: 'A' },
      b: { rect: { x1: 12, z1: 16, x2: 32, z2: 32 }, plant: { x: 22, z: 24 }, radius: 5, letter: 'B' }
    }
  };

  // ================= 地图三：arms（军备竞赛专用小图） =================
  // 32×32 紧凑竞技场：四边房间 + 中央广场；中线高墙隔断，双方出生点互不可见，绕两侧房进出
  var armsDef = {
    bound: 16,
    rooms: [
      // 注意生成器约定：n 边 = z1，s 边 = z2（朝向广场的边要开在这里）
      { id: 'north', x1: -10, z1: 8,  x2: 10, z2: 16, open: { n: [-10, 10] } },
      { id: 'south', x1: -10, z1: -16, x2: 10, z2: -8, open: { s: [-10, 10] } },
      { id: 'west',  x1: -16, z1: -8,  x2: -10, z2: 8,  open: { e: [-8, 8] } },
      { id: 'east',  x1: 10,  z1: -8,  x2: 16,  z2: 8,  open: { w: [-8, 8] } }
    ],
    // 中线高墙：横贯广场（z=0，高 3.2m），出生点直线互不可见，只能绕西/东侧房
    extraWalls: [
      { x1: -10, z1: -0.25, x2: 10, z2: 0.25, y2: 3.2 }
    ],
    crateDefs: [
      [-6, 11], [6, 11],            // 北侧
      [-7, -10], [7, -10],          // 南侧
      [-13, -4], [-13, 4],          // 西侧
      [13, -4], [13, 4]             // 东侧
    ],
    coverDefs: {
      sandbag: [[-6, -3], [6, -3], [-6, 3], [6, 3], [0, 9], [0, -9]],  // 沙袋 0.8m，可跳上
      barrel: [[-2, -4], [2, -4], [-2, 4], [2, 4], [-14, 6], [14, 6]],
      block: [[-6, -6], [6, 6]],
      tall: [[-4, 3], [4, 3], [-4, -3], [4, -3]]                       // 高过人掩体（2.2m）
    },
    hostageSpots: [
      { x: -15, z: 2 }, { x: -14, z: -2 }, { x: 14, z: 2 }, { x: 15, z: -2 }
    ],
    spawns: {
      t: [
        { x: -6, z: 13, yaw: 0 }, { x: 0, z: 13, yaw: 0 },
        { x: 6, z: 13, yaw: 0 }, { x: -2, z: 12, yaw: 0.2 }, { x: 2, z: 12, yaw: -0.2 }
      ],
      ct: [
        { x: -6, z: -13, yaw: Math.PI }, { x: 0, z: -13, yaw: Math.PI },
        { x: 6, z: -13, yaw: Math.PI }, { x: -2, z: -12, yaw: Math.PI - 0.2 }, { x: 2, z: -12, yaw: Math.PI + 0.2 }
      ]
    },
    buyZones: {
      t: { x1: -10, z1: 8, x2: 10, z2: 16 },
      ct: { x1: -10, z1: -16, x2: 10, z2: -8 }
    },
    sites: {
      a: { rect: { x1: -16, z1: -8, x2: -10, z2: 8 }, plant: { x: -13, z: 0 }, radius: 4, letter: 'A' },
      b: { rect: { x1: 10, z1: -8, x2: 16, z2: 8 }, plant: { x: 13, z: 0 }, radius: 4, letter: 'B' }
    }
  };

  // ================= 地图四：test（测试靶场：空旷小场地、无掩体） =================
  var testDef = {
    bound: 14,
    rooms: [
      { id: 'field', x1: -14, z1: -14, x2: 14, z2: 14, open: {} }
    ],
    crateDefs: [],
    coverDefs: {},
    hostageSpots: [
      { x: 0, z: 0 }, { x: 5, z: 5 }, { x: -5, z: 5 }, { x: 5, z: -5 }
    ],
    spawns: {
      t: [
        { x: -10, z: 10, yaw: 0 }, { x: -5, z: 10, yaw: 0 },
        { x: 0, z: 10, yaw: 0 }, { x: 5, z: 10, yaw: 0 }, { x: 10, z: 10, yaw: 0 }
      ],
      ct: [
        { x: -10, z: -10, yaw: Math.PI }, { x: -5, z: -10, yaw: Math.PI },
        { x: 0, z: -10, yaw: Math.PI }, { x: 5, z: -10, yaw: Math.PI }, { x: 10, z: -10, yaw: Math.PI }
      ]
    },
    buyZones: {
      t: { x1: -14, z1: -14, x2: 14, z2: 14 },
      ct: { x1: -14, z1: -14, x2: 14, z2: 14 }
    },
    sites: {
      a: { rect: { x1: -4, z1: -4, x2: 4, z2: 4 }, plant: { x: 0, z: 0 }, radius: 4, letter: 'A' },
      b: { rect: { x1: 8, z1: 8, x2: 14, z2: 14 }, plant: { x: 11, z: 11 }, radius: 4, letter: 'B' }
    }
  };

  var MAPS = {
    dust: buildMap(dustDef),
    dust2: buildMap(dust2Def),
    arms: buildMap(armsDef),
    test: buildMap(testDef)
  };

  return { MAPS: MAPS, MAPDATA: MAPS.dust };
});
