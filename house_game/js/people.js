import * as THREE from 'three';
import { mesh, std, interactive, say, rand } from './util.js';
import { groundHeight, WALL } from './garden.js';
import { SAND, ISLANDS } from './sand.js';

const SKIN = 0xf0cfb0;

// Low-poly figure ~1.7 units tall. Feet at y=0, facing +z.
function person({ robe, sash = 0x2b2620, hair = 0x1c1a18, hat = null, bald = false }) {
  const g = new THREE.Group();
  g.userData.noSnow = true;
  const robeM = std(robe, { flatShading: true }), skinM = std(SKIN);
  const legs = [];
  for (const sx of [-0.1, 0.1]) {
    const leg = new THREE.Group();
    leg.position.set(sx, 0.55, 0);
    leg.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6), std(0xeeeeee), 0, -0.25, 0));
    leg.add(mesh(new THREE.BoxGeometry(0.1, 0.06, 0.2), std(0x6b4a2a), 0, -0.52, 0.04));
    g.add(leg); legs.push(leg);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.34, 0.6, 8), robeM, 0, 0.62, 0));
  const upper = new THREE.Group();
  upper.position.y = 0.92;
  g.add(upper);
  upper.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.45, 8), robeM, 0, 0.2, 0));
  upper.add(mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.1, 8), std(sash), 0, 0.02, 0));
  const arms = [];
  for (const sx of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(sx * 0.24, 0.38, 0);
    const sleeve = mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.42, 6), robeM, 0, -0.2, 0);
    arm.add(sleeve);
    arm.add(mesh(new THREE.SphereGeometry(0.05, 6, 5), skinM, 0, -0.44, 0));
    upper.add(arm); arms.push(arm);
  }
  const head = new THREE.Group();
  head.position.y = 0.55;
  upper.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.15, 12, 10), skinM, 0, 0.1, 0));
  for (const sx of [-0.05, 0.05]) head.add(mesh(new THREE.SphereGeometry(0.018, 5, 4), std(0x111111), sx, 0.12, 0.135));
  if (!bald) {
    head.add(mesh(new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.9), std(hair), 0, 0.11, -0.01));
    head.add(mesh(new THREE.SphereGeometry(0.08, 8, 6), std(hair), 0, 0.26, -0.08));
  }
  if (hat) {
    const kasa = mesh(new THREE.ConeGeometry(0.38, 0.2, 14), std(hat, { flatShading: true }), 0, 0.3, 0);
    head.add(kasa);
  }
  g.userData.parts = { legs, arms, upper, head };
  return g;
}

function parasol(color) {
  const p = new THREE.Group();
  p.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.1, 4), std(0x5a3a22), 0, 0.55, 0));
  const top = mesh(new THREE.ConeGeometry(0.6, 0.25, 12, 1, true), std(color, { side: THREE.DoubleSide, flatShading: true }), 0, 1.05, 0);
  p.add(top);
  return p;
}

function walkPose(parts, ph, amp = 0.5) {
  parts.legs[0].rotation.x = Math.sin(ph) * amp;
  parts.legs[1].rotation.x = -Math.sin(ph) * amp;
}

// Turn the head toward a world point (dragon), limited to a natural range.
const _v = new THREE.Vector3();
function lookToward(person, target, dt) {
  const h = person.userData.parts.head;
  h.getWorldPosition(_v);
  const d = _v.distanceTo(target);
  let yaw = 0, pitch = 0;
  if (d < 14) {
    const local = person.worldToLocal(target.clone());
    yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1.2, 1.2);
    pitch = -THREE.MathUtils.clamp(Math.atan2(local.y - 1.6, Math.hypot(local.x, local.z)), -0.3, 0.8);
  }
  h.rotation.y += (yaw - h.rotation.y) * Math.min(1, dt * 4);
  h.rotation.x += (pitch - h.rotation.x) * Math.min(1, dt * 4);
  return d < 14;
}

export function createPeople(ctx) {
  // ——— Monk raking concentric circles around the main island ———
  const isl = ISLANDS[0];
  const monk = person({ robe: 0x3b3d42, sash: 0x8a6d3b, hat: 0xc8b07a, bald: true });
  const rake = new THREE.Group();
  rake.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.68, 5).rotateX(-0.984), std(0x8a6a42), 0, 0.585, 0.85));
  const rakeHead = mesh(new THREE.BoxGeometry(0.9, 0.06, 0.06), std(0x8a6a42), 0, 0.1, 1.55);
  rake.add(rakeHead);
  for (let i = -4; i <= 4; i++) rake.add(mesh(new THREE.BoxGeometry(0.02, 0.1, 0.02), std(0x6a4a2a), i * 0.1, 0.03, 1.55));
  monk.add(rake);
  rake.rotation.y = Math.PI; // rake trails behind
  ctx.scene.add(monk);
  const monkSt = { a: 0, pause: 0, bow: 0 };
  // Walk radius chosen so the trailing rake head lands exactly on the island's 3rd groove ring.
  const ringR = isl.r + 2.5;
  const walkR = Math.sqrt(ringR * ringR - 1.55 * 1.55);
  const stroke = new ctx.sand.Stroke();
  const headW = new THREE.Vector3();
  const LINES = ['南无阿弥陀佛', '一期一会', '心静自然凉', '砂纹即心纹'];
  ctx.updaters.push((dt, t) => {
    if (monkSt.pause > 0) {
      monkSt.pause -= dt;
      monkSt.bow = Math.min(1, monkSt.bow + dt * 3);
      if (monkSt.pause <= 0) stroke.pts.length = 0;
    } else {
      monkSt.bow = Math.max(0, monkSt.bow - dt * 3);
      monkSt.a += dt * 0.12;
    }
    const a = monkSt.a;
    monk.position.set(isl.x + Math.cos(a) * walkR, SAND.Y, isl.z + Math.sin(a) * walkR);
    monk.rotation.y = -a; // tangent direction (+a heading)
    const p = monk.userData.parts;
    walkPose(p, t * 4, monkSt.pause > 0 ? 0 : 0.35);
    p.upper.rotation.x = 0.2 + monkSt.bow * 0.6;
    p.arms.forEach((arm) => (arm.rotation.x = 0.5 - monkSt.bow * 1.7));
    if (monkSt.pause <= 0) {
      monk.updateMatrixWorld(true);
      rakeHead.getWorldPosition(headW);
      stroke.add(headW.x, headW.z);
    }
  });
  interactive(ctx, monk, {
    name: '耙砂僧', hint: '点击与僧人问候',
    onClick: () => {
      monkSt.pause = 2.2;
      ctx.sfx.gong();
      say(ctx, monk, LINES[(Math.random() * LINES.length) | 0], 2.3);
    },
  });

  // ——— Visitors strolling the stepping-stone path ———
  const visitors = [
    { robe: 0xc0466b, sash: 0xf2d16b, umb: 0xd94f4f, u: 0.1, dir: 1, speed: 0.022 },
    { robe: 0x3f6aa8, sash: 0xefe6d2, umb: 0x6a8fd0, u: 0.7, dir: -1, speed: 0.018 },
  ].map((v, k) => {
    const p = person({ robe: v.robe, sash: v.sash });
    const umb = parasol(v.umb);
    umb.position.set(0.24, 0.45, 0.1);
    umb.rotation.z = -0.2;
    p.userData.parts.upper.add(umb);
    p.userData.parts.arms[1].rotation.x = -0.9;
    ctx.scene.add(p);
    const st = { ...v, wave: 0, scared: 0, obj: p, umb };
    interactive(ctx, p, {
      name: k ? '游人 · 雪' : '游人 · 樱', hint: '点击打招呼',
      onClick: () => {
        st.wave = 2;
        ctx.sfx.tone(880, 0.15, { gain: 0.1 });
        ctx.sfx.tone(1100, 0.2, { gain: 0.1, delay: 0.12 });
        say(ctx, p, ['こんにちは！', '好美的庭院～', '今天天气真好'][(Math.random() * 3) | 0], 2.3);
      },
    });
    return st;
  });
  const tmp = new THREE.Vector3();
  ctx.updaters.push((dt, t) => {
    for (const v of visitors) {
      const p = v.obj, parts = p.userData.parts;
      const sees = ctx.dragon && lookToward(p, ctx.dragon.headPos, dt);
      v.cool = (v.cool ?? 0) - dt;
      if (sees && v.cool <= 0 && Math.random() < dt * 0.8) { v.scared = 2; v.cool = 15; say(ctx, p, '哇！龙！', 2.3, 1.8); }
      v.scared -= dt;
      const moving = v.wave <= 0 && v.scared <= 0;
      if (moving) {
        v.u += v.dir * v.speed * dt;
        if (v.u > 0.98 || v.u < 0.02) { v.dir *= -1; v.u = THREE.MathUtils.clamp(v.u, 0.02, 0.98); }
      }
      v.wave -= dt;
      const pos = ctx.path.getPointAt(v.u);
      ctx.path.getTangentAt(v.u, tmp).multiplyScalar(v.dir);
      p.position.set(pos.x, groundHeight(pos.x, pos.z) + 0.07, pos.z);
      const want = Math.atan2(tmp.x, tmp.z);
      let dy = want - p.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      p.rotation.y += dy * Math.min(1, dt * 5);
      walkPose(parts, t * 6 + v.u * 50, moving ? 0.45 : 0);
      p.position.y += moving ? Math.abs(Math.sin(t * 6)) * 0.03 : 0;
      parts.arms[0].rotation.x = v.wave > 0 ? -2.6 : moving ? Math.sin(t * 6) * 0.3 : 0;
      parts.arms[0].rotation.z = v.wave > 0 ? -0.3 + Math.sin(t * 14) * 0.35 : 0;
      v.umb.rotation.y += dt * (v.scared > 0 ? 8 : 0.4);
    }
  });

  // ——— Tea master kneeling (seiza) on the veranda ———
  const tea = person({ robe: 0x4a5a3a, sash: 0x2b2620, hair: 0x6e6a64 });
  const tp = tea.userData.parts;
  tp.legs.forEach((l) => (l.visible = false));
  tea.position.set(-3.4, 0.72 - 0.32 * 0.95, 16.9);
  tea.rotation.y = Math.PI;
  tea.scale.setScalar(0.95);
  ctx.scene.add(tea);
  let pour = 0;
  ctx.updaters.push((dt, t) => {
    pour = Math.max(0, pour - dt);
    tp.upper.rotation.x = 0.1 + Math.sin(t * 0.8) * 0.03 + (pour > 0 ? Math.sin((pour / 2) * Math.PI) * 0.45 : 0);
    tp.arms.forEach((a) => (a.rotation.x = -0.6 - (pour > 0 ? 0.5 : 0)));
  });
  interactive(ctx, tea, {
    name: '茶人', hint: '点击请茶',
    onClick: () => {
      pour = 2;
      ctx.sfx.water();
      say(ctx, tea, '请用茶 · 和敬清寂', 2.1);
    },
  });

  // ——— Cat on the wall ———
  const cat = new THREE.Group();
  cat.userData.noSnow = true;
  const fur = std(0xe7a25a, { flatShading: true }), white = std(0xf5efe4);
  cat.add(mesh(new THREE.SphereGeometry(0.28, 8, 6).scale(1, 0.9, 1.5), fur, 0, 0.25, 0));
  const chead = new THREE.Group();
  chead.position.set(0, 0.55, 0.35);
  cat.add(chead);
  chead.add(mesh(new THREE.SphereGeometry(0.2, 8, 7), fur));
  chead.add(mesh(new THREE.SphereGeometry(0.1, 6, 5), white, 0, -0.06, 0.12));
  for (const sx of [-0.1, 0.1]) {
    chead.add(mesh(new THREE.ConeGeometry(0.07, 0.15, 4), fur, sx, 0.2, 0));
    chead.add(mesh(new THREE.SphereGeometry(0.03, 5, 4), std(0x1a1a1a), sx * 0.8, 0.04, 0.17));
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.2, -0.38);
  tail.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 5), fur, 0, 0.3, 0));
  cat.add(tail);
  cat.position.set(-WALL.x, WALL.h + 0.57, -6);
  cat.rotation.y = Math.PI / 2;
  ctx.scene.add(cat);
  let catJump = 0;
  ctx.updaters.push((dt, t) => {
    catJump = Math.max(0, catJump - dt);
    tail.rotation.z = Math.sin(t * (catJump > 0 ? 12 : 2)) * 0.5;
    tail.rotation.x = -0.4;
    cat.position.y = WALL.h + 0.57 + Math.sin(Math.min(1, catJump / 0.8) * Math.PI) * 0.8;
    if (ctx.dragon && ctx.dragon.headPos.distanceTo(cat.position) < 25) chead.lookAt(ctx.dragon.headPos);
    else chead.rotation.set(0, Math.sin(t * 0.3) * 0.6, 0);
  });
  interactive(ctx, cat, {
    name: '屋顶猫', hint: '点击撸猫',
    onClick: () => {
      catJump = 1;
      ctx.sfx.meow();
      say(ctx, cat, ['喵～', '喵呜！', '…zzZ'][(Math.random() * 3) | 0], 1.3, 1.6);
    },
  });
}
