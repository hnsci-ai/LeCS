// public/js/ragdoll.js — 布娃娃尸体：cannon-es 物理 + 肢体约束 + 命中冲量
'use strict';
const Ragdoll = (function () {
  let world = null;
  let scene = null;
  let ragMat = null; // 所有布娃娃共用材质（碰撞接触对只需注册一次）
  const active = new Map();   // playerId -> ragdoll
  const hitInfo = new Map();  // playerId -> {dir, power, t}
  const MAX_RAGDOLLS = 4;   // 同屏尸体上限

  const COL_STATIC = 1, COL_RAG = 2;
  const geoCache = new Map();

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
    if (active.has(id)) return;
    // 超过上限移除最老的
    if (active.size >= MAX_RAGDOLLS) {
      const oldest = active.keys().next().value;
      removeRagdoll(active.get(oldest));
    }

    const teamCol = team === GAMECONST.TEAM_T ? 0xc87f3a : 0x4f78a4;
    const dark = team === GAMECONST.TEAM_T ? 0x8a5a28 : 0x35506e;
    const clothMat = new THREE.MeshLambertMaterial({ color: teamCol });
    const legMat = new THREE.MeshLambertMaterial({ color: dark });
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xd9a87c });
    const matFor = (k) => k === 'head' ? skinMat : (k.startsWith('leg') ? legMat : clothMat);

    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const bodies = [], meshes = [], constraints = [], mats = [clothMat, legMat, skinMat];
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
      if (!geo) { geo = new THREE.BoxGeometry(def.s[0], def.s[1], def.s[2]); geoCache.set(def.k, geo); }
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
    const extras = [];
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

    const r = { id, bodies, meshes, constraints, mats, extras, born: performance.now(), fading: false };
    active.set(id, r);
  }

  function removeFor(id) {
    const r = active.get(id);
    if (r) removeRagdoll(r);
  }

  function removeRagdoll(r) {
    active.delete(r.id);
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
      const age = now - r.born;
      // 硬性兜底：超过 5 秒无条件移除
      if (age > 5000) { removeRagdoll(r); continue; }
      if (age > 1200) {
        // 1.2 秒后开始下沉淡出（约 2 秒完全消失）
        if (!r.fading) {
          r.fading = true;
          for (const m of r.mats) m.transparent = true;
        }
        const op = Math.max(0, 1 - (age - 1200) / 800);
        for (const m of r.mats) m.opacity = op;
        if (r.fading) {
          for (let i = 0; i < r.meshes.length; i++) {
            r.meshes[i].position.y -= (1 - op) * 0.06; // 下沉
          }
          for (const e of r.extras) e.mesh.position.y -= (1 - op) * 0.06;
        }
        if (op <= 0) removeRagdoll(r);
      }
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

  return { init, spawn, removeFor, registerHit, update, clearAll, _debugCount, _debugState, _debugExtras: () => Array.from(active.values()).map(r => r.extras.length) };
})();
