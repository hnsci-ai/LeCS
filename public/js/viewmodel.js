// public/js/viewmodel.js — 第一人称武器模型与动画
'use strict';
const VM = (function () {
  let group = null;
  let cur = null;        // {weapon, root, tip, kick, bobPhase}
  let muzzleStar = null; // 星芒火光
  let muzzleGlow = null; // 柔光
  let muzzleLight = null;
  // 程序化枪械材质（金属/木质纹理）
  function matTexture(base, grain) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = base; g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 480; i++) {
      const v = 20 + Math.random() * 40 | 0;
      g.fillStyle = `rgba(${v},${v + 4},${v + 8},0.15)`;
      g.fillRect(Math.random() * 64, Math.random() * 64, 1.4, 1.4);
    }
    if (grain) {
      for (let y = 0; y < 64; y += 4) {
        g.fillStyle = 'rgba(60,35,15,0.18)';
        g.fillRect(0, y, 64, 1.4);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  // 第一人称枪械材质：Phong 高光，金属/木纹更有质感
  const DARK = new THREE.MeshPhongMaterial({ map: matTexture('#22252a', false), color: 0xaab0b8, shininess: 45, specular: 0x6a7280 });
  const METAL = new THREE.MeshPhongMaterial({ map: matTexture('#3a3f46', false), color: 0xcdd2da, shininess: 90, specular: 0xaab4c0 });
  const WOOD = new THREE.MeshPhongMaterial({ map: matTexture('#7a5230', true), color: 0xd8b080, shininess: 18, specular: 0x4a3a28 });

  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  }

  // 枪口火光贴图：星芒 + 核心光球（canvas 生成）
  function flashTexture(soft) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.translate(64, 64);
    if (soft) {
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, 64);
      grad.addColorStop(0, 'rgba(255,240,200,0.95)');
      grad.addColorStop(0.35, 'rgba(255,200,110,0.55)');
      grad.addColorStop(1, 'rgba(255,140,40,0)');
      g.fillStyle = grad;
      g.beginPath(); g.arc(0, 0, 64, 0, Math.PI * 2); g.fill();
      return c;
    }
    // 4 长星芒 + 4 短星芒
    const spike = (len, w, color) => {
      g.fillStyle = color;
      for (let i = 0; i < 4; i++) {
        g.rotate(Math.PI / 2);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(-w, len * 0.22);
        g.lineTo(0, len);
        g.lineTo(w, len * 0.22);
        g.closePath();
        g.fill();
      }
    };
    spike(62, 9, 'rgba(255,190,90,0.95)');
    g.rotate(Math.PI / 4);
    spike(36, 6, 'rgba(255,235,180,0.95)');
    g.rotate(-Math.PI / 4);
    // 核心
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 28);
    grad.addColorStop(0, 'rgba(255,255,245,1)');
    grad.addColorStop(0.45, 'rgba(255,215,130,0.95)');
    grad.addColorStop(1, 'rgba(255,150,50,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(0, 0, 28, 0, Math.PI * 2); g.fill();
    return c;
  }

  function build(id) {
    const root = new THREE.Group();
    let tip = { x: 0, y: 0.03, z: -0.55 };
    let boltMesh = null; // 拉栓件（有则支持拉栓动画）
    let trail = null;    // 刃光弧（匕首挥砍轨迹）
    const add = (m) => root.add(m);
    switch (id) {
      case 'ak47': {
        add(box(0.05, 0.07, 0.34, METAL, 0, 0.02, -0.18));     // 机匣
        add(box(0.045, 0.075, 0.16, WOOD, 0, 0.015, 0.08));    // 枪托
        add(box(0.04, 0.11, 0.05, METAL, 0, -0.06, -0.16));    // 弯弹匣
        add(box(0.028, 0.028, 0.24, DARK, 0, 0.045, -0.42));   // 枪管
        add(box(0.018, 0.05, 0.014, DARK, 0, 0.085, -0.5));    // 准星
        add(box(0.05, 0.035, 0.09, WOOD, 0, -0.02, -0.28));    // 护木
        add(box(0.014, 0.045, 0.02, DARK, 0, -0.055, -0.15));  // 握把        add(box(0.024, 0.035, 0.016, DARK, 0, 0.075, -0.08));   // 照门
        boltMesh = box(0.014, 0.035, 0.06, METAL, 0.03, 0.035, -0.12); add(boltMesh); // 拉机柄（拉栓动画）
        tip = { x: 0, y: 0.045, z: -0.56 };
        break;
      }
      case 'm4a1': {
        add(box(0.05, 0.07, 0.3, METAL, 0, 0.02, -0.16));
        add(box(0.045, 0.075, 0.14, DARK, 0, 0.015, 0.09));
        add(box(0.04, 0.1, 0.05, METAL, 0, -0.055, -0.12));
        add(box(0.032, 0.032, 0.3, DARK, 0, 0.045, -0.42));    // 消音器
        add(box(0.02, 0.05, 0.014, DARK, 0, 0.08, -0.3));      // 准星
        add(box(0.03, 0.03, 0.05, DARK, 0, 0.1, -0.28));       // 提把        add(box(0.022, 0.032, 0.016, DARK, 0, 0.07, -0.12));   // 照门
        boltMesh = box(0.012, 0.03, 0.05, METAL, -0.03, 0.045, -0.05); add(boltMesh); // 拉机柄
        tip = { x: 0, y: 0.045, z: -0.6 };
        break;
      }
      case 'awp': {
        add(box(0.05, 0.08, 0.4, METAL, 0, 0.02, -0.2));
        add(box(0.045, 0.075, 0.15, DARK, 0, 0.01, 0.1));
        add(box(0.03, 0.03, 0.34, DARK, 0, 0.05, -0.5));       // 枪管
        add(box(0.035, 0.035, 0.16, DARK, 0, 0.09, -0.28));    // 瞄准镜
        boltMesh = box(0.016, 0.05, 0.03, DARK, 0, -0.02, 0.03); add(boltMesh); // 拉栓        add(box(0.012, 0.04, 0.012, DARK, 0, 0.08, -0.62));   // 准星
        add(box(0.035, 0.09, 0.04, METAL, 0, -0.065, -0.16)); // 弹匣
        tip = { x: 0, y: 0.05, z: -0.7 };
        break;
      }
      case 'mp5': {
        add(box(0.05, 0.075, 0.26, METAL, 0, 0.02, -0.14));
        add(box(0.045, 0.075, 0.12, DARK, 0, 0.015, 0.07));
        add(box(0.04, 0.12, 0.045, METAL, 0, -0.07, -0.1));
        add(box(0.03, 0.03, 0.16, DARK, 0, 0.045, -0.32));        add(box(0.022, 0.03, 0.014, DARK, 0, 0.068, -0.06));  // 照门
        tip = { x: 0, y: 0.045, z: -0.44 };
        break;
      }
      case 'deagle': {
        add(box(0.04, 0.055, 0.22, METAL, 0, 0.03, -0.1));
        add(box(0.038, 0.05, 0.2, DARK, 0, 0.075, -0.1));      // 套筒
        add(box(0.035, 0.11, 0.045, DARK, 0, -0.045, 0.02));        add(box(0.01, 0.022, 0.026, METAL, 0, 0.082, 0.03));   // 击锤   // 握把        add(box(0.012, 0.025, 0.03, METAL, 0, 0.085, 0.03));   // 击锤
        tip = { x: 0, y: 0.075, z: -0.24 };
        break;
      }
      case 'usp': {
        add(box(0.038, 0.05, 0.18, METAL, 0, 0.03, -0.08));
        add(box(0.034, 0.045, 0.16, DARK, 0, 0.068, -0.08));
        add(box(0.03, 0.1, 0.04, DARK, 0, -0.04, 0.02));        add(box(0.01, 0.022, 0.026, METAL, 0, 0.078, 0.03));   // 击锤
        tip = { x: 0, y: 0.068, z: -0.2 };
        break;
      }
      case 'glock': {
        add(box(0.042, 0.05, 0.16, DARK, 0, 0.03, -0.06));
        add(box(0.034, 0.045, 0.13, METAL, 0, 0.06, -0.06));
        add(box(0.032, 0.1, 0.04, DARK, 0, -0.04, 0.02));        add(box(0.014, 0.02, 0.02, DARK, 0, 0.062, -0.1));     // 照门
        tip = { x: 0, y: 0.06, z: -0.18 };
        break;
      }
      case 'knife': {
        add(box(0.028, 0.05, 0.1, WOOD, 0, 0.02, -0.02));     // 柄
        add(box(0.016, 0.07, 0.22, METAL, 0, 0.07, -0.12));    // 刃
        add(box(0.005, 0.09, 0.22, DARK, 0, 0.07, -0.12));
        // 刃光弧：挥砍轨迹残影（加法混合，随挥砍淡出）
        trail = new THREE.Mesh(
          new THREE.TorusGeometry(0.26, 0.014, 6, 20, Math.PI * 1.05),
          new THREE.MeshBasicMaterial({ color: 0xeef4ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
        );
        trail.position.set(0, 0.05, -0.05);
        trail.rotation.z = -Math.PI / 2;
        trail.visible = false;
        add(trail);
        tip = { x: 0, y: 0.09, z: -0.26 };
        break;
      }
      case 'hegrenade': {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), METAL);
        s.position.set(0, 0.03, -0.08);
        add(s);
        add(box(0.02, 0.05, 0.012, DARK, 0, 0.085, -0.08));
        tip = { x: 0, y: 0.03, z: -0.12 };
        break;
      }
      // ---- 新增手枪 ----
      case 'p228':
        add(box(0.04, 0.055, 0.24, METAL, 0, 0.03, -0.1));
        add(box(0.038, 0.05, 0.22, DARK, 0, 0.075, -0.1));
        add(box(0.035, 0.11, 0.045, DARK, 0, -0.045, 0.02));
        tip = { x: 0, y: 0.075, z: -0.26 };
        break;
      case 'fiveseven':
        add(box(0.042, 0.055, 0.26, METAL, 0, 0.03, -0.11));
        add(box(0.04, 0.05, 0.24, DARK, 0, 0.075, -0.11));
        add(box(0.036, 0.11, 0.045, DARK, 0, -0.045, 0.02));        add(box(0.01, 0.02, 0.026, METAL, 0, 0.082, 0.03));    // 击锤
        tip = { x: 0, y: 0.075, z: -0.28 };
        break;
      case 'elites': {
        // 双枪：左右各一把
        add(box(0.04, 0.055, 0.22, METAL, 0.06, 0.03, -0.09));
        add(box(0.035, 0.1, 0.045, DARK, 0.06, -0.04, 0.01));
        add(box(0.04, 0.055, 0.22, METAL, -0.06, 0.03, -0.09));
        add(box(0.035, 0.1, 0.045, DARK, -0.06, -0.04, 0.01));
        tip = { x: 0, y: 0.06, z: -0.24 };
        break;
      }
      // ---- 新增冲锋枪 ----
      case 'tmp':
        add(box(0.05, 0.07, 0.24, METAL, 0, 0.02, -0.12));
        add(box(0.04, 0.11, 0.045, METAL, 0, -0.065, -0.08));
        add(box(0.032, 0.032, 0.22, DARK, 0, 0.045, -0.32)); // 消音器
        tip = { x: 0, y: 0.045, z: -0.46 };
        break;
      case 'mac10':
        add(box(0.055, 0.08, 0.26, DARK, 0, 0.02, -0.12));
        add(box(0.04, 0.12, 0.05, METAL, 0, -0.075, -0.08));
        add(box(0.03, 0.03, 0.14, DARK, 0, 0.05, -0.3));
        tip = { x: 0, y: 0.05, z: -0.38 };
        break;
      case 'ump45':
        add(box(0.055, 0.075, 0.28, METAL, 0, 0.02, -0.14));
        add(box(0.045, 0.075, 0.12, DARK, 0, 0.015, 0.08));
        add(box(0.04, 0.13, 0.05, METAL, 0, -0.08, -0.08));
        add(box(0.032, 0.032, 0.16, DARK, 0, 0.045, -0.34));
        tip = { x: 0, y: 0.045, z: -0.44 };
        break;
      case 'p90':
        add(box(0.055, 0.08, 0.34, METAL, 0, 0.02, -0.16));
        add(box(0.045, 0.06, 0.2, DARK, 0, 0.075, -0.1));   // 顶部弹匣
        add(box(0.05, 0.07, 0.12, DARK, 0, 0.01, 0.08));
        add(box(0.03, 0.03, 0.14, DARK, 0, 0.045, -0.36));
        tip = { x: 0, y: 0.045, z: -0.44 };
        break;
      // ---- 新增步枪 ----
      case 'galil':
        add(box(0.05, 0.07, 0.36, METAL, 0, 0.02, -0.16));
        add(box(0.045, 0.075, 0.15, DARK, 0, 0.015, 0.1));
        add(box(0.04, 0.11, 0.05, METAL, 0, -0.06, -0.14));
        add(box(0.03, 0.03, 0.3, DARK, 0, 0.045, -0.46));
        boltMesh = box(0.012, 0.02, 0.035, DARK, 0, 0.03, 0.02); add(boltMesh);  // 拉机柄        add(box(0.02, 0.03, 0.014, DARK, 0, 0.072, -0.08));    // 照门
        tip = { x: 0, y: 0.045, z: -0.62 };
        break;
      case 'famas':
        add(box(0.055, 0.08, 0.32, METAL, 0, 0.02, -0.14));
        add(box(0.045, 0.075, 0.13, DARK, 0, 0.015, 0.08));
        add(box(0.04, 0.12, 0.05, METAL, 0, -0.07, -0.1));
        add(box(0.03, 0.04, 0.1, DARK, 0, 0.09, -0.1));     // 提把        add(box(0.02, 0.028, 0.014, DARK, 0, 0.068, -0.06));   // 照门
        add(box(0.03, 0.03, 0.2, DARK, 0, 0.045, -0.36));
        boltMesh = box(0.012, 0.028, 0.05, METAL, 0, 0.055, 0.01); add(boltMesh); // 拉机柄
        tip = { x: 0, y: 0.045, z: -0.48 };
        break;
      case 'sg552':
        add(box(0.055, 0.075, 0.3, METAL, 0, 0.02, -0.13));
        add(box(0.045, 0.075, 0.12, DARK, 0, 0.015, 0.08));
        add(box(0.04, 0.11, 0.05, METAL, 0, -0.065, -0.08));
        add(box(0.03, 0.03, 0.18, DARK, 0, 0.05, -0.3));
        add(box(0.02, 0.035, 0.05, DARK, 0, 0.09, -0.05));  // 顶部瞄准        add(box(0.018, 0.026, 0.014, DARK, 0, 0.066, -0.1));   // 照门
        boltMesh = box(0.012, 0.03, 0.04, METAL, 0.03, 0.035, -0.02); add(boltMesh); // 拉机柄
        tip = { x: 0, y: 0.05, z: -0.42 };
        break;
      case 'aug':
        add(box(0.055, 0.08, 0.32, METAL, 0, 0.02, -0.14));
        add(box(0.045, 0.075, 0.13, DARK, 0, 0.015, 0.08));
        add(box(0.04, 0.12, 0.05, METAL, 0, -0.07, -0.1));
        add(box(0.035, 0.04, 0.16, DARK, 0, 0.1, -0.08));   // 顶部瞄准镜        add(box(0.012, 0.035, 0.012, DARK, 0, 0.07, -0.42));   // 准星
        add(box(0.03, 0.03, 0.2, DARK, 0, 0.045, -0.36));
        boltMesh = box(0.012, 0.03, 0.04, METAL, 0.03, 0.035, -0.1); add(boltMesh); // 拉机柄
        tip = { x: 0, y: 0.045, z: -0.48 };
        break;
      // ---- 新增狙击枪 ----
      case 'scout':
        add(box(0.045, 0.07, 0.34, METAL, 0, 0.02, -0.16));
        add(box(0.04, 0.065, 0.14, DARK, 0, 0.015, 0.08));
        add(box(0.028, 0.028, 0.3, DARK, 0, 0.045, -0.44));
        add(box(0.03, 0.03, 0.14, DARK, 0, 0.085, -0.22));  // 瞄准镜        boltMesh = box(0.012, 0.025, 0.04, METAL, 0.03, 0.035, -0.14); add(boltMesh); // 拉栓
        tip = { x: 0, y: 0.045, z: -0.6 };
        break;
      case 'g3sg1':
        add(box(0.05, 0.08, 0.4, METAL, 0, 0.02, -0.2));
        add(box(0.045, 0.075, 0.15, DARK, 0, 0.01, 0.1));
        add(box(0.035, 0.12, 0.05, METAL, 0, -0.07, -0.14));
        add(box(0.03, 0.03, 0.32, DARK, 0, 0.05, -0.5));
        add(box(0.035, 0.04, 0.15, DARK, 0, 0.1, -0.24));   // 瞄准镜        add(box(0.012, 0.04, 0.012, DARK, 0, 0.078, -0.62));   // 准星
        { boltMesh = box(0.014, 0.03, 0.05, METAL, 0.03, 0.035, 0.0); add(boltMesh); } // 拉机柄
        tip = { x: 0, y: 0.05, z: -0.68 };
        break;
      case 'sg550':
        add(box(0.05, 0.08, 0.4, METAL, 0, 0.02, -0.2));
        add(box(0.045, 0.075, 0.15, DARK, 0, 0.01, 0.1));
        add(box(0.035, 0.12, 0.05, METAL, 0, -0.07, -0.14));
        add(box(0.03, 0.03, 0.3, DARK, 0, 0.05, -0.48));
        add(box(0.035, 0.04, 0.14, DARK, 0, 0.1, -0.22));        add(box(0.012, 0.04, 0.012, DARK, 0, 0.078, -0.6));    // 准星
        { boltMesh = box(0.014, 0.03, 0.05, METAL, 0.03, 0.035, 0.0); add(boltMesh); } // 拉机柄
        tip = { x: 0, y: 0.05, z: -0.66 };
        break;
      // ---- 机枪 ----
      case 'm249':
        add(box(0.06, 0.09, 0.4, METAL, 0, 0.02, -0.18));
        add(box(0.05, 0.08, 0.16, DARK, 0, 0.01, 0.1));
        add(box(0.07, 0.1, 0.09, DARK, 0, -0.07, -0.05));   // 弹药箱
        add(box(0.035, 0.035, 0.34, DARK, 0, 0.05, -0.5));  // 粗枪管
        add(box(0.012, 0.03, 0.05, DARK, 0, 0.1, -0.3));    // 准星        add(box(0.02, 0.03, 0.016, DARK, 0, 0.075, -0.08));    // 照门
        { boltMesh = box(0.014, 0.03, 0.05, METAL, 0.03, 0.045, -0.05); add(boltMesh); } // 拉机柄
        tip = { x: 0, y: 0.05, z: -0.68 };
        break;
      case 'flashbang': {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10),
          new THREE.MeshLambertMaterial({ color: 0xb8c4cc }));
        s.position.set(0, 0.03, -0.08);
        add(s);
        add(box(0.02, 0.05, 0.012, DARK, 0, 0.085, -0.08));
        tip = { x: 0, y: 0.03, z: -0.12 };
        break;
      }
      case 'smokegrenade':
        add(box(0.06, 0.13, 0.06, new THREE.MeshLambertMaterial({ color: 0x3f5238 }), 0, 0.03, -0.08));
        add(box(0.02, 0.04, 0.012, DARK, 0, 0.11, -0.08));
        tip = { x: 0, y: 0.03, z: -0.12 };
        break;
      default: { // bomb
        add(box(0.09, 0.06, 0.13, DARK, 0, 0.02, -0.06));
        add(box(0.075, 0.05, 0.1, METAL, 0, 0.005, -0.06));
        add(box(0.02, 0.02, 0.02, new THREE.MeshLambertMaterial({ color: 0x3f7a4f }), 0.02, 0.045, -0.02));
        add(box(0.02, 0.02, 0.02, new THREE.MeshLambertMaterial({ color: 0x8a2b2b }), -0.02, 0.045, -0.02));
        tip = { x: 0, y: 0.02, z: -0.14 };
      }
    }
    return { root, tip, bolt: boltMesh, trail };
  }

  function init(camera) {
    group = new THREE.Group();
    group.position.set(0.27, -0.25, -0.42);
    camera.add(group);
    camera.rotation.order = 'YXZ';
    // 枪口火光：星芒 + 柔光两层（加法混合，随相机朝向）
    const starTex = new THREE.CanvasTexture(flashTexture(false));
    starTex.colorSpace = THREE.SRGBColorSpace;
    const glowTex = new THREE.CanvasTexture(flashTexture(true));
    glowTex.colorSpace = THREE.SRGBColorSpace;
    muzzleStar = new THREE.Sprite(new THREE.SpriteMaterial({
      map: starTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    muzzleGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    muzzleStar.visible = false;
    muzzleGlow.visible = false;
    group.add(muzzleStar);
    group.add(muzzleGlow);
    muzzleLight = new THREE.PointLight(0xffc060, 0, 8, 2);
    group.add(muzzleLight);
    initMuzzleSmoke();
  }

  const GLOVE = new THREE.MeshPhongMaterial({ color: 0x30343c, shininess: 20, specular: 0x3a3f46 });
  const SLEEVE = new THREE.MeshPhongMaterial({ color: 0x4a5560, shininess: 14, specular: 0x2f353d });

  // 双手/手臂模型（真实感：枪不再悬浮；手=椭球、小臂=圆柱）
  function addHands(root, id) {
    const def = WEAPONS.W[id];
    const hand = () => {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), GLOVE);
      h.scale.set(1.3, 1.0, 2.0);
      h.castShadow = false;
      return h;
    };
    const arm = (w, h, d, x, y, z, rx) => {
      const a = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.45, w * 0.6, h, 8), SLEEVE);
      a.position.set(x, y, z);
      a.rotation.x = rx || 0;
      a.castShadow = false;
      root.add(a);
      return a;
    };
    if (def && def.slot === 1) {
      // 步枪/狙击/机枪：右手握把 + 左手护木 + 小臂
      const rh = hand(); rh.position.set(0.015, -0.06, -0.02); root.add(rh);
      arm(0.055, 0.16, 0.06, 0.05, -0.13, 0.06, 0.35);
      const lh = hand(); lh.position.set(0.0, 0.005, -0.2); root.add(lh);
      arm(0.055, 0.16, 0.06, -0.02, -0.12, -0.06, -0.55);
    } else if (def && def.slot === 2) {
      // 手枪：双手交叠
      const rh = hand(); rh.position.set(0.0, -0.05, 0.0); root.add(rh);
      arm(0.05, 0.15, 0.06, 0.03, -0.12, 0.1, 0.3);
      const lh = hand(); lh.position.set(-0.005, -0.095, 0.02); lh.rotation.z = 0.15; root.add(lh);
    } else if (id === 'knife') {
      const rh = hand(); rh.position.set(0.0, -0.03, 0.0); root.add(rh);
      arm(0.05, 0.15, 0.06, 0.03, -0.1, 0.08, 0.3);
    } else if (id === 'hegrenade' || id === 'flashbang' || id === 'smokegrenade') {
      const rh = hand(); rh.position.set(0.0, -0.02, 0.0); root.add(rh);
      arm(0.05, 0.15, 0.06, 0.03, -0.1, 0.08, 0.3);
    }
  }

  // 枪口硝烟（小灰烟团）
  const smokePuffs = [];
  function initMuzzleSmoke() {
    const tex = new THREE.CanvasTexture(flashTexture(true));
    tex.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: 0x9a938a, transparent: true, opacity: 0, depthWrite: false
      }));
      sp.visible = false;
      group.add(sp);
      smokePuffs.push({ sp, life: 0 });
    }
  }

  let switchAnim = null; // {phase:'down'|'up', t:0, nextId}

  function buildNow(id) {
    if (cur) { group.remove(cur.root); cur = null; } // 移除旧枪（修复：切换后新旧枪叠加显示旧枪）
    const b = build(id);
    addHands(b.root, id);
    group.add(b.root);
    cur = { weapon: id, root: b.root, tip: b.tip, kick: 0, bobPhase: 0, reloadT: 0, slash: 0, slashHeavy: false, bolt: b.bolt, boltT: 0, boltBaseZ: b.bolt ? b.bolt.position.z : 0, trail: b.trail, cockDip: 0, cockTilt: 0, wasReload: false };
  }

  // 切枪：先下收旧枪，再上举新枪（约 0.3 秒）
  function setWeapon(id) {
    if (!group) return;
    if (cur && cur.weapon === id) return;
    if (switchAnim) { switchAnim.nextId = id; return; }
    if (cur) { switchAnim = { phase: 'down', t: 0, nextId: id }; return; }
    buildNow(id);
  }

  function setVisible(v) { if (group) group.visible = v; }

  function fire(alt) {
    if (!cur) return;
    if (cur.weapon === 'knife') { cur.slash = 1; cur.slashHeavy = !!alt; return; } // 匕首：挥砍，无火光（轻/重不同动画）
    cur.kick = 1;
    if (cur.bolt && (cur.weapon === 'awp' || cur.weapon === 'scout')) cur.boltT = 1; // 栓动枪每发拉栓（其余枪出枪/换弹时拉栓）
    // 枪口火光（星芒随机旋转/缩放 + 柔光）
    const sc = 0.17 + Math.random() * 0.09;
    muzzleStar.visible = true;
    muzzleStar.material.rotation = Math.random() * Math.PI * 2;
    muzzleStar.material.opacity = 0.95;
    muzzleStar.scale.set(sc, sc, 1);
    muzzleStar.position.set(cur.tip.x, cur.tip.y, cur.tip.z);
    const gc = 0.4 + Math.random() * 0.18;
    muzzleGlow.visible = true;
    muzzleGlow.material.rotation = Math.random() * Math.PI * 2;
    muzzleGlow.material.opacity = 0.8;
    muzzleGlow.scale.set(gc, gc, 1);
    muzzleGlow.position.set(cur.tip.x, cur.tip.y, cur.tip.z);
    muzzleLight.intensity = 3.2;
    // 枪口硝烟
    const p = smokePuffs.find(q => q.life <= 0) || smokePuffs[0];
    p.sp.visible = true;
    p.life = 0.5;
    p.sp.position.set(cur.tip.x, cur.tip.y, cur.tip.z + 0.02);
    const psc = 0.09 + Math.random() * 0.05;
    p.sp.scale.set(psc, psc, 1);
    p.sp.material.opacity = 0.32;
    p.sp.material.rotation = Math.random() * Math.PI * 2;
  }

  function update(dt, st) {
    if (!group || !cur) return;
    const sp = st.speed || 0;
    cur.bobPhase += dt * (2.2 + sp * 2.6);
    const bobX = Math.sin(cur.bobPhase) * 0.006 * Math.min(1, sp * 0.5);
    const bobY = Math.abs(Math.cos(cur.bobPhase)) * 0.005 * Math.min(1, sp * 0.5);
    const sway = Math.sin(performance.now() * 0.0013) * 0.0035;

    // 切枪动画（下收/上举）
    if (switchAnim) {
      switchAnim.t += dt;
      const pp = Math.min(1, switchAnim.t / 0.14);
      if (switchAnim.phase === 'down') {
        group.position.y = -0.25 - pp * 0.32;
        if (pp >= 1) {
          buildNow(switchAnim.nextId);
          switchAnim.phase = 'up';
          switchAnim.t = 0;
        }
      } else {
        group.position.y = -0.57 + pp * 0.32;
        if (pp >= 1) {
          switchAnim = null;
          if (cur.bolt) cur.boltT = 1; // 举枪完成 → 拉栓上膛
        }
      }
    }
    // 拉栓动画（后拉-回位 + 枪身轻沉/微倾）
    if (cur.boltT > 0) {
      cur.boltT -= dt * 3.0;
      const k = Math.sin((1 - Math.max(0, cur.boltT)) * Math.PI);
      if (cur.bolt) cur.bolt.position.z = cur.boltBaseZ + k * 0.09;
      cur.cockDip = k * 0.022;
      cur.cockTilt = k * 0.12;
    } else { cur.cockDip = 0; cur.cockTilt = 0; }

    // 后坐力恢复
    cur.kick = Math.max(0, cur.kick - dt * 9);
    const kickZ = cur.kick * 0.09;
    const kickX = -cur.kick * 0.05;

    // 换弹动画（结束后拉栓）
    let reloadDrop = 0, reloadTilt = 0;
    if (st.reloading) {
      cur.reloadT += dt;
      const p = Math.sin(Math.min(cur.reloadT / (st.reloadDur || 2.5), 1) * Math.PI);
      reloadDrop = p * 0.16;
      reloadTilt = p * 0.9;
      cur.wasReload = true;
    } else {
      if (cur.wasReload && cur.bolt) cur.boltT = 1; // 换弹完成 → 拉栓上膛
      cur.wasReload = false;
      cur.reloadT = 0;
    }

    if (!switchAnim) {
      group.position.set(
        0.27 + sway + bobX * 0.5 + kickX,
        -0.25 + bobY - reloadDrop - cur.cockDip,
        -0.42 + kickZ
      );
      group.rotation.set(reloadTilt + cur.cockTilt, 0, cur.kick * 0.06);
    } else {
      group.position.x = 0.27;
      group.rotation.set(0, 0, 0);
    }

    // 匕首挥砍动画：轻击横向快劈 / 重击高举下劈，带刃光弧残影
    if (cur.slash > 0) {
      const spd = cur.slashHeavy ? 2.3 : 4.8;
      cur.slash -= dt * spd;
      const p = Math.max(0, cur.slash);
      const sw = Math.sin(p * Math.PI);
      if (cur.slashHeavy) {
        const raise = Math.min(1, (1 - p) * 2);   // 抬刀 0→1
        const chop = Math.max(0, 1 - p * 2);      // 下劈 0→1
        cur.root.rotation.x = -raise * 0.95 + chop * 1.5;
        cur.root.rotation.z = chop * 0.25;
        cur.root.rotation.y = 0;
      } else {
        cur.root.rotation.z = 0.7 - (1 - p) * 2.05; // 横扫：右上 → 左下
        cur.root.rotation.y = (1 - p) * 0.35;
        cur.root.rotation.x = 0;
      }
      if (cur.trail) {
        cur.trail.visible = true;
        cur.trail.material.opacity = sw * 0.85;
        cur.trail.rotation.x = cur.slashHeavy ? Math.PI / 2 : 0;
      }
    } else {
      cur.root.rotation.z = 0;
      cur.root.rotation.y = 0;
      cur.root.rotation.x = 0;
      if (cur.trail) { cur.trail.visible = false; cur.trail.material.opacity = 0; }
    }

    // 硝烟漂移消散
    for (const p of smokePuffs) {
      if (p.life > 0) {
        p.life -= dt;
        p.sp.position.y += dt * 0.25;
        p.sp.position.z += dt * 0.15;
        p.sp.scale.multiplyScalar(1 + dt * 1.2);
        p.sp.material.opacity = Math.max(0, p.life / 0.5) * 0.32;
        if (p.life <= 0) p.sp.visible = false;
      }
    }

    // 火光衰减
    if (muzzleStar.visible) {
      muzzleStar.material.opacity -= dt * 16;
      muzzleGlow.material.opacity -= dt * 13;
      muzzleLight.intensity *= 0.55;
      if (muzzleStar.material.opacity <= 0) {
        muzzleStar.visible = false;
        muzzleGlow.visible = false;
        muzzleLight.intensity = 0;
      }
    }
  }

  function weaponId() { return cur ? cur.weapon : null; }

  // 枪口的世界坐标（自己的曳光弹起点）
  const _muzzleV = new THREE.Vector3();
  function getMuzzleWorld() {
    if (!cur) return { x: 0, y: 1.6, z: 0 };
    _muzzleV.set(cur.tip.x, cur.tip.y, cur.tip.z);
    cur.root.localToWorld(_muzzleV);
    return { x: _muzzleV.x, y: _muzzleV.y, z: _muzzleV.z };
  }

  return {
    init, setWeapon, setVisible, fire, update, weaponId, getMuzzleWorld,
    _debugVisible: () => !!group && group.visible,
    _debugMuzzleOn: () => !!muzzleStar && muzzleStar.visible
  };
})();
