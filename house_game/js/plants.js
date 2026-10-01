import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rand, mesh, std, interactive, say } from './util.js';
import { groundHeight } from './garden.js';
import { SAND } from './sand.js';

const UP = new THREE.Vector3(0, 1, 0);

// Wind sway injected into the vertex shader; amplitude grows with world height.
function sway(ctx, mat, strength = 1) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = ctx.uTime;
    sh.uniforms.uWind = ctx.uWind;
    sh.vertexShader = 'uniform float uTime; uniform float uWind;\n' + sh.vertexShader.replace(
      '#include <project_vertex>',
      `vec4 mvPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      vec4 wp = modelMatrix * mvPosition;
      float s = max(0.0, wp.y - 1.5); s = s * s * ${(0.004 * strength).toFixed(5)} * uWind;
      wp.x += sin(uTime * 1.3 + wp.z * 0.4 + wp.x * 0.2) * s;
      wp.z += cos(uTime * 1.1 + wp.x * 0.3) * s * 0.5;
      mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  return mat;
}

function branchTree({ depth = 5, len = 2.2, rad = 0.3, bark, spread = 0.7, lift = 0.35 }) {
  const geos = [], tips = [];
  const base = new THREE.CylinderGeometry(0.68, 1, 1, 6);
  base.translate(0, 0.5, 0);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  (function grow(start, dir, l, r, d) {
    q.setFromUnitVectors(UP, dir);
    m4.compose(start, q, s.set(r, l, r));
    geos.push(base.clone().applyMatrix4(m4));
    const end = start.clone().addScaledVector(dir, l);
    if (d === 0) { tips.push(end); return; }
    const n = d > 3 ? 2 : 3;
    for (let i = 0; i < n; i++) {
      const nd = dir.clone().add(new THREE.Vector3(rand(-1, 1), rand(-0.2, lift), rand(-1, 1)).multiplyScalar(spread)).normalize();
      grow(end, nd, l * rand(0.66, 0.8), r * 0.66, d - 1);
    }
  })(new THREE.Vector3(), new THREE.Vector3(rand(-0.1, 0.1), 1, rand(-0.1, 0.1)).normalize(), len, rad, depth);
  return { trunk: mesh(mergeGeometries(geos), std(bark, { roughness: 0.95 })), tips };
}

// Foliage clumps at branch tips. `seasonKey` picks the palette/fullness from ctx.season.trees,
// and the clumps recolour and thin out smoothly whenever the season changes.
function foliage(ctx, tips, seasonKey, per = 5, size = [0.28, 0.45]) {
  const mat = sway(ctx, std(0xffffff, { flatShading: true, roughness: 0.8 }), 0.6);
  const n = tips.length * per;
  const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), mat, n);
  const o = new THREE.Object3D(), c = new THREE.Color();
  const items = [];
  for (const t of tips) for (let i = 0; i < per; i++) {
    items.push({
      p: t.clone().add(new THREE.Vector3(rand(-0.5, 0.5), rand(-0.3, 0.3), rand(-0.5, 0.5))),
      r: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)),
      s: rand(...size), pick: Math.random(), jitter: rand(-0.05, 0.05), keep: Math.random(),
      cur: new THREE.Color(), tgt: new THREE.Color(), scale: 0,
    });
  }
  let shown = null;
  function retarget() {
    const cfg = ctx.season.trees[seasonKey];
    shown = ctx.season;
    for (const it of items) {
      it.tgt.set(cfg.colors[Math.floor(it.pick * cfg.colors.length)]).offsetHSL(0, 0, it.jitter);
      it.tgtScale = it.keep < cfg.full ? it.s * (cfg.full < 0.6 ? 0.75 : 1) : 0;
    }
  }
  retarget();
  items.forEach((it, i) => {
    it.cur.copy(it.tgt); it.scale = it.tgtScale;
    o.position.copy(it.p); o.rotation.copy(it.r); o.scale.setScalar(Math.max(it.scale, 1e-4));
    o.updateMatrix();
    im.setMatrixAt(i, o.matrix);
    im.setColorAt(i, it.cur);
  });
  let settling = 0;
  ctx.updaters.push((dt) => {
    if (shown !== ctx.season) { retarget(); settling = 3; }
    if (settling <= 0) return;
    settling -= dt;
    const k = settling <= 0 ? 1 : 1 - Math.exp(-dt * 2);
    items.forEach((it, i) => {
      it.cur.lerp(it.tgt, k);
      it.scale += (it.tgtScale - it.scale) * k;
      o.position.copy(it.p); o.rotation.copy(it.r); o.scale.setScalar(Math.max(it.scale, 1e-4));
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
      im.setColorAt(i, it.cur);
    });
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
  });
  im.castShadow = true;
  return im;
}

function pine(ctx, x, z, scale = 1) {
  const g = new THREE.Group();
  g.position.set(x, groundHeight(x, z), z);
  g.scale.setScalar(scale);
  const bark = std(0x4f3a2c, { roughness: 1 });
  const pad = sway(ctx, std(0x2c4a28, { flatShading: true }), 0.5);
  const geos = [];
  const base = new THREE.CylinderGeometry(0.75, 1, 1, 6);
  base.translate(0, 0.5, 0);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  const seg = (p, d, l, r) => { q.setFromUnitVectors(UP, d); m4.compose(p, q, sc.set(r, l, r)); geos.push(base.clone().applyMatrix4(m4)); };
  const addPad = (p, s) => {
    for (let i = 0; i < 3; i++) {
      const b = mesh(new THREE.IcosahedronGeometry(1, 1), pad, p.x + rand(-0.4, 0.4) * s, p.y + rand(0, 0.2), p.z + rand(-0.4, 0.4) * s);
      b.scale.set(s * rand(0.8, 1.1), s * 0.38, s * rand(0.8, 1.1));
      g.add(b);
    }
  };
  let p = new THREE.Vector3(), r = 0.32;
  const ang = rand(0, 6);
  for (let i = 0; i < 5; i++) {
    const d = new THREE.Vector3(Math.cos(ang + i * 1.4) * 0.45, 1, Math.sin(ang + i * 1.4) * 0.45).normalize();
    seg(p, d, 1.1, r);
    p = p.clone().addScaledVector(d, 1.1);
    r *= 0.84;
    if (i >= 1) {
      const a = ang + i * 2.3, L = rand(1.2, 1.9) - i * 0.15;
      const bd = new THREE.Vector3(Math.cos(a), rand(0.05, 0.25), Math.sin(a)).normalize();
      seg(p, bd, L, r * 0.6);
      addPad(p.clone().addScaledVector(bd, L).add(new THREE.Vector3(0, 0.2, 0)), 1.3 - i * 0.12);
    }
  }
  addPad(p.clone().add(new THREE.Vector3(0, 0.2, 0)), 1.0);
  g.add(mesh(mergeGeometries(geos), bark));
  ctx.scene.add(g);
  interactive(ctx, g, {
    name: '庭松', hint: '修剪成云片的黑松',
    onClick: () => { ctx.sfx.noise(0.7, { gain: 0.08, freq: 3000, q: 0.5 }); say(ctx, g, '松 · 千年常青', 6.5); },
  });
}

// Falling petals / leaves shared by all trees.
function fallers(ctx) {
  const N = 450;
  const im = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.17, 0.11),
    new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }), N);
  im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.frustumCulled = false;
  ctx.scene.add(im);
  const P = Array.from({ length: N }, () => ({ on: false, landed: 0, p: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), ph: 0 }));
  const o = new THREE.Object3D(), c = new THREE.Color();
  for (let i = 0; i < N; i++) { o.scale.setScalar(0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, c.set(0xffffff)); }
  let next = 0;
  const landY = (x, z) => {
    if (Math.abs(x) < 15 && z > 13.9 && z < 18.1) return 0.73;
    if (Math.abs(x) < SAND.W / 2 && Math.abs(z) < SAND.D / 2) return SAND.Y + 0.02;
    return groundHeight(x, z) + 0.03;
  };
  function spawn(origin, radius, colors, count) {
    for (let k = 0; k < count; k++) {
      const idx = next;
      const q = P[idx]; next = (next + 1) % N;
      q.on = true; q.landed = 0; q.ph = rand(0, 6);
      q.p.set(origin.x + rand(-radius, radius), origin.y + rand(-1, 1), origin.z + rand(-radius, radius));
      q.r.set(rand(0, 6), rand(0, 6), rand(0, 6));
      q.w.set(rand(-3, 3), rand(-3, 3), rand(-3, 3));
      im.setColorAt(idx, c.set(colors[(Math.random() * colors.length) | 0]));
    }
    im.instanceColor.needsUpdate = true;
  }
  ctx.updaters.push((dt, t) => {
    const wind = ctx.uWind.value;
    for (let i = 0; i < N; i++) {
      const q = P[i];
      if (!q.on) continue;
      if (q.landed === 0) {
        q.p.x += (0.5 * wind + Math.sin(t * 2 + q.ph) * 0.35) * dt;
        q.p.z += (0.18 * wind + Math.cos(t * 1.7 + q.ph) * 0.3) * dt;
        q.p.y -= (0.45 + Math.sin(t * 3 + q.ph) * 0.15) * dt;
        q.r.x += q.w.x * dt; q.r.y += q.w.y * dt; q.r.z += q.w.z * dt;
        const ly = landY(q.p.x, q.p.z);
        if (q.p.y <= ly) { q.p.y = ly; q.r.x = -Math.PI / 2; q.r.y = 0; q.landed = 0.001; }
      } else q.landed += dt;
      const s = q.landed > 10 ? Math.max(0, 1 - (q.landed - 10)) : 1;
      if (s <= 0) q.on = false;
      o.position.copy(q.p); o.rotation.copy(q.r); o.scale.setScalar(s);
      o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
  });
  return spawn;
}

function bamboo(ctx) {
  const N = 140;
  const culmMat = sway(ctx, std(0x6f8f3e, { roughness: 0.6 }), 0.8);
  const culms = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.11, 1, 6), culmMat, N);
  const leafMat = sway(ctx, std(0x5f8a3a, { flatShading: true, side: THREE.DoubleSide }), 0.8);
  const leaves = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1.6, 4), leafMat, N * 5);
  const o = new THREE.Object3D(), c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const x = rand(-34, 34), z = rand(-27, -20.5), h = rand(8, 13);
    const lx = rand(-0.06, 0.06), lz = rand(-0.06, 0.06);
    o.position.set(x, h / 2, z); o.rotation.set(lx, 0, lz); o.scale.set(1, h, 1); o.updateMatrix();
    culms.setMatrixAt(i, o.matrix);
    culms.setColorAt(i, c.setHSL(rand(0.22, 0.27), 0.45, rand(0.3, 0.42)));
    for (let k = 0; k < 5; k++) {
      o.position.set(x + rand(-0.9, 0.9) + lz * h, h * rand(0.62, 1.02), z + rand(-0.9, 0.9) - lx * h);
      o.rotation.set(rand(-0.6, 0.6), rand(0, 6), rand(-0.6, 0.6)); o.scale.set(rand(0.8, 1.4), rand(0.8, 1.4), 0.25); o.updateMatrix();
      leaves.setMatrixAt(i * 5 + k, o.matrix);
      leaves.setColorAt(i * 5 + k, c.setHSL(rand(0.2, 0.28), 0.5, rand(0.25, 0.4)));
    }
  }
  culms.castShadow = leaves.castShadow = true;
  const grp = new THREE.Group();
  grp.add(culms, leaves);
  ctx.scene.add(grp);
  interactive(ctx, grp, {
    name: '竹林', hint: '点击唤起一阵风',
    onClick: () => {
      ctx.windGust = 4;
      ctx.sfx.noise(2.5, { gain: 0.18, freq: 1500, q: 0.3 });
      ctx.toast('风过竹林，沙沙作响');
    },
  });
}

export function createPlants(ctx) {
  const spawn = fallers(ctx);

  const cherry = new THREE.Group();
  cherry.position.set(-21.5, groundHeight(-21.5, -14.5), -14.5);
  const ct = branchTree({ depth: 5, len: 2.0, rad: 0.32, bark: 0x4a3530, spread: 0.85, lift: 0.25 });
  cherry.add(ct.trunk, foliage(ctx, ct.tips, 'cherry', 5));
  cherry.scale.setScalar(1.15);
  ctx.scene.add(cherry);

  const maple = new THREE.Group();
  maple.position.set(-23, groundHeight(-23, 9), 9);
  const mt = branchTree({ depth: 5, len: 1.7, rad: 0.25, bark: 0x3d2b22, spread: 0.8, lift: 0.4 });
  maple.add(mt.trunk, foliage(ctx, mt.tips, 'maple', 4, [0.25, 0.4]));
  ctx.scene.add(maple);

  const tipsWorld = (grp, tips) => tips.map((t) => grp.localToWorld(t.clone()));
  cherry.updateMatrixWorld(true); maple.updateMatrixWorld(true);
  const cherryTips = tipsWorld(cherry, ct.tips), mapleTips = tipsWorld(maple, mt.tips);
  const pickTip = (arr) => arr[(Math.random() * arr.length) | 0];

  // Ambient fall follows the season; a click shakes loose a burst (snow clumps in winter).
  const accs = { cherry: 0, maple: 0 };
  const TIPS = { cherry: cherryTips, maple: mapleTips };
  ctx.updaters.push((dt) => {
    for (const key of ['cherry', 'maple']) {
      const cfg = ctx.season.trees[key];
      accs[key] += dt * cfg.fall * (1 + ctx.uWind.value);
      while (accs[key] > 1) { accs[key] -= 1; spawn(pickTip(TIPS[key]), 0.4, cfg.colors, 1); }
    }
  });
  const shake = (key, grp, bursts, h) => {
    const cfg = ctx.season.trees[key];
    for (let i = 0; i < bursts; i++) spawn(pickTip(TIPS[key]), 0.6, cfg.colors, 7);
    if (key === 'cherry' && ctx.season.id === 'spring') ctx.sfx.chime();
    else ctx.sfx.noise(0.8, { gain: 0.1, freq: 2500, q: 0.4 });
    say(ctx, grp, cfg.say, h);
  };
  interactive(ctx, cherry, { name: '枝垂樱', hint: '点击摇动树枝', onClick: () => shake('cherry', cherry, 12, 7.5) });
  interactive(ctx, maple, { name: '枫树', hint: '点击摇动树枝', onClick: () => shake('maple', maple, 8, 6.5) });

  pine(ctx, 14, -16.6, 1.1);
  pine(ctx, -24, -1.5, 0.95);
  bamboo(ctx);
}
