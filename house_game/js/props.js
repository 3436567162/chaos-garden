import * as THREE from 'three';
import { rand, mesh, std, interactive, say, makeRockGeometry, rockMaterial, clamp } from './util.js';
import { groundHeight } from './garden.js';

const stoneMat = std(0x8f8b82, { roughness: 0.95, flatShading: true });

function lantern(ctx, x, z, rotY = 0, s = 1) {
  const g = new THREE.Group();
  g.position.set(x, groundHeight(x, z), z);
  g.rotation.y = rotY;
  g.scale.setScalar(s);
  const add = (geo, y) => g.add(mesh(geo, stoneMat, 0, y, 0));
  add(new THREE.CylinderGeometry(0.55, 0.65, 0.25, 6), 0.12);
  add(new THREE.CylinderGeometry(0.17, 0.2, 1.1, 8), 0.8);
  add(new THREE.CylinderGeometry(0.5, 0.38, 0.22, 6), 1.45);
  const glowMat = new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffaa44, emissiveIntensity: 0, roughness: 1 });
  g.add(mesh(new THREE.BoxGeometry(0.42, 0.42, 0.42), glowMat, 0, 1.78, 0));
  for (const [px, pz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.46, 0.12), stoneMat, px * 0.24, 1.78, pz * 0.24));
  }
  const roof = mesh(new THREE.ConeGeometry(0.85, 0.5, 6), stoneMat, 0, 2.25, 0);
  g.add(roof);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const curl = mesh(new THREE.SphereGeometry(0.07, 5, 4), stoneMat, Math.cos(a) * 0.8, 2.07, Math.sin(a) * 0.8);
    g.add(curl);
  }
  add(new THREE.SphereGeometry(0.16, 8, 6), 2.6);
  add(new THREE.ConeGeometry(0.1, 0.2, 8), 2.82);
  const light = new THREE.PointLight(0xffb060, 0, 9, 1.6);
  light.position.set(0, 1.8, 0);
  g.add(light);
  ctx.scene.add(g);

  const st = { level: 0, manual: null };
  ctx.updaters.push((dt, t) => {
    const want = st.manual ?? ctx.night > 0.5;
    st.level += ((want ? 1 : 0) - st.level) * Math.min(1, dt * 4);
    const flicker = 0.9 + Math.sin(t * 13 + x) * 0.05 + Math.sin(t * 7.3 + z) * 0.05;
    glowMat.emissiveIntensity = st.level * 2.2 * flicker;
    light.intensity = st.level * 9 * flicker;
  });
  ctx.lanterns.push(st);
  interactive(ctx, g, {
    name: '石灯笼', hint: '点击点亮 / 熄灭',
    onClick: () => {
      const on = !(st.manual ?? ctx.night > 0.5);
      st.manual = on;
      ctx.sfx.tone(on ? 660 : 330, 0.3, { type: 'triangle', gain: 0.15 });
      if (on) say(ctx, g, '灯 · 明', 3.3, 1.6);
    },
  });
}

// Shishi-odoshi (deer scarer) + tsukubai basin.
function shishiOdoshi(ctx, x, z, rotY) {
  const root = new THREE.Group();
  root.position.set(x, groundHeight(x, z), z);
  root.rotation.y = rotY;
  ctx.scene.add(root);
  const bamboo = std(0x9aa548, { roughness: 0.5 }), dry = std(0x8a7a4a), rope = std(0x5a4630);

  // pebble bed + water pool
  const pool = mesh(new THREE.CylinderGeometry(1.6, 1.7, 0.1, 24), std(0x56524a), 0, 0.03, 0.4);
  root.add(pool);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x3d6b72, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.8 });
  waterMat.userData.noSnow = true;
  root.add(mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.02, 24), waterMat, 0, 0.09, 0.4));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, s = rand(0.25, 0.4);
    const r = mesh(makeRockGeometry(i * 2.1, 0.5), rockMaterial, Math.cos(a) * 1.65, 0.08, 0.4 + Math.sin(a) * 1.65);
    r.scale.set(s, s * 0.6, s);
    root.add(r);
  }

  // posts + pivoting tube
  for (const sx of [-0.25, 0.25]) root.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 8), dry, sx, 0.45, 0));
  root.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6).rotateZ(Math.PI / 2), rope, 0, 0.62, 0));
  const pivot = new THREE.Group();
  pivot.position.set(0, 0.62, 0);
  root.add(pivot);
  const tube = mesh(new THREE.CylinderGeometry(0.09, 0.1, 2.0, 12, 1, true).rotateX(Math.PI / 2), bamboo, 0, 0, 0.2);
  tube.material = bamboo.clone(); tube.material.side = THREE.DoubleSide;
  pivot.add(tube);
  pivot.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.04, 12).rotateX(Math.PI / 2), bamboo, 0, 0, -0.78));
  for (const nz of [-0.3, 0.5]) pivot.add(mesh(new THREE.TorusGeometry(0.1, 0.015, 6, 12), bamboo, 0, 0, nz));
  const strike = mesh(makeRockGeometry(7, 0.3), rockMaterial, 0, 0.12, -0.85);
  strike.scale.set(0.3, 0.2, 0.3);
  root.add(strike);

  // kakei spout feeding the tube
  const post = mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.7, 10), bamboo, 0, 0.85, 2.4);
  root.add(post);
  root.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 8).rotateX(Math.PI / 2), bamboo, 0, 1.55, 1.75));
  const streamMat = new THREE.MeshBasicMaterial({ color: 0xbfe6ee, transparent: true, opacity: 0.6 });
  const stream = mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 6), streamMat, 0, 0, 1.12);
  // stone tsukubai basin beside the pool
  const basin = mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.7, 10), stoneMat, 1.9, 0.35, 1.6);
  root.add(basin);
  root.add(mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.02, 16), waterMat, 1.9, 0.69, 1.6));
  const ladle = new THREE.Group();
  ladle.position.set(1.9, 0.74, 1.6);
  ladle.rotation.y = 0.6;
  ladle.add(mesh(new THREE.BoxGeometry(1.0, 0.025, 0.03), dry, 0.1, 0, 0));
  ladle.add(mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.1, 10), dry, -0.42, 0.04, 0));
  root.add(ladle);
  stream.castShadow = false;
  root.add(stream);

  const UP_ANG = -0.42, DOWN_ANG = 0.42;
  const s = { phase: 'fill', level: 0, ang: UP_ANG, vel: 0 };
  ctx.updaters.push((dt) => {
    if (s.phase === 'fill') {
      s.level += dt / 6;
      s.ang = UP_ANG + s.level * 0.15;
      if (s.level >= 1) s.phase = 'tip';
    } else if (s.phase === 'tip') {
      s.ang += dt * 3.5;
      if (s.ang >= DOWN_ANG) { s.ang = DOWN_ANG; s.phase = 'pour'; s.t = 0; ctx.sfx.water(); }
    } else if (s.phase === 'pour') {
      s.t += dt;
      if (s.t > 0.5) { s.phase = 'return'; s.level = 0; }
    } else if (s.phase === 'return') {
      s.vel -= dt * 14;
      s.ang += s.vel * dt;
      if (s.ang <= UP_ANG) {
        s.ang = UP_ANG; s.vel = 0; s.phase = 'fill';
        ctx.sfx.clack();
      }
    }
    pivot.rotation.x = s.ang;
    // stream from spout (y=1.55) down to the tube's mouth
    const mouthY = 0.62 + Math.sin(-s.ang) * 1.2 + 0.05;
    const top = 1.52, bot = clamp(mouthY, 0.1, top - 0.05);
    stream.scale.y = top - bot;
    stream.position.y = (top + bot) / 2;
  });
  interactive(ctx, root, {
    name: '鹿威し · 蹲踞', hint: '点击让竹筒立刻倾倒',
    onClick: () => {
      if (s.phase === 'fill') s.level = 1;
      say(ctx, root, '咚——', 2.4, 1.4);
    },
  });
}

function teaSet(ctx) {
  const g = ctx.veranda;
  const tray = mesh(new THREE.BoxGeometry(0.9, 0.05, 0.55), std(0x2a1a12), -3.4, 0.75, 0.2);
  g.add(tray);
  const pot = mesh(new THREE.SphereGeometry(0.16, 12, 8), std(0x3a2a22, { roughness: 0.4 }), -3.6, 0.9, 0.2);
  g.add(pot);
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.16, 6).rotateZ(-1), std(0x3a2a22), -3.42, 0.93, 0.2));
  for (const dx of [-3.25, -3.1]) g.add(mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.08, 10), std(0x9bb59a, { roughness: 0.3 }), dx, 0.82, 0.25));
  const steam = [];
  for (let i = 0; i < 4; i++) {
    const sp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false }));
    g.add(sp); steam.push(sp);
  }
  ctx.updaters.push((dt, t) => steam.forEach((sp, i) => {
    const k = (t * 0.4 + i / 4) % 1;
    sp.position.set(-3.25 + Math.sin(t * 2 + i) * 0.04, 0.9 + k * 0.6, 0.25);
    sp.scale.setScalar(1 + k * 2);
    sp.material.opacity = 0.35 * (1 - k);
  }));
}

export function createProps(ctx) {
  [[18.3, -13.6, 0.4, 1], [-25, -10.5, 0.3, 0.9], [-21.5, 4, -0.2, 0.85], [24.6, 1.5, 0.1, 0.8], [12.5, 12.6, 0.6, 0.85]]
    .forEach(([x, z, r, s]) => lantern(ctx, x, z, r, s));
  shishiOdoshi(ctx, 21.8, 14.6, -Math.PI / 2.4);
  teaSet(ctx);
}
