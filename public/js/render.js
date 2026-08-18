// public/js/render.js — Three.js 场景：地图、玩家模型、特效、相机
'use strict';
const Render = (function () {
  let renderer, scene, camera, sun;
  let wallMesh, crateMesh, ground;
  const playerMeshes = new Map();
  const tracerPool = [];    // 曳光弹
  const flashPool = [];     // 点光源
  const muzzlePool = [];    // 其他玩家枪口火光
  const burstPool = [];     // 粒子爆发（火花/血雾/烟尘）
  const decalPool = [];     // 弹痕/血泊贴花
  const shellPool = [];     // 弹壳
  const fireballPool = [];  // 爆炸火球
  const ringPool = [];      // 爆炸冲击环
  let shakeT = 0;
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q1 = new THREE.Quaternion();

  // ---------- 程序化贴图 ----------
  function makeCanvas(w, h, fn) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    fn(c.getContext('2d'), w, h);
    return c;
  }

  function sandTexture() {
    const c = makeCanvas(256, 256, (g, w, h) => {
      g.fillStyle = '#c8b184'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 4200; i++) {
        const v = 120 + Math.random() * 80 | 0;
        g.fillStyle = `rgba(${v},${v * 0.88 | 0},${v * 0.62 | 0},${0.25 + Math.random() * 0.3})`;
        g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
      }
      for (let i = 0; i < 60; i++) {
        g.fillStyle = 'rgba(90,70,40,0.25)';
        g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 4, 1.5);
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function wallTexture() {
    const c = makeCanvas(256, 128, (g, w, h) => {
      g.fillStyle = '#d3b98a'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 9) {
        g.fillStyle = 'rgba(120,92,58,0.16)';
        g.fillRect(0, y, w, 2);
      }
      for (let i = 0; i < 2600; i++) {
        const v = 150 + Math.random() * 90 | 0;
        g.fillStyle = `rgba(${v},${v * 0.86 | 0},${v * 0.6 | 0},0.3)`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
      g.fillStyle = 'rgba(70,52,30,0.5)';
      g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4);
    });
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function crateTexture() {
    const c = makeCanvas(128, 128, (g, w, h) => {
      g.fillStyle = '#8a6a3f'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 32) {
        g.fillStyle = 'rgba(50,34,16,0.5)';
        g.fillRect(0, y, w, 2);
      }
      for (let i = 0; i < 500; i++) {
        g.fillStyle = `rgba(${40 + Math.random() * 60 | 0},${30 + Math.random() * 40 | 0},15,0.25)`;
        g.fillRect(Math.random() * w, Math.random() * h, 3, 1.4);
      }
      g.strokeStyle = 'rgba(35,22,10,0.8)'; g.lineWidth = 5; g.strokeRect(2, 2, w - 4, h - 4);
      g.strokeStyle = 'rgba(35,22,10,0.5)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function siteTexture(letter, color) {
    const c = makeCanvas(256, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(40,28,12,0.55)'; g.lineWidth = 10;
      g.beginPath(); g.arc(w / 2, h / 2, 105, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = color; g.lineWidth = 26;
      g.beginPath(); g.arc(w / 2, h / 2, 96, 0, Math.PI * 2); g.stroke();
      g.fillStyle = color;
      g.font = 'bold 150px Arial';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(letter, w / 2, h / 2 + 6);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function gunMetalTexture() {
    const c = makeCanvas(64, 64, (g, w, h) => {
      g.fillStyle = '#31363d'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 500; i++) {
        const v = 30 + Math.random() * 40 | 0;
        g.fillStyle = `rgba(${v},${v + 4},${v + 8},${0.12 + Math.random() * 0.2})`;
        g.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
      }
      for (let i = 0; i < 14; i++) {
        g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(Math.random() * w, Math.random() * h); g.lineTo(Math.random() * w, Math.random() * h); g.stroke();
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function gunWoodTexture() {
    const c = makeCanvas(64, 64, (g, w, h) => {
      g.fillStyle = '#6e4a2c'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 5) {
        g.fillStyle = `rgba(50,30,12,${0.12 + Math.random() * 0.2})`;
        g.fillRect(0, y, w, 1.6);
      }
      for (let i = 0; i < 240; i++) {
        g.fillStyle = 'rgba(255,220,160,0.05)';
        g.fillRect(Math.random() * w, Math.random() * h, 1.2, 1.2);
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // 枪口火光星芒贴图（canvas 生成）
  function muzzleFlashTexture() {
    const c = makeCanvas(128, 128, (g, w, h) => {
      g.translate(64, 64);
      const spike = (len, wd, color) => {
        g.fillStyle = color;
        for (let i = 0; i < 4; i++) {
          g.rotate(Math.PI / 2);
          g.beginPath();
          g.moveTo(0, 0);
          g.lineTo(-wd, len * 0.22);
          g.lineTo(0, len);
          g.lineTo(wd, len * 0.22);
          g.closePath();
          g.fill();
        }
      };
      spike(62, 9, 'rgba(255,190,90,0.95)');
      g.rotate(Math.PI / 4);
      spike(36, 6, 'rgba(255,235,180,0.95)');
      g.rotate(-Math.PI / 4);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, 28);
      grad.addColorStop(0, 'rgba(255,255,245,1)');
      grad.addColorStop(0.45, 'rgba(255,215,130,0.95)');
      grad.addColorStop(1, 'rgba(255,150,50,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(0, 0, 28, 0, Math.PI * 2); g.fill();
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ---------- 初始化 ----------
  function init(canvas) {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // 高 DPI 屏限制填充率，减少卡顿
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap; // 比 PCFSoft 快很多，视觉差异小
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.32;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9ec8e2);
    scene.fog = new THREE.Fog(0xa9c9d8, 55, 170);

    camera = new THREE.PerspectiveCamera(75, 1, 0.05, 400);
    camera.rotation.order = 'YXZ';
    scene.add(camera);

    // 天空穹顶（渐变）与太阳光晕
    const skyTex = new THREE.CanvasTexture(makeCanvas(512, 256, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#4f8fcf');
      grad.addColorStop(0.45, '#8fc3e6');
      grad.addColorStop(0.62, '#cfe0e8');
      grad.addColorStop(1, '#e6d9ba');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }));
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(210, 20, 14),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false })
    );
    sky.renderOrder = -10;
    scene.add(sky);
    const sunGlow = new THREE.CanvasTexture(makeCanvas(128, 128, (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(255,252,235,1)');
      grad.addColorStop(0.25, 'rgba(255,240,190,0.85)');
      grad.addColorStop(0.6, 'rgba(255,220,150,0.25)');
      grad.addColorStop(1, 'rgba(255,220,150,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    }));
    sunGlow.colorSpace = THREE.SRGBColorSpace;
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunGlow, transparent: true, depthWrite: false, fog: false }));
    sunSprite.position.set(120, 140, -90);
    sunSprite.scale.set(60, 60, 1);
    scene.add(sunSprite);

    // 灯光
    const hemi = new THREE.HemisphereLight(0xd7eaf5, 0xa08f70, 1.2);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff4d8, 2.9);
    sun.position.set(38, 55, -30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); // 2048→1024：阴影渲染像素减到 1/4
    sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50;
    sun.shadow.camera.far = 160;
    sun.shadow.bias = -0.0006;
    scene.add(sun);

    buildMap();
    buildPools();
    initSmoke();
    Ragdoll.init(scene);
    window.addEventListener('resize', onResize);
    onResize();
  }

  function buildMap() {
    const sand = sandTexture();
    const groundSize = MAPDATA.bounds.max * 2 + 10; // 小地图自动缩小地面
    sand.repeat.set(groundSize / 3.4, groundSize / 3.4);
    ground = new THREE.Mesh(
      new THREE.PlaneGeometry(groundSize, groundSize),
      new THREE.MeshLambertMaterial({ map: sand })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, 0);
    ground.receiveShadow = true;
    scene.add(ground);

    // 墙体
    const wTex = wallTexture();
    const wMat = new THREE.MeshLambertMaterial({ map: wTex });
    const plainWalls = MAPDATA.walls.filter(w => !w.crate && !w.cover);
    wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), wMat, plainWalls.length);
    const m4 = new THREE.Matrix4();
    const wc = new THREE.Color();
    plainWalls.forEach((w, i) => {
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1, dz = w.z2 - w.z1;
      m4.makeScale(dx, dy, dz);
      m4.setPosition((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2, (w.z1 + w.z2) / 2);
      wallMesh.setMatrixAt(i, m4);
      const isCrate = dy < 2;
      wallMesh.setColorAt(i, wc.setHSL(isCrate ? 0.08 : 0.11, 0.28, 0.5 + Math.random() * 0.08));
    });
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    scene.add(wallMesh);

    // 箱子（木质实例）
    const cTex = crateTexture();
    const cMat = new THREE.MeshLambertMaterial({ map: cTex });
    crateMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cMat, MAPDATA.crates.length);
    MAPDATA.crates.forEach((w, i) => {
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1, dz = w.z2 - w.z1;
      m4.makeScale(dx, dy, dz);
      m4.setPosition((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2, (w.z1 + w.z2) / 2);
      crateMesh.setMatrixAt(i, m4);
    });
    crateMesh.castShadow = true;
    crateMesh.receiveShadow = true;
    scene.add(crateMesh);

    // 新增掩体：沙袋（织物色）、油桶（圆柱）、水泥墩（灰色）
    const covers = MAPDATA.covers || [];
    const bagTex = makeCanvas(128, 64, (g, w, h) => {
      g.fillStyle = '#7a6b4a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(${90 + Math.random() * 40 | 0},${80 + Math.random() * 30 | 0},50,0.3)`;
        g.fillRect(Math.random() * w, Math.random() * h, 1.6, 1.6);
      }
      g.strokeStyle = 'rgba(40,32,20,0.5)'; g.lineWidth = 3;
      for (let y = 16; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    });
    const bagMap = new THREE.CanvasTexture(bagTex);
    bagMap.colorSpace = THREE.SRGBColorSpace;
    const bagMat = new THREE.MeshLambertMaterial({ map: bagMap });
    const blockMat = new THREE.MeshLambertMaterial({ color: 0x8d9299 });
    const barrelMat = new THREE.MeshLambertMaterial({ color: 0xb34a3a });
    const bags = covers.filter(c => c.cover === 'sandbag');
    const blocks = covers.filter(c => c.cover === 'block');
    const barrels = covers.filter(c => c.cover === 'barrel');
    const talls = covers.filter(c => c.cover === 'tall');
    function addCoverMesh(list, geo, mat) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((w, i) => {
        const dx = w.x2 - w.x1, dy = w.y2 - w.y1, dz = w.z2 - w.z1;
        m4.makeScale(Math.max(0.01, dx), dy, Math.max(0.01, dz));
        m4.setPosition((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2, (w.z1 + w.z2) / 2);
        im.setMatrixAt(i, m4);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      scene.add(im);
    }
    addCoverMesh(bags, new THREE.BoxGeometry(1, 1, 1), bagMat);
    addCoverMesh(blocks, new THREE.BoxGeometry(1, 1, 1), blockMat);
    addCoverMesh(barrels, new THREE.CylinderGeometry(0.5, 0.5, 1, 10), barrelMat);
    addCoverMesh(talls, new THREE.BoxGeometry(1, 1, 1), blockMat); // 高过人掩体（2.2m 混凝土墩）

    // 墙根环境阴影（视觉接地）
    const aoBoxes = MAPDATA.walls.filter(w => w.y1 < 0.01 && !w.cover);
    const aoMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false });
    const aoMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), aoMat, aoBoxes.length);
    aoBoxes.forEach((w, i) => {
      const dx = w.x2 - w.x1, dz = w.z2 - w.z1;
      m4.makeScale(dx + 0.5, 0.16, dz + 0.5);
      m4.setPosition((w.x1 + w.x2) / 2, 0.09, (w.z1 + w.z2) / 2);
      aoMesh.setMatrixAt(i, m4);
    });
    aoMesh.renderOrder = 1;
    scene.add(aoMesh);

    // 埋包点地标
    const decA = siteTexture('A', '#d24a2b');
    const mA = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 7.2), new THREE.MeshBasicMaterial({ map: decA, transparent: true }));
    mA.rotation.x = -Math.PI / 2; mA.rotation.z = 0;
    mA.position.set(MAPDATA.sites.a.plant.x, 0.02, MAPDATA.sites.a.plant.z);
    scene.add(mA);
    const decB = siteTexture('B', '#2b6bd2');
    const mB = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 7.2), new THREE.MeshBasicMaterial({ map: decB, transparent: true }));
    mB.rotation.x = -Math.PI / 2;
    mB.position.set(MAPDATA.sites.b.plant.x, 0.02, MAPDATA.sites.b.plant.z);
    scene.add(mB);

    // 中路双开门（装饰）
    const doorMat = new THREE.MeshLambertMaterial({ color: 0x3e5240 });
    for (const dz of [-1.7, 0.7]) {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.5, 1.7), doorMat);
      d.position.set(4.05, 1.25, dz);
      d.rotation.y = dz < 0 ? -1.85 : 1.85;
      d.castShadow = true;
      scene.add(d);
    }
  }

  // ---------- 人质模型（白衬衫举手姿势） ----------
  const hostageMeshes = new Map(); // id -> group
  function ensureHostage(id) {
    let g = hostageMeshes.get(id);
    if (!g) {
      g = new THREE.Group();
      const shirt = new THREE.MeshLambertMaterial({ color: 0xe8e4da });
      const pants = new THREE.MeshLambertMaterial({ color: 0x4a5d7a });
      const skin = new THREE.MeshLambertMaterial({ color: 0xd9a87c });
      const legL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.72, 0.16), pants);
      legL.position.set(-0.1, 0.36, 0);
      const legR = legL.clone(); legR.position.x = 0.1;
      const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.66, 0.26), shirt);
      torso.position.set(0, 1.02, 0);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.22), skin);
      head.position.set(0, 1.55, 0);
      // 举起的双手（人质经典姿势）
      const armL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.5, 0.12), shirt);
      armL.position.set(-0.28, 1.5, 0);
      armL.rotation.z = 0.5;
      const armR = armL.clone(); armR.position.x = 0.28; armR.rotation.z = -0.5;
      g.add(legL, legR, torso, head, armL, armR);
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      scene.add(g);
      hostageMeshes.set(id, g);
    }
    return g;
  }

  function updateHostages(list) {
    const seen = new Set();
    list.forEach(h => {
      const [id, x, y, z, yaw] = h;
      seen.add(id);
      const g = ensureHostage(id);
      g.visible = true;
      g.position.set(x, y, z);
      g.rotation.y = yaw;
    });
    for (const [id, g] of hostageMeshes) {
      if (!seen.has(id)) g.visible = false;
    }
  }

  // ---------- 战利品箱（舔包）— 固定对象池，不按 id 无限累积 ----------
  const crateMeshes = [];
  function buildCrateModel() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.65, 0.75),
      new THREE.MeshLambertMaterial({ color: 0x4a5540 }));
    body.position.y = 0.33;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.1, 0.79),
      new THREE.MeshLambertMaterial({ color: 0x5d6b4e }));
    lid.position.y = 0.71;
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.09, 0.1),
      new THREE.MeshLambertMaterial({ color: 0x2e352a }));
    strap.position.y = 0.45;
    const glow = new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.02, 0.82),
      new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.7 }));
    glow.position.y = 0.72;
    g.add(body, lid, strap, glow);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(g);
    crateMeshes.push(g);
    return g;
  }
  function updateCrates(list) {
    let idx = 0;
    list.forEach(c => {
      let g = crateMeshes[idx];
      if (!g) g = buildCrateModel();
      g.visible = true;
      g.position.set(c[1], c[2], c[3]);
      idx++;
    });
    for (; idx < crateMeshes.length; idx++) crateMeshes[idx].visible = false;
    // 池上限 12：超出销毁（防长时间对局累积）
    while (crateMeshes.length > 12) {
      const g2 = crateMeshes.pop();
      scene.remove(g2);
      g2.traverse(o => { if (o.material) o.material.dispose(); if (o.geometry) o.geometry.dispose(); });
    }
  }
  function _debugCrates() { return crateMeshes.filter(g => g.visible).length; }

  // ---------- 烟雾弹烟团 ----------
  const smokePool = [];
  let smokeTex = null;
  function initSmoke() {
    const c = makeCanvas(64, 64, (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(200,200,205,0.85)');
      grad.addColorStop(0.55, 'rgba(160,160,168,0.5)');
      grad.addColorStop(1, 'rgba(140,140,150,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
    smokeTex = new THREE.CanvasTexture(c);
    smokeTex.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 48; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smokeTex, transparent: true, opacity: 0, depthWrite: false
      }));
      sp.visible = false;
      scene.add(sp);
      smokePool.push(sp);
    }
  }

  function updateSmokes(list) {
    if (!smokePool.length) return;
    let idx = 0;
    list.forEach((s, si) => {
      const x = s[0], y = s[1], z = s[2], r = s[3];
      for (let k = 0; k < 6 && idx < smokePool.length; k++) {
        const sp = smokePool[idx++];
        sp.visible = true;
        const a = si * 2.399 + k * 2.094;
        const rr = r * (0.25 + 0.75 * (((si * 7 + k * 13) % 10) / 10));
        sp.position.set(
          x + Math.cos(a) * rr,
          y + 0.25 + (((si * 3 + k * 5) % 10) / 10) * 2.6,
          z + Math.sin(a) * rr
        );
        const sc = 1.0 + r * 0.55 + ((si + k) % 5) * 0.14;
        sp.scale.set(sc, sc, 1);
        sp.material.opacity = 0.26 + ((si + k * 2) % 3) * 0.07;
      }
    });
    for (; idx < smokePool.length; idx++) smokePool[idx].visible = false;
  }

  function buildPools() {
    // 曳光弹：3D 圆柱（起点→终点，加法混合发光）
    for (let i = 0; i < 24; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 1, 5, 1, true), mat);
      m.visible = false;
      scene.add(m);
      tracerPool.push({ mesh: m, mat, life: 0 });
    }
    // 点光源（枪口/爆炸闪光）
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffd080, 0, 14, 2);
      l.visible = false;
      scene.add(l);
      flashPool.push({ light: l, life: 0 });
    }
    // 其他玩家枪口火光（星芒 sprite，自动面向相机）
    const flashTex = muzzleFlashTexture();
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.SpriteMaterial({
        map: flashTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      muzzlePool.push({ mesh: s, mat, life: 0 });
    }
    // 墙面弹痕贴花
    const scorchTex = makeCanvas(64, 64, (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(18,14,10,0.95)');
      grad.addColorStop(0.55, 'rgba(24,18,12,0.55)');
      grad.addColorStop(1, 'rgba(24,18,12,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * w * 0.42;
        g.fillStyle = 'rgba(10,8,5,0.5)';
        g.fillRect(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, 2, 2);
      }
    });
    const scorchMap = new THREE.CanvasTexture(scorchTex);
    scorchMap.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 24; i++) {
      const mat = new THREE.SpriteMaterial({ map: scorchMap, transparent: true, opacity: 0, depthWrite: false, rotation: Math.random() * Math.PI * 2 });
      const s = new THREE.Sprite(mat);
      s.scale.set(0.16 + Math.random() * 0.08, 0.16 + Math.random() * 0.08, 1);
      s.visible = false;
      scene.add(s);
      decalPool.push({ mesh: s, mat, life: 0, maxLife: 5, type: 'scorch' });
    }
    // 地面血泊
    const bloodTex = makeCanvas(64, 64, (g, w, h) => {
      const grad = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(122,12,8,0.9)');
      grad.addColorStop(0.6, 'rgba(102,10,6,0.6)');
      grad.addColorStop(1, 'rgba(80,8,5,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 9; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * w * 0.45;
        g.fillStyle = 'rgba(110,10,6,0.55)';
        g.beginPath(); g.arc(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, 3 + Math.random() * 5, 0, Math.PI * 2); g.fill();
      }
    });
    const bloodMap = new THREE.CanvasTexture(bloodTex);
    bloodMap.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: bloodMap, transparent: true, opacity: 0, depthWrite: false });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.random() * Math.PI * 2;
      m.visible = false;
      scene.add(m);
      decalPool.push({ mesh: m, mat, life: 0, maxLife: 6, type: 'blood' });
    }
    // 弹壳
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshLambertMaterial({ color: 0xd8a53f });
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.022, 6), mat);
      m.visible = false;
      scene.add(m);
      shellPool.push({ mesh: m, vx: 0, vy: 0, vz: 0, rvx: 0, rvy: 0, life: 0 });
    }
    // 爆炸火球与冲击环
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff9a30, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat);
      m.visible = false;
      scene.add(m);
      fireballPool.push({ mesh: m, mat, life: 0, maxLife: 0.55, maxR: 2.4 });
    }
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe3b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const m = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 28), mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      ringPool.push({ mesh: m, mat, life: 0, maxLife: 0.5, maxR: 5 });
    }
  }

  // ---------- 手雷 ----------
  const nadeMeshes = [];
  const nadeMat = new THREE.MeshLambertMaterial({ color: 0x3a4a33 });
  function updateNades(list) {
    while (nadeMeshes.length < list.length) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), nadeMat);
      m.castShadow = true;
      scene.add(m);
      nadeMeshes.push(m);
    }
    list.forEach((n, i) => {
      nadeMeshes[i].visible = true;
      nadeMeshes[i].position.set(n[0], n[1], n[2]);
    });
    for (let i = list.length; i < nadeMeshes.length; i++) nadeMeshes[i].visible = false;
  }

  function onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ---------- 画质档位（自动降档：低档关闭阴影投影 + 像素比降到 1） ----------
  let lowQuality = false;
  function setQuality(low) {
    if (low === lowQuality) return;
    lowQuality = low;
    renderer.shadowMap.enabled = !low;
    renderer.shadowMap.needsUpdate = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, low ? 1 : 1.5));
    onResize();
  }

  // ---------- 玩家模型 ----------
  const thirdGunCache = new Map(); // weaponId -> Group（第三人称武器模型缓存）
  // 枪械材质只创建一次（修复：原实现每把枪新建 4 个带纹理材质 → 100+ 纹理）
  const GUN_TDARK = new THREE.MeshLambertMaterial({ map: gunMetalTexture(), color: 0x9aa0aa });
  const GUN_TMETAL = new THREE.MeshLambertMaterial({ map: gunMetalTexture(), color: 0xc2c8d0 });
  const GUN_TPOLY = new THREE.MeshLambertMaterial({ color: 0x23262b });
  const GUN_TWOOD = new THREE.MeshLambertMaterial({ map: gunWoodTexture(), color: 0xc8a070 });

  function buildThirdGun(id) {
    if (!id) return null;
    if (thirdGunCache.has(id)) return thirdGunCache.get(id);
    const g = new THREE.Group();
    const tDark = GUN_TDARK;
    const tMetal = GUN_TMETAL;
    const tPoly = GUN_TPOLY;
    const tWood = GUN_TWOOD;
    const b = (w, h, d, mat, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      g.add(m);
      return m;
    };
    // 枪械通用件：枪管/弹匣/瞄准具/枪托
    const barrel = (len, cal) => b(cal, cal, len, tDark, 0, 0.05, -0.12 - len / 2);
    const mag = (w, h, dz, y) => b(w, h, dz, tMetal, 0, y, -0.05);
    const stock = (len) => b(0.05, 0.08, len, tPoly, 0, 0.015, 0.05 + len / 2);
    const frontSight = () => b(0.018, 0.05, 0.014, tDark, 0, 0.105, -0.32);
    const rearSight = () => b(0.024, 0.04, 0.02, tDark, 0, 0.1, -0.06);
    switch (id) {
      case 'ak47':
        b(0.06, 0.085, 0.44, tMetal, 0, 0.02, -0.16);
        stock(0.16);
        mag(0.045, 0.13, 0.06, -0.075);
        barrel(0.3, 0.035);
        b(0.05, 0.04, 0.12, tWood, 0, -0.015, -0.32);
        frontSight(); rearSight();
        break;
      case 'm4a1':
        b(0.06, 0.085, 0.4, tMetal, 0, 0.02, -0.12);
        stock(0.14);
        mag(0.045, 0.12, 0.05, -0.07);
        barrel(0.34, 0.04);
        b(0.03, 0.03, 0.05, tPoly, 0, 0.1, -0.26);
        frontSight();
        break;
      case 'awp':
        b(0.06, 0.09, 0.48, tMetal, 0, 0.02, -0.2);
        stock(0.16);
        barrel(0.42, 0.035);
        b(0.04, 0.045, 0.18, tPoly, 0, 0.1, -0.28);
        mag(0.04, 0.1, 0.05, -0.07);
        b(0.015, 0.04, 0.03, tMetal, 0, -0.02, 0.04);
        break;
      case 'mp5':
        b(0.055, 0.08, 0.3, tMetal, 0, 0.02, -0.08);
        stock(0.12);
        mag(0.045, 0.13, 0.05, -0.08);
        barrel(0.2, 0.032);
        frontSight();
        break;
      case 'deagle':
        b(0.05, 0.07, 0.28, tMetal, 0, 0.02, -0.08);
        b(0.04, 0.12, 0.05, tPoly, 0, -0.06, 0.06);
        b(0.016, 0.03, 0.05, tDark, 0, 0.06, 0.02);
        break;
      case 'usp':
        b(0.045, 0.06, 0.22, tMetal, 0, 0.02, -0.05);
        b(0.035, 0.1, 0.045, tPoly, 0, -0.05, 0.05);
        break;
      case 'glock':
        b(0.05, 0.06, 0.2, tPoly, 0, 0.02, -0.04);
        b(0.04, 0.1, 0.045, tMetal, 0, -0.05, 0.05);
        break;
      case 'p228': case 'fiveseven':
        b(0.05, 0.07, 0.28, tMetal, 0, 0.02, -0.08);
        b(0.04, 0.12, 0.05, tPoly, 0, -0.06, 0.06);
        break;
      case 'elites':
        b(0.045, 0.06, 0.24, tMetal, 0.05, 0.02, -0.06);
        b(0.045, 0.06, 0.24, tMetal, -0.05, 0.02, -0.06);
        break;
      case 'tmp':
        b(0.055, 0.075, 0.26, tMetal, 0, 0.02, -0.07);
        mag(0.04, 0.11, 0.045, -0.07);
        barrel(0.24, 0.04);
        break;
      case 'mac10':
        b(0.055, 0.08, 0.24, tPoly, 0, 0.02, -0.06);
        mag(0.045, 0.12, 0.05, -0.08);
        barrel(0.16, 0.032);
        break;
      case 'ump45':
        b(0.055, 0.08, 0.3, tMetal, 0, 0.02, -0.09);
        stock(0.12);
        mag(0.045, 0.13, 0.05, -0.08);
        barrel(0.18, 0.035);
        break;
      case 'p90':
        b(0.055, 0.08, 0.34, tMetal, 0, 0.02, -0.11);
        b(0.045, 0.06, 0.2, tPoly, 0, 0.08, -0.06);
        barrel(0.16, 0.03);
        break;
      case 'galil':
        b(0.06, 0.085, 0.5, tMetal, 0, 0.02, -0.18);
        stock(0.16);
        mag(0.045, 0.13, 0.06, -0.075);
        barrel(0.34, 0.035);
        b(0.05, 0.04, 0.14, tWood, 0, -0.015, -0.36);
        frontSight();
        break;
      case 'famas':
        b(0.055, 0.08, 0.36, tMetal, 0, 0.02, -0.12);
        stock(0.12);
        mag(0.045, 0.12, 0.05, -0.07);
        barrel(0.22, 0.032);
        b(0.03, 0.04, 0.12, tPoly, 0, 0.095, -0.08);
        break;
      case 'sg552':
        b(0.055, 0.08, 0.34, tMetal, 0, 0.02, -0.11);
        stock(0.12);
        mag(0.045, 0.12, 0.05, -0.07);
        barrel(0.22, 0.033);
        b(0.02, 0.04, 0.07, tPoly, 0, 0.09, -0.03);
        break;
      case 'aug':
        b(0.055, 0.08, 0.36, tMetal, 0, 0.02, -0.12);
        stock(0.12);
        mag(0.045, 0.12, 0.05, -0.07);
        barrel(0.22, 0.033);
        b(0.04, 0.045, 0.18, tPoly, 0, 0.1, -0.08);
        break;
      case 'scout':
        b(0.05, 0.075, 0.42, tMetal, 0, 0.02, -0.16);
        stock(0.14);
        barrel(0.32, 0.03);
        b(0.035, 0.04, 0.15, tPoly, 0, 0.095, -0.22);
        break;
      case 'g3sg1': case 'sg550':
        b(0.055, 0.085, 0.5, tMetal, 0, 0.02, -0.2);
        stock(0.15);
        mag(0.04, 0.12, 0.05, -0.07);
        barrel(0.38, 0.035);
        b(0.04, 0.045, 0.16, tPoly, 0, 0.1, -0.26);
        break;
      case 'm249':
        b(0.07, 0.1, 0.5, tMetal, 0, 0.02, -0.2);
        stock(0.14);
        b(0.08, 0.11, 0.1, tPoly, 0, -0.08, -0.05);
        barrel(0.4, 0.04);
        b(0.012, 0.03, 0.05, tPoly, 0, 0.11, -0.3);
        break;
      case 'knife': {
        b(0.03, 0.05, 0.1, tWood, 0, 0.02, 0.02);
        b(0.02, 0.08, 0.22, tMetal, 0, 0.06, -0.1);
        break;
      }
      case 'hegrenade': {
        const sp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), tMetal);
        sp.position.set(0, 0.02, -0.05);
        sp.castShadow = true;
        g.add(sp);
        break;
      }
      case 'flashbang': {
        const sp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), tMetal);
        sp.position.set(0, 0.02, -0.05);
        sp.castShadow = true;
        g.add(sp);
        break;
      }
      case 'smokegrenade':
        b(0.08, 0.16, 0.08, tPoly, 0, 0.02, -0.05);
        break;
      default: {
        b(0.1, 0.07, 0.15, tPoly, 0, 0.02, -0.04);
        b(0.08, 0.05, 0.11, tMetal, 0, 0.005, -0.04);
        break;
      }
    }
    // 握持位：双手前伸位置（相对玩家组原点）
    g.position.set(0, 1.14, 0.24);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    thirdGunCache.set(id, g);
    return g;
  }

  function buildPlayerModel(team) {
    const g = new THREE.Group();
    const skin = new THREE.MeshLambertMaterial({ color: 0xd9a87c });
    const teamCol = team === GAMECONST.TEAM_T ? 0xc87f3a : 0x4f78a4;
    const cloth = new THREE.MeshLambertMaterial({ color: teamCol });
    const dark = new THREE.MeshLambertMaterial({ color: team === GAMECONST.TEAM_T ? 0x8a5a28 : 0x35506e });

    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.72, 0.16), dark);
    legL.position.set(-0.1, 0.36, 0);
    const legR = legL.clone(); legR.position.x = 0.1;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.66, 0.26), cloth);
    torso.position.set(0, 1.02, 0);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.22), skin);
    head.position.set(0, 1.55, 0);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.5, 0.12), cloth);
    armL.position.set(-0.3, 1.05, 0.1);
    const armR = armL.clone(); armR.position.x = 0.3;
    // 防弹衣背心与头盔（默认隐藏，购买后显示）
    const kevlarMat = new THREE.MeshLambertMaterial({ color: 0x4a5246 });
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.68, 0.3), kevlarMat);
    vest.position.set(0, 1.03, 0);
    vest.visible = false;
    const helm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.11, 0.25), kevlarMat);
    helm.position.set(0, 1.665, 0);
    helm.visible = false;

    g.add(legL, legR, torso, head, armL, armR, vest, helm);
    g.userData = { legL, legR, armL, armR, torso, vest, helm, walkPhase: 0, dead: 0 };
    g.castShadow = true;
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
    return g;
  }

  function ensurePlayer(id, team) {
    let m = playerMeshes.get(id);
    if (m && m.group.userData.team !== team) { scene.remove(m.group); m = null; }
    if (!m) {
      const group = buildPlayerModel(team);
      group.visible = false;
      scene.add(group);
      group.userData.team = team;
      m = { group, deadAnim: 0, vel: { x: 0, z: 0 }, wasAlive: false, flinch: 0 };
      playerMeshes.set(id, m);
    }
    return m;
  }

  function updatePlayers(list, myId) {
    for (const [id, m] of playerMeshes) {
      if (!list.has(id)) m.group.visible = false;
    }
    list.forEach(p => {
      const m = ensurePlayer(p.id, p.team);
      if (p.id === myId) { m.group.visible = false; return; } // 自己由第一人称视角呈现
      const g = m.group;
      g.visible = true;
      // 同步第三人称持枪模型（按当前武器切换）
      const wid = p.weapon || '';
      if (m.gunWeapon !== wid) {
        if (m.gun) g.remove(m.gun);
        m.gun = buildThirdGun(wid);
        if (m.gun) g.add(m.gun);
        m.gunWeapon = wid;
      }
      if (p.alive) {
        if (!m.wasAlive) Ragdoll.removeFor(p.id); // 重生时清掉旧尸体
        m.wasAlive = true;
        m.deadAnim = 0;
        g.visible = true;
        g.position.set(p.x, p.y, p.z);
        g.rotation.set(0, p.yaw, 0);
        const scale = p.crouch ? 0.72 : 1;
        g.scale.set(scale, scale, scale);
        // 护甲外观：有防弹衣显示背心，戴头盔显示头盔
        const ud0 = g.userData;
        ud0.vest.visible = (p.armor || 0) > 0;
        ud0.helm.visible = !!p.helmet;
        const sp = Math.hypot(m.vel.x, m.vel.z);
        m.vel.x += (p.vx - m.vel.x) * 0.3; m.vel.z += (p.vz - m.vel.z) * 0.3;
        // 时间基准步态（帧率无关，约 2.9 步/秒）
        g.userData.walkPhase = performance.now() * 0.001 * (2.2 + sp * 1.35);
        const ph = g.userData.walkPhase;
        const swing = Math.sin(ph) * Math.min(0.7, sp * 0.22);
        const ud = g.userData;
        ud.legL.rotation.x = swing;
        ud.legR.rotation.x = -swing;
        ud.armL.rotation.x = -swing * 0.4;
        ud.armR.rotation.x = swing * 0.4;
        // 受击踉跄（躯干后仰）
        if (m.flinch > 0) {
          m.flinch -= 0.14;
          ud.torso.rotation.x = Math.max(0, m.flinch) * 0.3;
        } else {
          ud.torso.rotation.x = 0;
        }
        // 跑动尘土        // 跑动尘土
        m.dustT = (m.dustT || 0) - 1;
        if (sp > 3.3 && m.dustT <= 0) {
          m.dustT = 0.34;
          spawnBurst(p.x, p.y + 0.12, p.z, { count: 4, color: 0xc9b489, size: 0.05, speed: 0.8, life: 0.45, gravity: 0.7, upBias: 1.1 });
        }
      } else {
        if (m.wasAlive) {
          // 死亡：布娃娃尸体（无血雾，几秒后沉没并变为战利品箱）
          m.wasAlive = false;
          Ragdoll.spawn(p.id, p.x, p.y, p.z, p.yaw, p.team, p.armor, p.helmet);
        }
        g.visible = false; // 尸体由布娃娃物理呈现
      }
    });
  }

  // ---------- 特效：曳光弹轨迹（起点→终点，含俯仰） ----------
  let _tracerTotal = 0; // 测试辅助：累计生成的曳光数
  function tracer(from, to) {
    const t = tracerPool.find(x => x.life <= 0) || tracerPool[0];
    const m = t.mesh;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.5) return;
    _tracerTotal++;
    m.visible = true;
    t.life = 0.09;
    t.mat.opacity = 0.95;
    m.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    m.scale.set(1, len, 1);
    _v1.set(dx / len, dy / len, dz / len);
    _q1.setFromUnitVectors(_v2.set(0, 1, 0), _v1);
    m.quaternion.copy(_q1);
  }

  // ---------- 特效：命中点（火花 / 血雾）+ 弹痕 ----------
  function impact(x, y, z, kind) {
    if (kind === 2) {
      // 命中玩家：血雾
      spawnBurst(x, y, z, { count: 12, color: 0xb81f1f, size: 0.07, speed: 3.2, life: 0.45 });
    } else {
      // 命中墙面：火花 + 弹痕
      spawnBurst(x, y, z, { count: 10, color: 0xffc860, size: 0.045, speed: 4.2, life: 0.32 });
      scorchDecal(x, y, z);
    }
  }

  function scorchDecal(x, y, z) {
    const d = decalPool.find(q => q.type === 'scorch' && q.life <= 0);
    if (!d) return;
    d.life = d.maxLife;
    d.mat.opacity = 0.85;
    d.mat.rotation = Math.random() * Math.PI * 2;
    d.mesh.visible = true;
    d.mesh.position.set(x + (Math.random() - 0.5) * 0.05, y + (Math.random() - 0.5) * 0.05, z + (Math.random() - 0.5) * 0.05);
  }

  function bloodGround(x, z) {
    const d = decalPool.find(q => q.type === 'blood' && q.life <= 0);
    if (!d) return;
    d.life = d.maxLife;
    d.mat.opacity = 0.85;
    d.mesh.visible = true;
    d.mesh.position.set(x, 0.025, z);
    d.mesh.rotation.z = Math.random() * Math.PI * 2;
  }

  // ---------- 特效：粒子爆发 ----------
  const burstFree = []; // 粒子对象池（复用几何体/材质，消除 GC 卡顿）
  const BURST_MAX = 24;
  function spawnBurst(x, y, z, opts) {
    const count = Math.min(opts.count || 10, BURST_MAX);
    let b = burstFree.pop();
    if (!b) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BURST_MAX * 3), 3));
      const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, depthWrite: false });
      const points = new THREE.Points(geo, mat);
      scene.add(points);
      b = { points, vels: new Float32Array(BURST_MAX * 3) };
    }
    const attr = b.points.geometry.getAttribute('position');
    const arr = attr.array;
    for (let i = 0; i < count; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const sp = (opts.speed || 3) * (0.35 + Math.random() * 0.85);
      b.vels[i * 3] = Math.sin(ph) * Math.cos(th) * sp;
      b.vels[i * 3 + 1] = Math.cos(ph) * sp * (opts.upBias === undefined ? 0.9 : opts.upBias) + (opts.upSpeed || 0);
      b.vels[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * sp;
      arr[i * 3] = x; arr[i * 3 + 1] = y; arr[i * 3 + 2] = z;
    }
    attr.needsUpdate = true;
    b.points.geometry.setDrawRange(0, count);
    b.points.material.color.set(opts.color || 0xffc860);
    b.points.material.size = opts.size || 0.05;
    b.points.material.opacity = 1;
    b.points.visible = true;
    b.life = opts.life || 0.4; b.maxLife = opts.life || 0.4;
    b.gravity = opts.gravity === undefined ? 9.8 : opts.gravity;
    b.drag = opts.drag === undefined ? 0.92 : opts.drag;
    burstPool.push(b);
  }

  // ---------- 特效：其他玩家枪口火光 ----------
  function muzzleFlash(x, y, z, yaw, pitch) {
    const f = muzzlePool.find(q => q.life <= 0) || muzzlePool[0];
    const dirX = -Math.sin(yaw) * Math.cos(pitch);
    const dirY = Math.sin(pitch);
    const dirZ = -Math.cos(yaw) * Math.cos(pitch);
    f.mesh.visible = true;
    f.life = 0.05;
    f.mat.opacity = 0.95;
    f.mat.rotation = Math.random() * Math.PI * 2;
    const sc = 0.2 + Math.random() * 0.12;
    f.mesh.scale.set(sc, sc, 1);
    f.mesh.position.set(x + dirX * 0.3, y + dirY * 0.3, z + dirZ * 0.3);
  }

  // ---------- 特效：抛壳 ----------
  function shell(px, py, pz, right, up, back) {
    const s = shellPool.find(q => q.life <= 0) || shellPool[0];
    s.mesh.visible = true;
    s.life = 2.2;
    s.mesh.position.set(
      px + right.x * 0.1 - up.x * 0.08 + back.x * 0.12,
      py + right.y * 0.1 - up.y * 0.08 + back.y * 0.12,
      pz + right.z * 0.1 - up.z * 0.08 + back.z * 0.12
    );
    const sp = 0.9 + Math.random() * 0.7;
    s.vx = right.x * sp * (0.7 + Math.random() * 0.6) + back.x * 0.3;
    s.vy = up.y * sp * (1.1 + Math.random() * 0.7);
    s.vz = right.z * sp * (0.7 + Math.random() * 0.6) + back.z * 0.3;
    s.rvx = (Math.random() - 0.5) * 22;
    s.rvy = (Math.random() - 0.5) * 26;
    s.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
  }

  function flashAt(x, y, z, intensity) {
    const f = flashPool.find(f => f.life <= 0) || flashPool[0];
    f.light.visible = true;
    f.life = 0.05;
    f.light.position.set(x, y, z);
    f.light.intensity = intensity || 2.5;
  }

  // ---------- 特效：爆炸（火球 + 冲击环 + 火花 + 烟尘） ----------
  function explosion(x, y, z) {
    flashAt(x, y + 0.5, z, 40);
    shakeT = 0.35;
    const fb = fireballPool.find(f => f.life <= 0) || fireballPool[0];
    fb.mesh.visible = true;
    fb.life = fb.maxLife;
    fb.mat.opacity = 0.95;
    fb.mesh.position.set(x, y + 0.6, z);
    fb.mesh.scale.setScalar(0.25);
    const ring = ringPool.find(r => r.life <= 0) || ringPool[0];
    ring.mesh.visible = true;
    ring.life = ring.maxLife;
    ring.mat.opacity = 0.9;
    ring.mesh.position.set(x, 0.06, z);
    ring.mesh.scale.setScalar(0.4);
    // 烟尘
    spawnBurst(x, y + 0.4, z, { count: 14, color: 0x6b645a, size: 0.18, speed: 2.2, life: 1.6, gravity: -1.2, upBias: 1.6, drag: 0.94 });
    // 火花
    spawnBurst(x, y + 0.5, z, { count: 18, color: 0xffb050, size: 0.06, speed: 6.5, life: 0.5 });
    // 爆炸也产生弹坑痕迹
    scorchDecal(x, 0.1, z);
  }

  // ---------- 特效更新 ----------
  function updateEffects(dt) {
    try { Ragdoll.update(dt); } catch (e) { console.warn('[Ragdoll] 更新异常:', e && e.message, e && e.stack ? String(e.stack).split('\n')[1] : ''); }
    for (const t of tracerPool) {
      if (t.life > 0) {
        t.life -= dt;
        t.mat.opacity = Math.max(0, t.life / 0.09) * 0.95;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    for (const f of flashPool) {
      if (f.life > 0) {
        f.life -= dt;
        f.light.intensity *= 0.7;
        if (f.life <= 0) { f.light.visible = false; f.light.intensity = 0; }
      }
    }
    for (const f of muzzlePool) {
      if (f.life > 0) {
        f.life -= dt;
        f.mat.opacity = Math.max(0, f.life / 0.05) * 0.95;
        if (f.life <= 0) f.mesh.visible = false;
      }
    }
    for (let i = burstPool.length - 1; i >= 0; i--) {
      const b = burstPool[i];
      b.life -= dt;
      if (b.life <= 0) {
        b.points.visible = false;
        b.points.geometry.setDrawRange(0, 0);
        burstFree.push(b);
        if (burstFree.length > 48) { // 池上限，超出销毁
          const ex = burstFree.shift();
          ex.points.geometry.dispose();
          ex.points.material.dispose();
        }
        burstPool.splice(i, 1);
        continue;
      }
      const attr = b.points.geometry.getAttribute('position');
      const arr = attr.array;
      for (let k = 0; k < b.vels.length; k += 3) {
        b.vels[k + 1] -= b.gravity * dt;
        b.vels[k] *= b.drag; b.vels[k + 1] *= b.drag; b.vels[k + 2] *= b.drag;
        arr[k] += b.vels[k] * dt;
        arr[k + 1] += b.vels[k + 1] * dt;
        arr[k + 2] += b.vels[k + 2] * dt;
      }
      attr.needsUpdate = true;
      b.points.material.opacity = Math.max(0, b.life / b.maxLife);
    }
    for (const d of decalPool) {
      if (d.life > 0) {
        d.life -= dt;
        d.mat.opacity = 0.85 * Math.min(1, d.life / 1.5);
        if (d.life <= 0) d.mesh.visible = false;
      }
    }
    for (const s of shellPool) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vy -= 9.8 * dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      s.mesh.rotation.x += s.rvx * dt;
      s.mesh.rotation.y += s.rvy * dt;
      if (s.mesh.position.y < 0.012 && s.vy < 0) {
        s.mesh.position.y = 0.012;
        s.vy = -s.vy * 0.35;
        s.vx *= 0.6; s.vz *= 0.6;
        if (Math.abs(s.vy) < 0.3) s.vy = 0;
      }
      if (s.life <= 0) s.mesh.visible = false;
    }
    for (const fb of fireballPool) {
      if (fb.life <= 0) continue;
      fb.life -= dt;
      const p = Math.max(0, fb.life / fb.maxLife);
      fb.mesh.scale.setScalar(fb.maxR * (1 - p * p));
      fb.mat.opacity = p * 0.95;
      if (fb.life <= 0) fb.mesh.visible = false;
    }
    for (const r of ringPool) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const p = Math.max(0, r.life / r.maxLife);
      r.mesh.scale.setScalar(r.maxR * (1 - p));
      r.mat.opacity = p * 0.9;
      if (r.life <= 0) r.mesh.visible = false;
    }
  }

  // ---------- 主渲染 ----------
  function renderFrame(view, dt) {
    // 相机
    camera.position.set(view.camX, view.camY, view.camZ);
    camera.rotation.y = view.yaw;
    camera.rotation.x = view.pitch;
    if (shakeT > 0) {
      shakeT -= dt;
      const s = shakeT * 0.06;
      camera.rotation.z = (Math.random() - 0.5) * s;
    } else camera.rotation.z = 0;
    updateEffects(dt);
    renderer.render(scene, camera);
  }

  // 受击踉跄（他人命中时调用）
  function flinch(id) {
    const m = playerMeshes.get(id);
    if (m) m.flinch = 1;
  }

  function getCamera() { return camera; }

  return {
    init, renderFrame, updatePlayers, tracer, impact, muzzleFlash, shell, flashAt, explosion, getCamera, flinch, updateNades, updateSmokes, updateHostages, updateCrates, setQuality, _debugCrates,
    // 测试辅助
    _debugTracerTotal: () => _tracerTotal,
    _debugDrawCalls: () => renderer.info.render.calls,
    _debugTriangles: () => renderer.info.render.triangles,
    _debugShadowOn: () => renderer.shadowMap.enabled,
    _debugArmor: () => {
      const out = {};
      for (const [id, m] of playerMeshes) {
        if (m.group.visible) out[id] = { vest: m.group.userData.vest.visible, helm: m.group.userData.helm.visible };
      }
      return out;
    },
    _debugTracerActive: () => tracerPool.filter(t => t.life > 0).length,
    _debugMuzzleHasTex: () => muzzlePool.length > 0 && !!muzzlePool[0].mat.map,
    _debugPlayerGuns: () => {
      const out = {};
      for (const [id, m] of playerMeshes) if (m.gunWeapon) out[id] = m.gunWeapon;
      return out;
    }
  };
})();
