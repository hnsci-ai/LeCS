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
  let maxAniso = 1; // 各向异性过滤上限（init 时按 GPU 能力设置）
  function applyAniso(t) { if (maxAniso > 1) t.anisotropy = maxAniso; }
  function makeCanvas(w, h, fn) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    fn(c.getContext('2d'), w, h);
    return c;
  }

  function sandTexture() {
    const c = makeCanvas(1024, 1024, (g, w, h) => {
      g.fillStyle = '#c8b184'; g.fillRect(0, 0, w, h);
      // 大尺度沙地色斑（mottling）
      for (let i = 0; i < 220; i++) {
        const px = Math.random() * w, py = Math.random() * h, pr = 18 + Math.random() * 60;
        const v = 120 + Math.random() * 80 | 0;
        const gr = g.createRadialGradient(px, py, pr * 0.2, px, py, pr);
        gr.addColorStop(0, `rgba(${v},${v * 0.9 | 0},${v * 0.62 | 0},${0.05 + Math.random() * 0.09})`);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
      }
      // 细砂粒
      for (let i = 0; i < 36000; i++) {
        const v = 120 + Math.random() * 80 | 0;
        g.fillStyle = `rgba(${v},${v * 0.88 | 0},${v * 0.62 | 0},${0.25 + Math.random() * 0.3})`;
        g.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
      }
      for (let i = 0; i < 560; i++) {
        g.fillStyle = 'rgba(90,70,40,0.25)';
        g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 4, 1.5);
      }
    });
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    applyAniso(t);
    return t;
  }

  function wallTexture() {
    const c = makeCanvas(512, 256, (g, w, h) => {
      g.fillStyle = '#d3b98a'; g.fillRect(0, 0, w, h);
      // 砖缝
      for (let y = 0; y < h; y += 18) {
        g.fillStyle = 'rgba(120,92,58,0.18)';
        g.fillRect(0, y, w, 2.5);
      }
      // 错缝竖缝
      for (let y = 0; y < h; y += 36) {
        for (let x = (y / 36) % 2 ? 170 : 0; x < w; x += 340) {
          g.fillStyle = 'rgba(120,92,58,0.18)';
          g.fillRect(x, y + 18, 2.5, 18);
        }
      }
      // 砖面颗粒与瑕疵
      for (let i = 0; i < 5200; i++) {
        const v = 150 + Math.random() * 90 | 0;
        g.fillStyle = `rgba(${v},${v * 0.86 | 0},${v * 0.6 | 0},0.3)`;
        g.fillRect(Math.random() * w, Math.random() * h, 1.8, 1.8);
      }
      // 污渍斑块
      for (let i = 0; i < 40; i++) {
        const px = Math.random() * w, py = Math.random() * h, pr = 10 + Math.random() * 30;
        const gr = g.createRadialGradient(px, py, pr * 0.2, px, py, pr);
        gr.addColorStop(0, 'rgba(96,74,44,0.16)');
        gr.addColorStop(1, 'rgba(96,74,44,0)');
        g.fillStyle = gr;
        g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = 'rgba(70,52,30,0.5)';
      g.fillRect(0, 0, w, 4); g.fillRect(0, h - 4, w, 4);
    });
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    applyAniso(t);
    return t;
  }

  function crateTexture() {
    const c = makeCanvas(256, 256, (g, w, h) => {
      g.fillStyle = '#8a6a3f'; g.fillRect(0, 0, w, h);
      // 木板条
      for (let y = 0; y < h; y += 32) {
        g.fillStyle = `rgba(${60 + Math.random() * 30 | 0},${44 + Math.random() * 20 | 0},${20 + Math.random() * 10 | 0},0.35)`;
        g.fillRect(0, y, w, 30);
        g.fillStyle = 'rgba(50,34,16,0.5)';
        g.fillRect(0, y + 30, w, 2);
      }
      // 木纹细线
      for (let i = 0; i < 900; i++) {
        const y = Math.random() * h;
        g.fillStyle = `rgba(${45 + Math.random() * 50 | 0},${32 + Math.random() * 35 | 0},16,${0.15 + Math.random() * 0.25})`;
        g.fillRect(Math.random() * w, y, 2 + Math.random() * 3, 1);
      }
      // 木节
      for (let i = 0; i < 5; i++) {
        const px = 30 + Math.random() * (w - 60), py = 16 + Math.random() * (h - 32);
        const gr = g.createRadialGradient(px, py, 1, px, py, 7);
        gr.addColorStop(0, 'rgba(40,26,10,0.65)');
        gr.addColorStop(0.6, 'rgba(60,40,18,0.3)');
        gr.addColorStop(1, 'rgba(60,40,18,0)');
        g.fillStyle = gr;
        g.beginPath(); g.ellipse(px, py, 7, 5, 0, 0, Math.PI * 2); g.fill();
      }
      g.strokeStyle = 'rgba(35,22,10,0.8)'; g.lineWidth = 5; g.strokeRect(2, 2, w - 4, h - 4);
      g.strokeStyle = 'rgba(35,22,10,0.5)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    applyAniso(t);
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
    renderer.info.autoReset = false; // 后期管线：手动 reset，draw call 统计含全屏合成
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 高画质：高 DPI 屏 2x 渲染，画面更锐
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // 软阴影：边缘柔和
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy()); // 各向异性过滤：远处地面/墙面更清晰

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9ec8e2);
    scene.fog = baseFog;

    camera = new THREE.PerspectiveCamera(75, 1, 0.05, 400);
    camera.rotation.order = 'YXZ';
    scene.add(camera);

    // 天空穹顶（渐变，高清）+ 地平线雾带 + 太阳光晕
    const skyTex = new THREE.CanvasTexture(makeCanvas(1024, 512, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#3f7fc0');
      grad.addColorStop(0.32, '#6fafe0');
      grad.addColorStop(0.5, '#a5d2ea');
      grad.addColorStop(0.62, '#d8e6ea');
      grad.addColorStop(0.72, '#f0e8d4');
      grad.addColorStop(1, '#e6d9ba');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      // 地平线附近的淡雾带（柔和过渡）
      const haze = g.createLinearGradient(0, h * 0.6, 0, h);
      haze.addColorStop(0, 'rgba(255,255,255,0)');
      haze.addColorStop(0.45, 'rgba(255,250,235,0.22)');
      haze.addColorStop(1, 'rgba(255,248,228,0)');
      g.fillStyle = haze;
      g.fillRect(0, 0, w, h);
    }));
    skyTex.colorSpace = THREE.SRGBColorSpace;
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(210, 24, 16),
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
    initSkyClouds();

    // 灯光：半球光提亮 + 太阳 + 冷色补光（提升背光面层次）
    const hemi = new THREE.HemisphereLight(0xd7eaf5, 0xa08f70, 1.35);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff4d8, 3.1);
    sun.position.set(38, 55, -30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048); // 1024→2048：阴影细节翻倍
    sun.shadow.camera.left = -50; sun.shadow.camera.right = 50;
    sun.shadow.camera.top = 50; sun.shadow.camera.bottom = -50;
    sun.shadow.camera.far = 160;
    sun.shadow.bias = -0.0006;
    sun.shadow.radius = 3; // PCFSoft 边缘再柔化
    scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9db8d8, 0.55); // 无阴影冷补光：暗部不发死
    fill.position.set(-30, 20, 40);
    scene.add(fill);

    buildMap();
    buildPools();
    initSmoke();
    initPost();
    Ragdoll.init(scene);
    window.addEventListener('resize', onResize);
    onResize();
  }

  // ---------- 天空云朵（billboard 云彩，缓慢漂移） ----------
  const skyCloudPool = [];
  function initSkyClouds() {
    const tex = new THREE.CanvasTexture(makeCanvas(256, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 42; i++) {
        const px = w * (0.12 + 0.76 * (((i * 53 + 3) % 97) / 97));
        const py = h * (0.2 + 0.6 * (((i * 31 + 7) % 89) / 89));
        const pr = (6 + ((i * 37) % 18)) * 1.6;
        const al = 0.05 + ((i * 29) % 10) / 10 * 0.14;
        const gr = g.createRadialGradient(px, py, pr * 0.1, px, py, pr);
        gr.addColorStop(0, `rgba(255,255,255,${al})`);
        gr.addColorStop(0.6, `rgba(244,248,252,${al * 0.8})`);
        gr.addColorStop(1, 'rgba(240,244,248,0)');
        g.fillStyle = gr;
        g.beginPath(); g.ellipse(px, py, pr, pr * 0.62, 0, 0, Math.PI * 2); g.fill();
      }
    }));
    tex.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0.5 + (i % 3) * 0.09,
        depthWrite: false, fog: false
      }));
      const a = i * 1.05;
      sp.position.set(Math.cos(a) * 165, 85 + (i % 4) * 14, Math.sin(a) * 165);
      sp.scale.set(80 + (i % 3) * 28, 30 + (i % 3) * 12, 1);
      sp.renderOrder = -5;
      scene.add(sp);
      skyCloudPool.push(sp);
    }
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
    const wMat = new THREE.MeshPhongMaterial({ map: wTex, shininess: 8, specular: 0x4a4438 }); // 微弱砖面高光
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
    const cMat = new THREE.MeshPhongMaterial({ map: cTex, shininess: 16, specular: 0x443a2a });
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
    const bagMat = new THREE.MeshPhongMaterial({ map: bagMap, shininess: 10, specular: 0x333333 });
    const blockMat = new THREE.MeshPhongMaterial({ color: 0x8d9299, shininess: 14, specular: 0x4a4f55 });
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
    addCoverMesh(talls, new THREE.BoxGeometry(1, 1, 1), blockMat); // 高过人掩体（2.2m 混凝土墩）
    // 油桶单独实例化（可被打爆：单个实例变色/压扁）
    if (barrels.length) {
      const bMat = new THREE.MeshPhongMaterial({ color: 0xb34a3a, vertexColors: true, shininess: 32, specular: 0x6a3a30 });
      barrelIMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 10), bMat, barrels.length);
      barrels.forEach((w, i) => {
        const dx = w.x2 - w.x1, dy = w.y2 - w.y1, dz = w.z2 - w.z1;
        m4.makeScale(Math.max(0.01, dx), dy, Math.max(0.01, dz));
        m4.setPosition((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2, (w.z1 + w.z2) / 2);
        barrelIMesh.setMatrixAt(i, m4);
        barrelIMesh.setColorAt(i, new THREE.Color(0xffffff));
      });
      barrelIMesh.castShadow = true;
      barrelIMesh.receiveShadow = true;
      barrelIMesh.instanceMatrix.needsUpdate = true;
      if (barrelIMesh.instanceColor) barrelIMesh.instanceColor.needsUpdate = true;
      scene.add(barrelIMesh);
      barrelList = barrels;
    }

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
    const doorMat = new THREE.MeshPhongMaterial({ color: 0x3e5240, shininess: 20, specular: 0x3a4438 });
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
      const shirt = new THREE.MeshPhongMaterial({ map: fabricTexture(), color: 0xe8e4da, shininess: 12, specular: 0x3a3a3a });
      const pants = new THREE.MeshPhongMaterial({ map: fabricTexture(), color: 0x4a5d7a, shininess: 12, specular: 0x2a2a2a });
      const skin = new THREE.MeshPhongMaterial({ color: 0xd9a87c, shininess: 22, specular: 0x3a3a3a });
      const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.72, 8), pants);
      legL.position.set(-0.1, 0.36, 0);
      const legR = legL.clone(); legR.position.x = 0.1;
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.19, 0.66, 12), shirt);
      torso.position.set(0, 1.02, 0);
      torso.scale.z = 0.62;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), skin);
      head.position.set(0, 1.52, 0);
      head.scale.y = 1.08;
      // 举起的双手（人质经典姿势）
      const armL = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.5, 8), shirt);
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
      new THREE.MeshPhongMaterial({ color: 0x4a5540, shininess: 14, specular: 0x3a4438 }));
    body.position.y = 0.33;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.1, 0.79),
      new THREE.MeshPhongMaterial({ color: 0x5d6b4e, shininess: 18, specular: 0x44503c }));
    lid.position.y = 0.71;
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.09, 0.1),
      new THREE.MeshPhongMaterial({ color: 0x2e352a, shininess: 10, specular: 0x2a2a2a }));
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

  // ---------- C4 炸药包（场上模型：掉落/安放后可见，安放后红灯闪烁） ----------
  let bombGroup = null;
  let bombLed = null;
  let bombPlanted = false;
  // ---------- 油桶（可被打爆：爆炸后焦黑压扁，回合重置） ----------
  let barrelIMesh = null;
  let barrelList = [];
  function barrelDestroyed(id) {
    if (!barrelIMesh || !barrelList[id]) return;
    const w = barrelList[id];
    const m = new THREE.Matrix4();
    m.makeScale(0.72, 0.8, 0.72); // 炸后残骸：压扁
    m.setPosition((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2 * 0.8, (w.z1 + w.z2) / 2);
    barrelIMesh.setMatrixAt(id, m);
    barrelIMesh.setColorAt(id, new THREE.Color(0x1c1c1c)); // 焦黑
    barrelIMesh.instanceMatrix.needsUpdate = true;
    if (barrelIMesh.instanceColor) barrelIMesh.instanceColor.needsUpdate = true;
  }
  function resetBarrels() {
    if (!barrelIMesh) return;
    const m = new THREE.Matrix4();
    barrelList.forEach((w, i) => {
      const dx = w.x2 - w.x1, dy = w.y2 - w.y1, dz = w.z2 - w.z1;
      m.makeScale(Math.max(0.01, dx), dy, Math.max(0.01, dz));
      m.setPosition((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2, (w.z1 + w.z2) / 2);
      barrelIMesh.setMatrixAt(i, m);
      barrelIMesh.setColorAt(i, new THREE.Color(0xffffff));
    });
    barrelIMesh.instanceMatrix.needsUpdate = true;
    if (barrelIMesh.instanceColor) barrelIMesh.instanceColor.needsUpdate = true;
  }
  function buildBombModel() {
    const g = new THREE.Group();
    // 军绿色炸药砖（CS 经典配色）
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.34),
      new THREE.MeshPhongMaterial({ color: 0x4d5536, shininess: 14, specular: 0x3a4430 }));
    body.position.y = 0.15;
    g.add(body);
    // 顶部键盘面板
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.26),
      new THREE.MeshPhongMaterial({ color: 0x2a2f2c, shininess: 25, specular: 0x444a48 }));
    pad.position.y = 0.31;
    g.add(pad);
    // 面板按键条
    const keys = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.014, 0.11),
      new THREE.MeshPhongMaterial({ color: 0x9aa06e, shininess: 10, specular: 0x333333 }));
    keys.position.set(-0.02, 0.345, 0);
    g.add(keys);
    // 红色指示灯（安放后闪烁）
    bombLed = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    bombLed.position.set(0.18, 0.35, 0);
    g.add(bombLed);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.visible = false;
    scene.add(g);
    bombGroup = g;
    return g;
  }
  function updateBomb(b) {
    const st = b ? b[0] : 'hidden';
    if (st === 'planted' || st === 'dropped') {
      if (!bombGroup) buildBombModel();
      bombGroup.visible = true;
      bombGroup.position.set(b[1], (b[2] || 0) + 0.001, b[3]);
      bombPlanted = st === 'planted';
    } else {
      if (bombGroup) bombGroup.visible = false;
      bombPlanted = false;
    }
  }

  // ---------- 烟雾弹烟团 ----------
  // 分层结构（同时解决"外面看不到里面"与"里面看不到外面"，且不再是一颗硬球）：
  //  1) 内壁烟球（BackSide）：站在烟里时四周是翻滚的灰烟墙；从外面看则盖住烟团后的一切背景
  //  2) 云絮精灵（billboard）：核心体积 + 贴球面的边缘絮，遮住球体硬边，随帧旋转/漂移/脉动
  //  3) 相机前烟絮板（depthTest=false）：站在烟里时镜头前持续飘动的烟，配合指数雾化远
  //  4) 烟内指数雾（FogExp2）：按"离烟团中心越近越浓"逐帧平滑，远处世界溶入烟色
  const baseFog = new THREE.Fog(0xa9c9d8, 55, 170);
  const smokeFog = new THREE.FogExp2(0xaab0b6, 0);
  const SMOKE_MAX = 8;           // 同屏烟团上限
  const SMOKE_CORE = 8;          // 每团核心云絮
  const SMOKE_EDGE = 9;          // 每团边缘云絮（贴球面遮硬边）
  const smokeState = [];         // 最新快照 [{x,y,z,r,life}]
  const smokeGhosts = [];        // 已从快照移除的烟团：继续淡出（避免突然消失）
  const smokeWallPool = [];      // 内壁烟球（BackSide）
  const smokeShellPool = [];     // 外壳烟球（FrontSide，r×1.0）：从外面盖住烟内的人
  const smokeShell2Pool = [];    // 内壳烟球（FrontSide，r×0.8）：第二层，增加烟团厚度与层次
  const smokePool = [];          // 云絮精灵
  const smokeTexes = [];         // 两张烟絮贴图（交替使用增加变化）
  const camSmokePool = [];       // 相机前烟絮板
  let smokeClock = 0;            // 烟团动画时钟
  let smokeStrength = 0;         // 相机在烟内的强度 0..1（逐帧平滑）

  function makeSmokeTex(seed, scale) {
    const t = new THREE.CanvasTexture(makeCanvas(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      // 数十团絮状云斑叠加 → 不规则的翻滚云团
      for (let i = 0; i < 30; i++) {
        const a = i * 2.399 + seed;
        const px = w / 2 + Math.sin(a) * w * 0.36;
        const py = h / 2 + Math.cos(a * 1.7 + seed) * h * 0.36;
        const pr = (5 + ((i * 37 + seed * 17) % 22)) * scale;
        const al = 0.06 + ((i * 29 + seed * 13) % 10) / 10 * 0.16;
        const gr = g.createRadialGradient(px, py, pr * 0.05, px, py, pr);
        gr.addColorStop(0, `rgba(222,225,229,${al})`);
        gr.addColorStop(0.55, `rgba(196,201,207,${al * 0.8})`);
        gr.addColorStop(1, 'rgba(178,184,191,0)');
        g.fillStyle = gr;
        g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
      }
    }));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // 致密云贴图：alpha 整体近 1、仅上下（球极）渐隐 —— 用于烟墙/外壳球面。
  // 注意：球面 UV 铺满整张贴图，不能在贴图内做径向衰减（否则球面会出现大片透明带）
  function makeCloudTex(seed) {
    const t = new THREE.CanvasTexture(makeCanvas(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      // 基底：上下（球极方向）渐隐，中间高 alpha
      const base = g.createLinearGradient(0, 0, 0, h);
      base.addColorStop(0, 'rgba(190,196,202,0.12)');
      base.addColorStop(0.18, 'rgba(212,217,221,0.9)');
      base.addColorStop(0.5, 'rgba(216,220,224,0.97)');
      base.addColorStop(0.82, 'rgba(212,217,221,0.9)');
      base.addColorStop(1, 'rgba(190,196,202,0.12)');
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      // 亮斑/暗斑：打破均匀感
      for (let i = 0; i < 40; i++) {
        const px = w * (((i * 53 + seed * 29) % 97) / 97);
        const py = h * (((i * 31 + seed * 17) % 89) / 89);
        const pr = 6 + ((i * 37 + seed * 13) % 22);
        const al = 0.10 + ((i * 29 + seed * 7) % 10) / 10 * 0.18;
        const dark = i % 3 === 0;
        const gr = g.createRadialGradient(px, py, pr * 0.1, px, py, pr);
        gr.addColorStop(0, dark ? `rgba(138,145,151,${al})` : `rgba(232,236,240,${al})`);
        gr.addColorStop(0.6, dark ? `rgba(150,157,163,${al * 0.7})` : `rgba(216,221,226,${al * 0.7})`);
        gr.addColorStop(1, 'rgba(200,205,210,0)');
        g.fillStyle = gr;
        g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
      }
    }));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function initSmoke() {
    smokeTexes.push(makeSmokeTex(1, 1), makeSmokeTex(6.5, 0.7));
    const wallTex = makeCloudTex(2);
    const shellTex = makeCloudTex(9);
    const shellTex2 = makeCloudTex(5);
    // 内壁烟球：BackSide + 不写深度 → 透明烟墙（相机在球内也必须渲染）。
    // 用 MeshBasic：烟雾不受光照方向影响，烟内看是稳定的灰墙（Lambert 会被半球光染成土色）
    for (let i = 0; i < SMOKE_MAX; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: wallTex, color: 0xcfd4d9, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.BackSide
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      smokeWallPool.push(mesh);
    }
    // 外壳烟球（FrontSide）：从外面看是烟团前表面，半透明盖住烟内的人；
    // 站在烟内时 FrontSide 面被剔除（不渲染），不影响烟内视界
    for (let i = 0; i < SMOKE_MAX; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: shellTex, color: 0xcfd4d9, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.FrontSide
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      smokeShellPool.push(mesh);
    }
    // 内壳烟球（FrontSide，r×0.8）：与外壳反向旋转，两层纹理叠出体积感
    for (let i = 0; i < SMOKE_MAX; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: shellTex2, color: 0xcfd4d9, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.FrontSide
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 12), mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      smokeShell2Pool.push(mesh);
    }
    // 云絮精灵
    const total = SMOKE_MAX * (SMOKE_CORE + SMOKE_EDGE);
    for (let i = 0; i < total; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smokeTexes[i % 2], transparent: true, opacity: 0, depthWrite: false
      }));
      sp.visible = false;
      scene.add(sp);
      smokePool.push(sp);
    }
    // 相机前烟絮板（烟内镜头雾气，叠加在画面上层）
    for (let i = 0; i < 4; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: smokeTexes[i % 2], transparent: true, opacity: 0,
        depthTest: false, depthWrite: false, fog: false
      });
      const q = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      q.visible = false;
      q.renderOrder = 990;
      camera.add(q);
      camSmokePool.push(q);
    }
  }

  // 快照更新（30Hz）：只记录状态，逐帧动画在 animateSmokes 里做（帧间平滑）。
  // 从快照消失的烟团转入 ghost 列表，1.2 秒内淡出（避免烟团突然消失）
  function updateSmokes(list) {
    const now = performance.now();
    for (const old of smokeState) {
      let still = false;
      for (const s of list) {
        if (Math.hypot(s[0] - old.x, s[2] - old.z) < 2) { still = true; break; }
      }
      if (!still) smokeGhosts.push({ x: old.x, y: old.y, z: old.z, r: old.r, life: old.life, t0: now });
    }
    smokeState.length = 0;
    for (const s of list) {
      smokeState.push({
        x: s[0], y: s[1], z: s[2],
        r: Math.max(0.6, s[3]),
        life: s[4] === undefined ? 1 : Math.max(0, s[4])
      });
    }
  }

  // 逐帧动画：烟团翻滚 + 烟内雾效（renderFrame 调用）
  function animateSmokes(dt) {
    smokeClock += dt;
    // —— 相机在烟内的强度：越靠烟团中心越浓（离中心 80% 以上基本能看出去）——
    let target = 0;
    for (const s of smokeState) {
      const d = Math.hypot(camera.position.x - s.x, camera.position.z - s.z);
      if (d < s.r) {
        const t = 1 - (d / s.r) * (d / s.r);
        target = Math.max(target, Math.pow(t, 0.8) * s.life);
      }
    }
    smokeStrength += (target - smokeStrength) * Math.min(1, dt * 4);
    // —— 烟内指数雾：远处世界溶入烟色；离开烟团后恢复普通雾 ——
    if (smokeStrength > 0.03) {
      smokeFog.density = 0.55 * smokeStrength;
      if (scene.fog !== smokeFog) scene.fog = smokeFog;
    } else if (scene.fog !== baseFog) {
      scene.fog = baseFog;
    }

    // —— 烟团本体（含正在淡出的 ghost 烟团）——
    const nowT = performance.now();
    for (let i = smokeGhosts.length - 1; i >= 0; i--) {
      if (nowT - smokeGhosts[i].t0 > 1500) smokeGhosts.splice(i, 1);
    }
    const renderList = [];
    // 全程全浓：只在生命最后 15% 快速消散（不再随生命线性变淡）；
    // 扩散初期按半径快速拉满浓度（1.2m 起 50%，半径 2.7m 时全浓）
    for (const s of smokeState) renderList.push({
      s,
      fade: Math.min(1, s.life / 0.15) * Math.min(1, Math.max(0.5, (s.r - 1.2) / 1.5))
    });
    for (const g of smokeGhosts) {
      const f = Math.max(0, 1 - (nowT - g.t0) / 1200);
      if (f > 0.02) renderList.push({ s: g, fade: f });
    }
    let si = 0, wi = 0, hi = 0;
    for (let gi = 0; gi < renderList.length && gi < SMOKE_MAX; gi++) {
      const s = renderList[gi].s;
      const r = s.r, fade = renderList[gi].fade;
      const yc = s.y + 0.6;
      // 内壁烟墙（全不透明：烟内完全看不到外面）
      if (wi < smokeWallPool.length) {
        const wl = smokeWallPool[wi++];
        wl.visible = true;
        wl.position.set(s.x, yc, s.z);
        wl.scale.setScalar(r * 0.95);
        wl.material.opacity = 1.0 * fade;
        wl.rotation.y = smokeClock * 0.05 + gi; // 烟墙缓慢旋转 → 表面纹理流动
      }
      // 外壳（FrontSide，r×1.0）：从外面完全盖住烟内的人，站在烟内时自动不渲染
      if (hi < smokeShellPool.length) {
        const shl = smokeShellPool[hi++];
        shl.visible = true;
        shl.position.set(s.x, yc, s.z);
        shl.scale.setScalar(r * 1.0);
        shl.material.opacity = 1.0 * fade;
        shl.rotation.y = -smokeClock * 0.04 + gi * 1.3;
      }
      // 内壳（FrontSide，r×0.8）：第二层烟面，反方向旋转 → 双层纹理叠出厚度
      if (hi < smokeShell2Pool.length) {
        const sh2 = smokeShell2Pool[hi - 1];
        sh2.visible = true;
        sh2.position.set(s.x, yc, s.z);
        sh2.scale.setScalar(r * 0.8);
        sh2.material.opacity = 0.98 * fade;
        sh2.rotation.y = smokeClock * 0.06 + gi * 2.1;
      }
      // 核心云絮：绕烟团翻滚
      for (let k = 0; k < SMOKE_CORE; k++) {
        if (si >= smokePool.length) break;
        const sp = smokePool[si++];
        sp.visible = true;
        const a = gi * 2.399 + k * 2.094;
        const rad = r * (0.3 + 0.65 * (((k * 5 + gi * 3) % 7) / 7));
        const orb = smokeClock * 0.14 * (k % 2 ? 1 : -1);
        sp.position.set(
          s.x + Math.cos(a + orb) * rad,
          yc - r * 0.15 + (((k * 3 + gi) % 8) / 8) * r * 0.75 + Math.sin(smokeClock * 0.6 + k * 1.7 + gi) * 0.3,
          s.z + Math.sin(a + orb) * rad
        );
        const sc = r * (0.5 + ((k * 7 + gi) % 5) * 0.12);
        sp.scale.set(sc, sc, 1);
        sp.material.opacity = (0.26 + ((k * 3 + gi) % 4) * 0.05) * fade;
        sp.material.rotation = smokeClock * 0.07 * (k % 2 ? 1 : -1);
      }
      // 边缘云絮：贴球面起伏 → 遮住球体硬边，形成云朵外缘
      for (let k = 0; k < SMOKE_EDGE; k++) {
        if (si >= smokePool.length) break;
        const sp = smokePool[si++];
        sp.visible = true;
        const a = gi * 1.7 + k * 0.698; // 9 个绕球面均匀分布
        sp.position.set(
          s.x + Math.cos(a) * r * 0.96,
          yc + Math.sin(k * 2.3 + smokeClock * 0.25 + gi) * r * 0.5,
          s.z + Math.sin(a) * r * 0.96
        );
        const sc = r * 0.85;
        sp.scale.set(sc, sc, 1);
        sp.material.opacity = 0.52 * fade;
        sp.material.rotation = -smokeClock * 0.09 + k;
      }
    }
    const usedWalls = Math.min(renderList.length, smokeWallPool.length);
    for (let i = usedWalls; i < smokeWallPool.length; i++) smokeWallPool[i].visible = false;
    for (let i = usedWalls; i < smokeShellPool.length; i++) smokeShellPool[i].visible = false;
    for (let i = usedWalls; i < smokeShell2Pool.length; i++) smokeShell2Pool[i].visible = false;
    for (; si < smokePool.length; si++) smokePool[si].visible = false;

    // —— 相机前烟絮板：烟内镜头前飘动的烟 ——
    const st = Math.min(1, smokeStrength);
    for (let i = 0; i < camSmokePool.length; i++) {
      const q = camSmokePool[i];
      if (st < 0.05) { q.visible = false; continue; }
      q.visible = true;
      const ph = smokeClock * (0.12 + i * 0.035) + i * 2.4;
      q.position.set(
        (i % 2 ? 0.55 : -0.5) * Math.sin(ph * 0.6),
        (i % 3 ? -0.32 : 0.4) + Math.sin(ph) * 0.22,
        -1.0 - i * 1.1
      );
      const scl = 4.2 + i * 2.0;
      q.scale.set(scl, scl, 1);
      q.material.opacity = st * (0.45 - i * 0.07);
      q.material.rotation = ph * 0.16;
    }
  }

  // ---------- 后期管线：SSAO（环境光遮蔽）+ FXAA（抗锯齿） ----------
  // 场景先渲染到带深度纹理的 RT，再用全屏 ShaderMaterial 合成：
  // 深度重建视空间位置 → dFdx/dFdy 求法线 → 10 向采样 SSAO → FXAA 去锯齿 → 输出
  let postRT = null, postScene = null, postMat = null;
  const _postSize = new THREE.Vector2();
  function initPost() {
    renderer.getDrawingBufferSize(_postSize);
    postRT = new THREE.WebGLRenderTarget(_postSize.x, _postSize.y, {
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(_postSize.x, _postSize.y)
    });
    postMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: postRT.texture },
        tDepth: { value: postRT.depthTexture },
        uResolution: { value: new THREE.Vector2(_postSize.x, _postSize.y) },
        uProjInv: { value: new THREE.Matrix4() },
        uAORadius: { value: 0.016 },   // UV 半径（≈20px@1280）
        uAOIntensity: { value: 1.1 },  // 遮蔽强度（低=自然）
        uAOBias: { value: 0.03 },      // 深度偏移，抑制自遮蔽
        uL2S: { value: 1 }             // 三 r160 渲染到 RT 是线性值，输出前转 sRGB
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec2 uResolution;
        uniform mat4 uProjInv;
        uniform float uAORadius;
        uniform float uAOIntensity;
        uniform float uAOBias;
        uniform float uL2S; // 1 = RT 为线性，输出前转 sRGB

        vec3 linearToSrgb(vec3 c) {
          vec3 lo = c * 12.92;
          vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
          return mix(hi, lo, lessThanEqual(c, vec3(0.0031308)));
        }

        float hash2(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

        vec3 viewPosFromDepth(vec2 uv) {
          float z = texture2D(tDepth, uv).x;
          vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
          return p.xyz / p.w;
        }

        const vec2 KERNEL[10] = vec2[10](
          vec2( 0.13,  0.46), vec2(-0.33, -0.28), vec2( 0.44, -0.08), vec2(-0.18,  0.54),
          vec2( 0.07, -0.66), vec2(-0.56, -0.22), vec2( 0.60,  0.29), vec2(-0.63,  0.35),
          vec2( 0.28,  0.74), vec2(-0.83,  0.06)
        );

        float calcAO(vec2 uv, vec3 pos, vec3 nrm) {
          float a = hash2(uv) * 6.28318;
          mat2 rot = mat2(cos(a), sin(a), -sin(a), cos(a));
          float occ = 0.0;
          for (int i = 0; i < 10; i++) {
            vec2 dir = rot * KERNEL[i] * uAORadius;
            vec3 tpos = viewPosFromDepth(uv + dir);
            vec3 diff = tpos - pos;
            float dist2 = dot(diff, diff);
            float v = max(0.0, dot(nrm, diff) - uAOBias) / (1.0 + dist2 * 0.12);
            occ += v;
          }
          return clamp(1.0 - occ * (uAOIntensity / 10.0), 0.0, 1.0);
        }

        vec3 fxaa(sampler2D tex, vec2 uv, vec2 rcp) {
          vec3 rgbNW = texture2D(tex, uv + vec2(-1.0, -1.0) * rcp).rgb;
          vec3 rgbNE = texture2D(tex, uv + vec2( 1.0, -1.0) * rcp).rgb;
          vec3 rgbSW = texture2D(tex, uv + vec2(-1.0,  1.0) * rcp).rgb;
          vec3 rgbSE = texture2D(tex, uv + vec2( 1.0,  1.0) * rcp).rgb;
          vec3 rgbM  = texture2D(tex, uv).rgb;
          vec3 w = vec3(0.299, 0.587, 0.114);
          float lNW = dot(rgbNW, w), lNE = dot(rgbNE, w);
          float lSW = dot(rgbSW, w), lSE = dot(rgbSE, w), lM = dot(rgbM, w);
          float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
          float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
          vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
          float dirReduce = max((lNW + lNE + lSW + lSE) * 0.03125, 1e-4);
          float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
          dir = clamp(dir * rcpDirMin, vec2(-8.0), vec2(8.0)) * rcp;
          vec3 rgbA = 0.5 * (texture2D(tex, uv + dir * (1.0 / 3.0 - 0.5)).rgb
                           + texture2D(tex, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
          vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tex, uv + dir * -0.5).rgb
                                         + texture2D(tex, uv + dir * 0.5).rgb);
          float lB = dot(rgbB, w);
          return ((lB < lMin) || (lB > lMax)) ? rgbA : rgbB;
        }

        void main() {
          vec3 color = texture2D(tDiffuse, vUv).rgb;
          color = fxaa(tDiffuse, vUv, 1.0 / uResolution);
          float z = texture2D(tDepth, vUv).x;
          float ao = 1.0;
          if (z < 0.999) {
            vec3 pos = viewPosFromDepth(vUv);
            // 深度梯度叉积得到的法线指向背离相机方向，取反 → 朝向相机
            vec3 nrm = -normalize(cross(dFdx(pos), dFdy(pos)) + vec3(1e-5));
            ao = calcAO(vUv, pos, nrm);
          }
          color *= ao;
          color = mix(color, linearToSrgb(color), uL2S);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false
    });
    postMat.extensions = { derivatives: true };
    postScene = new THREE.Scene();
    const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat);
    quad.frustumCulled = false;
    postScene.add(quad);
    postScene.userData.cam = postCam;
  }
  function resizePost() {
    if (!postRT) return;
    renderer.getDrawingBufferSize(_postSize);
    postRT.setSize(_postSize.x, _postSize.y);
    postMat.uniforms.uResolution.value.set(_postSize.x, _postSize.y);
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
    resizePost();
  }

  // ---------- 画质档位（自动降档：低档关闭阴影投影 + 像素比降到 1） ----------
  let lowQuality = false;
  function setQuality(low) {
    if (low === lowQuality) return;
    lowQuality = low;
    renderer.shadowMap.enabled = !low;
    renderer.shadowMap.needsUpdate = true;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, low ? 1 : 2));
    onResize();
  }

  // ---------- 玩家模型 ----------
  const thirdGunCache = new Map(); // weaponId -> Group（第三人称武器模型缓存）
  // 枪械材质只创建一次（修复：原实现每把枪新建 4 个带纹理材质 → 100+ 纹理）；Phong 高光突出金属感
  const GUN_TDARK = new THREE.MeshPhongMaterial({ map: gunMetalTexture(), color: 0x9aa0aa, shininess: 45, specular: 0x6a7280 });
  const GUN_TMETAL = new THREE.MeshPhongMaterial({ map: gunMetalTexture(), color: 0xc2c8d0, shininess: 85, specular: 0x9aa4b2 });
  const GUN_TPOLY = new THREE.MeshPhongMaterial({ color: 0x23262b, shininess: 25, specular: 0x33373d });
  const GUN_TWOOD = new THREE.MeshPhongMaterial({ map: gunWoodTexture(), color: 0xc8a070, shininess: 18, specular: 0x4a3a28 });

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
    // 握持位：挂在胸前枪枢轴（buildPlayerModel 的 gunHold）上
    g.position.set(0, 0, 0);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    thirdGunCache.set(id, g);
    return g;
  }

  // 布纹噪声贴图（中性灰，颜色由材质 color 乘出 → 布料质感）
  let fabricTex = null;
  function fabricTexture() {
    if (fabricTex) return fabricTex;
    const c = makeCanvas(64, 64, (g, w, h) => {
      g.fillStyle = '#b8b8b8'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1100; i++) {
        const v = 90 + Math.random() * 140 | 0;
        g.fillStyle = `rgba(${v},${v},${v},${0.2 + Math.random() * 0.3})`;
        g.fillRect(Math.random() * w, Math.random() * h, 1.2, 1.2);
      }
      g.strokeStyle = 'rgba(0,0,0,0.10)';
      for (let y = 0; y < h; y += 4) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
      for (let x = 0; x < w; x += 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    applyAniso(t);
    fabricTex = t;
    return t;
  }

  function buildPlayerModel(team) {
    const g = new THREE.Group();
    // Phong + 布纹：皮肤/布料带细微高光与织物颗粒
    const skin = new THREE.MeshPhongMaterial({ color: 0xd9a87c, shininess: 22, specular: 0x3a3a3a });
    const teamCol = team === GAMECONST.TEAM_T ? 0xc87f3a : 0x4f78a4;
    const cloth = new THREE.MeshPhongMaterial({ map: fabricTexture(), color: teamCol, shininess: 12, specular: 0x2a2a2a });
    const dark = new THREE.MeshPhongMaterial({ map: fabricTexture(), color: team === GAMECONST.TEAM_T ? 0x8a5a28 : 0x35506e, shininess: 12, specular: 0x2a2a2a });
    const boot = new THREE.MeshPhongMaterial({ color: 0x2e2a24, shininess: 18, specular: 0x3a3a3a });

    // 两段式腿：髋部枢轴 + 大腿 + 膝部枢轴 + 小腿 + 靴子（走路带膝弯）
    function makeLeg(x) {
      const hip = new THREE.Group();
      hip.position.set(x, 0.73, 0);
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.34, 8), dark);
      thigh.position.y = -0.15;
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.32;
      hip.add(knee);
      const calf = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.3, 8), dark);
      calf.position.y = -0.17;
      knee.add(calf);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.16, 8), boot);
      foot.position.set(0, -0.36, 0.05);
      foot.rotation.x = Math.PI / 2; // 圆柱横放 → 靴子朝前
      knee.add(foot);
      g.add(hip);
      return { hip, knee };
    }
    const legL = makeLeg(-0.1);
    const legR = makeLeg(0.1);
    // 躯干（椭圆柱）+ 脖子 + 头
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.2, 0.66, 12), cloth);
    torso.position.set(0, 1.02, 0);
    torso.scale.z = 0.62; // 侧面压薄，接近原盒型厚度
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8), skin);
    neck.position.y = 1.36;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), skin);
    head.position.set(0, 1.52, 0);
    head.scale.y = 1.08;
    // 手臂：肩部枢轴（从肩关节摆动）+ 上臂圆柱（深色衣袖，与躯干区分）+ 手
    function makeArm(x) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.33, 0.06);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.058, 0.46, 8), dark);
      upper.position.y = -0.21;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), skin);
      hand.position.y = -0.45;
      pivot.add(upper, hand);
      g.add(pivot);
      return pivot;
    }
    const armL = makeArm(-0.3);
    const armR = makeArm(0.3);
    // 团队造型：T 系头巾，CT 戴便帽（买头盔后便帽隐藏、头巾保留）
    const bandMat = team === GAMECONST.TEAM_T
      ? new THREE.MeshPhongMaterial({ color: 0x3a2c1c, shininess: 10, specular: 0x2a2a2a })
      : new THREE.MeshPhongMaterial({ color: 0x2c4666, shininess: 14, specular: 0x3a4a5a });
    let cap = null, headband = null;
    if (team === GAMECONST.TEAM_T) {
      headband = new THREE.Mesh(new THREE.TorusGeometry(0.125, 0.022, 6, 14), bandMat);
      headband.position.set(0, 1.5, 0);
      headband.rotation.x = Math.PI / 2;
      g.add(headband);
    } else {
      cap = new THREE.Group();
      const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.14, 0.07, 12), bandMat);
      capTop.position.y = 0.05;
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.015, 0.15), bandMat);
      brim.position.set(0, 0.015, 0.15);
      cap.add(capTop, brim);
      cap.position.set(0, 1.6, 0);
      g.add(cap);
    }
    // 防弹衣背心与头盔（默认隐藏，购买后显示）
    const kevlarMat = new THREE.MeshPhongMaterial({ color: 0x4a5246, shininess: 32, specular: 0x4a5450 });
    const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.68, 12), kevlarMat);
    vest.position.set(0, 1.03, 0);
    vest.scale.z = 0.62;
    vest.visible = false;
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.145, 12, 8), kevlarMat);
    helm.position.set(0, 1.6, 0);
    helm.scale.y = 0.85;
    helm.visible = false;
    // 持枪枢轴：枪挂在胸前，随手臂摆动与躯干起伏轻微晃动（像握在手上）
    const gunHold = new THREE.Group();
    gunHold.position.set(0, 1.14, 0.26);
    g.add(gunHold);

    // 脸：两个小眼睛（头部前侧 +z，与枪/帽檐同向）
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x241a12 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5), eyeMat);
    eyeL.position.set(-0.045, 1.545, 0.108);
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 5), eyeMat);
    eyeR.position.set(0.045, 1.545, 0.108);
    g.add(eyeL, eyeR);

    g.add(torso, neck, head, vest, helm);
    g.userData = {
      legL: legL.hip, legR: legR.hip, kneeL: legL.knee, kneeR: legR.knee,
      armL, armR, torso, head, vest, helm, cap, headband, gunHold,
      walkPhase: 0, dead: 0
    };
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

  function updatePlayers(list, myId, hideId) {
    for (const [id, m] of playerMeshes) {
      if (!list.has(id)) m.group.visible = false;
    }
    list.forEach(p => {
      const m = ensurePlayer(p.id, p.team);
      // 死亡/复活簿记优先（即使被烟雾/观战隐藏，尸体与舔包流程不能断）
      if (!p.alive) {
        if (m.wasAlive) {
          m.wasAlive = false;
          Ragdoll.spawn(p.id, p.x, p.y, p.z, p.yaw, p.team, p.armor, p.helmet);
        }
        m.group.visible = false; // 尸体由布娃娃物理呈现
        return;
      }
      if (!m.wasAlive) Ragdoll.removeFor(p.id); // 重生时清掉旧尸体
      m.wasAlive = true;
      m.deadAnim = 0;
      if (p.id === myId) { m.group.visible = false; return; } // 自己由第一人称视角呈现
      if (hideId && p.id === hideId) { m.group.visible = false; return; } // 观战目标：镜头在其体内，隐藏模型（否则看到帽檐/枪模）
      // 烟雾遮挡（彻底版）：烟里的人整体不渲染 → 外面看不到烟里；
      // 相机在烟内时所有人不渲染 → 烟里看不到外面（不再有"黑影子"）
      if (smokeState.length) {
        if (smokeStrength > 0.05) { m.group.visible = false; return; }
        let inSmoke = false;
        for (const s of smokeState) {
          if (Math.hypot(p.x - s.x, p.z - s.z) < s.r * 0.95) { inSmoke = true; break; }
        }
        if (inSmoke) { m.group.visible = false; return; }
      }
      const g = m.group;
      g.visible = true;
      // 同步第三人称持枪模型（按当前武器切换，挂在胸前枪枢轴上随身体晃动）
      const wid = p.weapon || '';
      if (m.gunWeapon !== wid) {
        if (m.gun) g.userData.gunHold.remove(m.gun);
        m.gun = buildThirdGun(wid);
        if (m.gun) g.userData.gunHold.add(m.gun);
        m.gunWeapon = wid;
      }
      {
        g.position.set(p.x, p.y, p.z);
        g.rotation.set(0, p.yaw, 0);
        const scale = p.crouch ? 0.72 : 1;
        g.scale.set(scale, scale, scale);
        // 护甲外观：有防弹衣显示背心，戴头盔显示头盔（CT 便帽被头盔盖住）
        const ud0 = g.userData;
        ud0.vest.visible = (p.armor || 0) > 0;
        ud0.helm.visible = !!p.helmet;
        if (ud0.cap) ud0.cap.visible = !p.helmet;
        const sp = Math.hypot(m.vel.x, m.vel.z);
        m.vel.x += (p.vx - m.vel.x) * 0.3; m.vel.z += (p.vz - m.vel.z) * 0.3;
        // 时间基准步态（帧率无关，约 2.9 步/秒）
        g.userData.walkPhase = performance.now() * 0.001 * (2.2 + sp * 1.35);
        const ph = g.userData.walkPhase;
        const swing = Math.sin(ph) * Math.min(0.7, sp * 0.22);
        const ud = g.userData;
        ud.legL.rotation.x = swing;
        ud.legR.rotation.x = -swing;
        // 膝弯：腿向前摆时小腿自然弯曲，向后摆时伸直
        ud.kneeL.rotation.x = Math.max(0, swing) * 0.6;
        ud.kneeR.rotation.x = Math.max(0, -swing) * 0.6;
        ud.armL.rotation.x = -swing * 0.45;
        ud.armR.rotation.x = swing * 0.45;
        // 走路躯干轻微起伏（腿从髋部摆，身体随步频上下颠）
        ud.torso.position.y = 1.02 + Math.abs(Math.sin(ph)) * 0.03;
        // 枪随手臂平均摆动与躯干起伏轻微晃动 → 像握在手上
        ud.gunHold.position.y = 1.14 + Math.abs(Math.sin(ph)) * 0.03;
        ud.gunHold.rotation.x = (ud.armL.rotation.x + ud.armR.rotation.x) * 0.12;
        // 受击踉跄（躯干后仰）
        if (m.flinch > 0) {
          m.flinch -= 0.14;
          ud.torso.rotation.x = Math.max(0, m.flinch) * 0.3;
        } else {
          ud.torso.rotation.x = 0;
        }
        // 跑动尘土
        m.dustT = (m.dustT || 0) - 1;
        if (sp > 3.3 && m.dustT <= 0) {
          m.dustT = 0.34;
          spawnBurst(p.x, p.y + 0.12, p.z, { count: 4, color: 0xc9b489, size: 0.05, speed: 0.8, life: 0.45, gravity: 0.7, upBias: 1.1 });
        }
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
    animateSmokes(dt);
    // 天空云朵缓慢漂移
    const cloudT = performance.now() / 1000;
    for (let i = 0; i < skyCloudPool.length; i++) {
      const cl = skyCloudPool[i];
      const rad = Math.hypot(cl.position.x, cl.position.z);
      const a = Math.atan2(cl.position.z, cl.position.x) + dt * 0.005 * (i % 2 ? 1 : -1);
      cl.position.x = Math.cos(a) * rad;
      cl.position.z = Math.sin(a) * rad;
      cl.position.y = 85 + (i % 4) * 14 + Math.sin(cloudT * 0.05 + i * 2.1) * 2.5;
    }
    // C4 指示灯：安放后约 2.2Hz 闪烁；掉落时熄灭
    if (bombGroup && bombGroup.visible && bombPlanted) {
      bombLed.visible = (performance.now() % 900) < 450;
    } else if (bombLed) bombLed.visible = false;
    // 渲染：高画质走后期管线（场景→RT→SSAO+FXAA 合成），低画质直接输出
    if (postRT && !lowQuality) {
      renderer.info.reset();
      renderer.setRenderTarget(postRT);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      postMat.uniforms.uProjInv.value.copy(camera.projectionMatrixInverse);
      renderer.render(postScene, postScene.userData.cam);
    } else {
      renderer.render(scene, camera);
    }
  }

  // 受击踉跄（他人命中时调用）
  function flinch(id) {
    const m = playerMeshes.get(id);
    if (m) m.flinch = 1;
  }

  function getCamera() { return camera; }

  return {
    init, renderFrame, updatePlayers, tracer, impact, muzzleFlash, shell, flashAt, explosion, getCamera, flinch, updateNades, updateSmokes, updateHostages, updateCrates, updateBomb, barrelDestroyed, resetBarrels, setQuality, _debugCrates,
    // 烟雾视界强度（main.js 用；测试用 _debugSmoke）
    smokeStrength: () => smokeStrength,
    // 测试辅助
    _debugTracerTotal: () => _tracerTotal,
    _debugDrawCalls: () => renderer.info.render.calls,
    _debugTriangles: () => renderer.info.render.triangles,
    _debugShadowOn: () => renderer.shadowMap.enabled,
    _debugSmoke: () => ({
      walls: smokeWallPool.filter(m => m.visible).length,
      shells: smokeShellPool.filter(m => m.visible).length,
      sprites: smokePool.filter(m => m.visible).length,
      strength: +smokeStrength.toFixed(2),
      fogDensity: scene.fog === smokeFog ? +smokeFog.density.toFixed(3) : 0
    }),
    _debugSmokeSpheres: () => smokeWallPool.filter(m => m.visible).length,
    _debugBomb: () => ({ visible: !!(bombGroup && bombGroup.visible), planted: bombPlanted }),
    _debugBombLed: () => !!(bombLed && bombLed.visible),
    _debugBarrel: (i) => {
      if (!barrelIMesh) return null;
      const c = new THREE.Color();
      barrelIMesh.getColorAt(i, c);
      const m = new THREE.Matrix4();
      barrelIMesh.getMatrixAt(i, m);
      return { r: +c.r.toFixed(2), g: +c.g.toFixed(2), scaleX: +m.elements[0].toFixed(2), posY: +m.elements[13].toFixed(2) };
    },
    _debugPost: () => ({ on: !!postRT, active: !!(postRT && !lowQuality) }),
    _debugSetL2S: (v) => { if (postMat) postMat.uniforms.uL2S.value = v ? 1 : 0; return v; },
    // 玩家头部结构诊断（守护"头必须挂在人物组里"，曾漏 add 导致无头）
    _debugPlayerHeads: () => {
      const out = [];
      for (const [id, m] of playerMeshes) {
        if (!m.group.visible) continue;
        let hasHead = false, headY = -1;
        for (const c of m.group.children) {
          if (c.geometry && c.geometry.type === 'SphereGeometry' && Math.abs(c.position.y - 1.52) < 0.01) {
            hasHead = true; headY = c.position.y;
          }
        }
        out.push({ id, hasHead, headY });
      }
      return out;
    },
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
