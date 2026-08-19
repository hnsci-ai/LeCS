// public/js/ragdoll.js — 布娃娃尸体：cannon-es 物理 + 肢体约束 + 命中冲量
'use strict';
const Ragdoll = (function () {
  let world = null;
  let scene = null;
  let ragMat = null; // 所有布娃娃共用材质（碰撞接触对只需注册一次）
  const active = new Map();   // key -> ragdoll（key 唯一，同 id 可堆多具尸体）
  const hitInfo = new Map();  // playerId -> {dir, power, t}
  let lastError = null;      // 最近一次生成异常（供诊断）
  let spawnSeq = 0;
  const MAX_RAGDOLLS = 60;   // 同屏尸体上限（全模式一致，超出移除最老的）

  const COL_STATIC = 1, COL_RAG = 2;
  const geoCache = new Map();

  // 布纹噪声贴图（与生者模型布料一致，颜色由材质 color 乘出）
  let fabricTex = null;
  function getFabricTex() {
    if (fabricTex) return fabricTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 1100; i++) {
      const v = 90 + Math.random() * 140 | 0;
      g.fillStyle = `rgba(${v},${v},${v},${0.2 + Math.random() * 0.3})`;
      g.fillRect(Math.random() * 64, Math.random() * 64, 1.2, 1.2);
    }
    g.strokeStyle = 'rgba(0,0,0,0.10)';
    for (let y = 0; y < 64; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(64, y); g.stroke(); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    fabricTex = t;
    return t;
  }

  // 部件定义（相对脚底坐标，单位米）
  const PARTS = [
    { k: 'pelvis', s: [0.32, 0.2, 0.24], p: [0, 0.84, 0], m: 3 },
    { k: 'torso', s: [0.46, 0.44, 0.27], p: [0, 1.24, 0], m: 5 },
    { k: 'head', s: [0.22, 0.24, 0.22], p: [0, 1.68, 0], m: 2 },
    { k: 'armL', s: [0.13, 0.32, 0.13], p: [-0.36, 1.24, 0], m: 1.2 },
    { k: 'armR', s: [0.13, 0.32, 0.13], p: [0.36, 1.24, 0], m: 1.2 },
    { k: 'legL', s: [0.16, 0.54, 0.17], p: [-0.12, 0.5, 0], m: 2.2 },
    { k: 'legR', s: [0.16, 0.54, 0.17], p: [0.12, 0.5, 0], m: 2.2 }
  ];

  // 关节约束定义
  const JOINTS = [
    { a: 'pelvis', b: 'torso', pivotA: [0, 0.1, 0], pivotB: [0, -0.22, 0], angle: Math.PI / 2.5, twist: Math.PI / 5 },
    { a: 'torso', b: 'head', pivotA: [0, 0.22, 0], pivotB: [0, -0.12, 0], angle: Math.PI / 2.1, twist: Math.PI / 4 },
    { a: 'torso', b: 'armL', pivotA: [-0.25, 0.1, 0], pivotB: [0, 0.16, 0], angle: Math.PI / 1.7, twist: Math.PI / 2.5 },
    { a: 'torso', b: 'armR', pivotA: [0.25, 0.1, 0], pivotB: [0, 0.16, 0], angle: Math.PI / 1.7, twist: Math.PI / 2.5 },
    { a: 'pelvis', b: 'legL', pivotA: [-0.12, -0.08, 0], pivotB: [0, 0.27, 0], angle: Math.PI / 1.5, twist: Math.PI / 8 },
    { a: 'pelvis', b: 'legR', pivotA: [0.12, -0.08, 0], pivotB: [0, 0.27, 0], angle: Math.PI / 1.5, twist: Math.PI / 8 }
  ];

  const WEAPON_POWER = { awp: 13, deagle: 9, ak47: 8, m4a1: 8, mp5: 6, usp: 4, glock: 4, knife: 3, hegrenade: 14, bomb: 16 };

  function init(sceneRef) {
    scene = sceneRef;
    world = new CANNON.World();
    world.gravity.set(0, -18, 0);
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = true;
    world.solver.iterations = 10;

    const groundMat = new CANNON.Material('ground');
    ragMat = new CANNON.Material('ragdoll');
    world.addContactMaterial(new CANNON.ContactMaterial(groundMat, ragMat, { friction: 0.55, restitution: 0.22 }));

    // 地面
    const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: groundMat });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    ground.collisionFilterGroup = COL_STATIC;
    ground.collisionFilterMask = COL_STATIC | COL_RAG;
    world.addBody(ground);

    // 地图墙体（静态碰撞）
    for (const w of MAPDATA.walls) {
      const b = new CANNON.Body({
        mass: 0,
        material: groundMat,
        shape: new CANNON.Box(new CANNON.Vec3((w.x2 - w.x1) / 2, (w.y2 - w.y1) / 2, (w.z2 - w.z1) / 2))
      });
      b.position.set((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2, (w.z1 + w.z2) / 2);
      b.collisionFilterGroup = COL_STATIC;
      b.collisionFilterMask = COL_STATIC | COL_RAG;
      world.addBody(b);
    }
  }

  // 记录一次命中（子弹击中玩家）：用于死亡时的冲量方向
  function registerHit(victimId, hitPoint, startPoint, weaponId) {
    if (!victimId) return;
    const dx = hitPoint.x - startPoint.x, dy = hitPoint.y - startPoint.y, dz = hitPoint.z - startPoint.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-4) return;
    hitInfo.set(victimId, {
      dir: { x: dx / len, y: dy / len, z: dz / len },
      power: WEAPON_POWER[weaponId] || 5,
      t: performance.now()
    });
  }

  // 生成布娃娃
  function spawn(id, x, y, z, yaw, team, armor, helmet) {
    if (!world) return;
    const key = id + '#' + (++spawnSeq); // 每次死亡一具新尸体，可堆叠
    // 超过上限移除最老的
    if (active.size >= MAX_RAGDOLLS) {
      const oldest = active.keys().next().value;
      removeRagdoll(active.get(oldest));
    }

    const bodies = [], meshes = [], constraints = [], extras = [];
    try {
      const teamCol = team === GAMECONST.TEAM_T ? 0xc87f3a : 0x4f78a4;
      const dark = team === GAMECONST.TEAM_T ? 0x8a5a28 : 0x35506e;
      const clothMat = new THREE.MeshPhongMaterial({ map: getFabricTex(), color: teamCol, shininess: 12, specular: 0x2a2a2a });
      const legMat = new THREE.MeshPhongMaterial({ map: getFabricTex(), color: dark, shininess: 12, specular: 0x2a2a2a });
      const skinMat = new THREE.MeshPhongMaterial({ color: 0xd9a87c, shininess: 22, specular: 0x3a3a3a });
      const mats = [clothMat, legMat, skinMat];
      const matFor = (k) => k === 'head' ? skinMat : (k.startsWith('leg') ? legMat : clothMat);

      const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      const bodyMap = {};

      for (const def of PARTS) {
        const shape = new CANNON.Box(new CANNON.Vec3(def.s[0] / 2, def.s[1] / 2, def.s[2] / 2));
        const body = new CANNON.Body({ mass: def.m, shape, material: ragMat });
        // 位置（应用 yaw 旋转）
        const px = def.p[0] * cosY + def.p[2] * sinY;
        const pz = -def.p[0] * sinY + def.p[2] * cosY;
        body.position.set(x + px, y + def.p[1], z + pz);
        body.quaternion.setFromEuler(0, yaw, 0);
        body.linearDamping = 0.05;
        body.angularDamping = 0.18;
        body.sleepSpeedLimit = 0.4;
        body.sleepTimeLimit = 0.6;
        body.collisionFilterGroup = COL_RAG;
        body.collisionFilterMask = COL_STATIC; // 肢体之间不互撞，只与静态世界碰撞
        world.addBody(body);

        let geo = geoCache.get(def.k);
        if (!geo) {
          // 视觉部件与生者模型一致：头=球、躯干/四肢=圆柱（物理仍用盒体，判定不变）
          if (def.k === 'head') geo = new THREE.SphereGeometry(def.s[0] / 2, 12, 9);
          else if (def.k === 'torso') geo = new THREE.CylinderGeometry(def.s[0] / 2, def.s[0] / 2 * 0.9, def.s[1], 10);
          else geo = new THREE.CylinderGeometry(def.s[0] / 2, def.s[0] / 2, def.s[1], 7);
          geoCache.set(def.k, geo);
        }
        const mesh = new THREE.Mesh(geo, matFor(def.k));
        mesh.castShadow = true;
        scene.add(mesh);
        bodies.push(body); meshes.push(mesh);
        bodyMap[def.k] = body;
      }

      for (const j of JOINTS) {
        const c = new CANNON.ConeTwistConstraint(bodyMap[j.a], bodyMap[j.b], {
          pivotA: new CANNON.Vec3(...j.pivotA),
          pivotB: new CANNON.Vec3(...j.pivotB),
          axisA: new CANNON.Vec3(0, 1, 0),
          axisB: new CANNON.Vec3(0, 1, 0),
          angle: j.angle,
          twistAngle: j.twist,
          maxForce: 2e5
        });
        world.addConstraint(c);
        constraints.push(c);
      }

      // 死亡冲量：命中方向（子弹入射方向）为主，加一点向上
      const hi = hitInfo.get(id);
      let dir, power;
      if (hi && performance.now() - hi.t < 800) {
        dir = hi.dir; power = hi.power;
      } else {
        const a = Math.random() * Math.PI * 2;
        dir = { x: Math.cos(a), y: 0.15, z: Math.sin(a) };
        power = 7;
      }
      const imp = new CANNON.Vec3(dir.x * power, dir.y * power + power * 0.3, dir.z * power);
      bodyMap.torso.applyImpulse(imp);
      bodyMap.head.applyImpulse(new CANNON.Vec3(imp.x * 0.4, imp.y * 0.35, imp.z * 0.4));
      bodyMap.pelvis.applyImpulse(new CANNON.Vec3(imp.x * 0.5, imp.y * 0.4, imp.z * 0.5));
      hitInfo.delete(id);

      // 护甲外观：尸体上保留防弹衣背心/头盔（跟随躯干/头部刚体）
      if ((armor || 0) > 0 || helmet) {
        const kevlarMat = new THREE.MeshLambertMaterial({ color: 0x4a5246 });
        mats.push(kevlarMat);
        if ((armor || 0) > 0) {
          const vest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.44, 0.3), kevlarMat);
          vest.castShadow = true;
          scene.add(vest);
          extras.push({ mesh: vest, body: 1, offY: -0.02 }); // torso
        }
        if (helmet) {
          const helm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.11, 0.25), kevlarMat);
          helm.castShadow = true;
          scene.add(helm);
          extras.push({ mesh: helm, body: 2, offY: 0.15 }); // head
        }
      }

      const r = { id, key, bodies, meshes, constraints, mats, extras, born: performance.now(), fading: false, timer: null };
      active.set(key, r); // 全模式统一：尸体永久保留，无淡出、无定时清理
    } catch (e) {
      // 生成失败兜底：清理已加入场景/世界的部件，绝不留下没有清理定时器的孤儿尸体
      for (const m of meshes) scene.remove(m);
      for (const e of extras) scene.remove(e.mesh);
      for (const b of bodies) { try { world.removeBody(b); } catch (e2) { /* ignore */ } }
      for (const c of constraints) { try { world.removeConstraint(c); } catch (e2) { /* ignore */ } }
      lastError = String((e && e.message) || e);
      console.warn('[Ragdoll] 生成失败，已清理部件:', lastError);
    }
  }

  function removeFor(id) {
    // 全模式统一：复活不清理尸体（key 唯一，按 id 找不到，尸体自然保留）
    const r = active.get(id);
    if (r) removeRagdoll(r);
  }

  function removeRagdoll(r) {
    active.delete(r.key || r.id); // 用唯一 key 删除（尸体永久保留机制下 key = id#序号）
    if (r.timer) clearTimeout(r.timer);
    for (const b of r.bodies) world.removeBody(b);
    for (const c of r.constraints) world.removeConstraint(c);
    for (const m of r.meshes) scene.remove(m);
    for (const e of r.extras) scene.remove(e.mesh);
    for (const m of r.mats) m.dispose();
  }

  // 每帧推进物理并同步网格
  function update(dt) {
    if (!world || active.size === 0) return;
    world.step(1 / 60, Math.min(dt, 0.1), 3);
    const now = performance.now();
    for (const [id, r] of Array.from(active)) {
      for (let i = 0; i < r.bodies.length; i++) {
        r.meshes[i].position.copy(r.bodies[i].position);
        r.meshes[i].quaternion.copy(r.bodies[i].quaternion);
      }
      // 护甲外观跟随对应刚体
      for (const e of r.extras) {
        e.mesh.position.copy(r.bodies[e.body].position);
        e.mesh.position.y += e.offY;
        e.mesh.quaternion.copy(r.bodies[e.body].quaternion);
      }
      // 全模式统一：尸体永久保留，仅同步物理与护甲外观（无淡出、无自动清理）
    }
  }

  function clearAll() {
    for (const [id, r] of Array.from(active)) removeRagdoll(r);
  }

  // 测试辅助：活跃布娃娃数量与状态
  function _debugCount() { return active.size; }
  function _debugState() {
    const out = [];
    for (const [id, r] of active) {
      const t = r.bodies[1]; // torso
      out.push({ id, torsoY: +t.position.y.toFixed(2), sleeping: t.sleepState === 2 });
    }
    return out;
  }

  return { init, spawn, removeFor, registerHit, update, clearAll, _debugCount, _debugState, _debugExtras: () => Array.from(active.values()).map(r => r.extras.length), _debugInfo: () => ({ active: active.size, persistent: true, lastError }) };
})();
