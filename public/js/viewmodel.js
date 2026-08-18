// public/js/viewmodel.js — 第一人称武器模型与动画
'use strict';
const VM = (function () {
  let group = null;
  let cur = null;        // {weapon, root, tip, kick, bobPhase}
  let muzzleStar = null; // 星芒火光
  let muzzleGlow = null; // 柔光
  let muzzleLight = null;
  const DARK = new THREE.MeshLambertMaterial({ color: 0x22252a });
  const METAL = new THREE.MeshLambertMaterial({ color: 0x3a3f46 });
  const WOOD = new THREE.MeshLambertMaterial({ color: 0x7a5230 });

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
    const add = (m) => root.add(m);
    switch (id) {
      case 'ak47': {
        add(box(0.05, 0.07, 0.34, METAL, 0, 0.02, -0.18));     // 机匣
        add(box(0.045, 0.075, 0.16, WOOD, 0, 0.015, 0.08));    // 枪托
        add(box(0.04, 0.11, 0.05, METAL, 0, -0.06, -0.16));    // 弯弹匣
        add(box(0.028, 0.028, 0.24, DARK, 0, 0.045, -0.42));   // 枪管
        add(box(0.018, 0.05, 0.014, DARK, 0, 0.085, -0.5));    // 准星
        add(box(0.05, 0.035, 0.09, WOOD, 0, -0.02, -0.28));    // 护木
        add(box(0.014, 0.045, 0.02, DARK, 0, -0.055, -0.15));  // 握把
        tip = { x: 0, y: 0.045, z: -0.56 };
        break;
      }
      case 'm4a1': {
        add(box(0.05, 0.07, 0.3, METAL, 0, 0.02, -0.16));
        add(box(0.045, 0.075, 0.14, DARK, 0, 0.015, 0.09));
        add(box(0.04, 0.1, 0.05, METAL, 0, -0.055, -0.12));
        add(box(0.032, 0.032, 0.3, DARK, 0, 0.045, -0.42));    // 消音器
        add(box(0.02, 0.05, 0.014, DARK, 0, 0.08, -0.3));      // 准星
        add(box(0.03, 0.03, 0.05, DARK, 0, 0.1, -0.28));       // 提把
        tip = { x: 0, y: 0.045, z: -0.6 };
        break;
      }
      case 'awp': {
        add(box(0.05, 0.08, 0.4, METAL, 0, 0.02, -0.2));
        add(box(0.045, 0.075, 0.15, DARK, 0, 0.01, 0.1));
        add(box(0.03, 0.03, 0.34, DARK, 0, 0.05, -0.5));       // 枪管
        add(box(0.035, 0.035, 0.16, DARK, 0, 0.09, -0.28));    // 瞄准镜
        add(box(0.016, 0.05, 0.03, DARK, 0, -0.02, 0.03));     // 拉栓
        add(box(0.035, 0.09, 0.04, METAL, 0, -0.065, -0.16)); // 弹匣
        tip = { x: 0, y: 0.05, z: -0.7 };
        break;
      }
      case 'mp5': {
        add(box(0.05, 0.075, 0.26, METAL, 0, 0.02, -0.14));
        add(box(0.045, 0.075, 0.12, DARK, 0, 0.015, 0.07));
        add(box(0.04, 0.12, 0.045, METAL, 0, -0.07, -0.1));
        add(box(0.03, 0.03, 0.16, DARK, 0, 0.045, -0.32));
        tip = { x: 0, y: 0.045, z: -0.44 };
        break;
      }
      case 'deagle': {
        add(box(0.04, 0.055, 0.22, METAL, 0, 0.03, -0.1));
        add(box(0.038, 0.05, 0.2, DARK, 0, 0.075, -0.1));      // 套筒
        add(box(0.035, 0.11, 0.045, DARK, 0, -0.045, 0.02));   // 握把
        tip = { x: 0, y: 0.075, z: -0.24 };
        break;
      }
      case 'usp': {
        add(box(0.038, 0.05, 0.18, METAL, 0, 0.03, -0.08));
        add(box(0.034, 0.045, 0.16, DARK, 0, 0.068, -0.08));
        add(box(0.03, 0.1, 0.04, DARK, 0, -0.04, 0.02));
        tip = { x: 0, y: 0.068, z: -0.2 };
        break;
      }
      case 'glock': {
        add(box(0.042, 0.05, 0.16, DARK, 0, 0.03, -0.06));
        add(box(0.034, 0.045, 0.13, METAL, 0, 0.06, -0.06));
        add(box(0.032, 0.1, 0.04, DARK, 0, -0.04, 0.02));
        tip = { x: 0, y: 0.06, z: -0.18 };
        break;
      }
      case 'knife': {
        add(box(0.028, 0.05, 0.1, WOOD, 0, 0.02, -0.02));     // 柄
        add(box(0.016, 0.07, 0.22, METAL, 0, 0.07, -0.12));    // 刃
        add(box(0.005, 0.09, 0.22, DARK, 0, 0.07, -0.12));
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
      default: { // bomb
        add(box(0.09, 0.06, 0.13, DARK, 0, 0.02, -0.06));
        add(box(0.075, 0.05, 0.1, METAL, 0, 0.005, -0.06));
        add(box(0.02, 0.02, 0.02, new THREE.MeshLambertMaterial({ color: 0x3f7a4f }), 0.02, 0.045, -0.02));
        add(box(0.02, 0.02, 0.02, new THREE.MeshLambertMaterial({ color: 0x8a2b2b }), -0.02, 0.045, -0.02));
        tip = { x: 0, y: 0.02, z: -0.14 };
      }
    }
    return { root, tip };
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
  }

  function setWeapon(id) {
    if (!group) return;
    if (cur) {
      group.remove(cur.root);
      cur = null;
    }
    const b = build(id);
    group.add(b.root);
    cur = { weapon: id, root: b.root, tip: b.tip, kick: 0, bobPhase: 0, reloadT: 0, switchT: 0 };
  }

  function setVisible(v) { if (group) group.visible = v; }

  function fire() {
    if (!cur) return;
    cur.kick = 1;
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
  }

  function update(dt, st) {
    if (!group || !cur) return;
    const sp = st.speed || 0;
    cur.bobPhase += dt * (2.2 + sp * 2.6);
    const bobX = Math.sin(cur.bobPhase) * 0.006 * Math.min(1, sp * 0.5);
    const bobY = Math.abs(Math.cos(cur.bobPhase)) * 0.005 * Math.min(1, sp * 0.5);
    const sway = Math.sin(performance.now() * 0.0013) * 0.0035;

    // 后坐力恢复
    cur.kick = Math.max(0, cur.kick - dt * 9);
    const kickZ = cur.kick * 0.09;
    const kickX = -cur.kick * 0.05;

    // 换弹动画
    let reloadDrop = 0, reloadTilt = 0;
    if (st.reloading) {
      cur.reloadT += dt;
      const p = Math.sin(Math.min(cur.reloadT / (st.reloadDur || 2.5), 1) * Math.PI);
      reloadDrop = p * 0.16;
      reloadTilt = p * 0.9;
    } else cur.reloadT = 0;

    group.position.set(
      0.27 + sway + bobX * 0.5 + kickX,
      -0.25 + bobY - reloadDrop,
      -0.42 + kickZ
    );
    group.rotation.set(reloadTilt, 0, cur.kick * 0.06);

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

  return { init, setWeapon, setVisible, fire, update, weaponId, getMuzzleWorld, _debugVisible: () => !!group && group.visible };
})();
