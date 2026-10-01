import * as THREE from 'three';
import { mesh, std, interactive, say } from './util.js';
import { groundHeight, PAGODA_POS } from './garden.js';

// Roof surface height at radial fraction t (0 = apex, 1 = eave) and lateral s (±1 = hip corner).
const roofY = (t, s, height, curl) =>
  height * (1 - t) - Math.sin(t * Math.PI) * height * 0.22 + Math.pow(t, 4) * curl * (0.3 + Math.abs(s) ** 3);

// Pyramidal roof with a concave slope and eaves that sweep up toward the corners. Base at y=0.
function roofGeometry(halfW, height, curl) {
  const NU = 14, NV = 10, pos = [], idx = [];
  for (let f = 0; f < 4; f++) {
    const a = (f * Math.PI) / 2, nx = Math.sin(a), nz = Math.cos(a), tx = Math.cos(a), tz = -Math.sin(a);
    const base = pos.length / 3;
    for (let j = 0; j <= NV; j++) {
      const t = j / NV;
      for (let i = 0; i <= NU; i++) {
        const s = -1 + (2 * i) / NU;
        pos.push((nx + tx * s) * halfW * t, roofY(t, s, height, curl), (nz + tz * s) * halfW * t);
      }
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
      const p = base + j * (NU + 1) + i, q = p + NU + 1;
      idx.push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function createPagoda(ctx) {
  const root = new THREE.Group();
  const gy = groundHeight(PAGODA_POS.x, PAGODA_POS.z);
  root.position.set(PAGODA_POS.x, gy - 0.05, PAGODA_POS.z);
  root.rotation.y = -0.25;
  ctx.scene.add(root);

  const vermil = std(0xb8322a, { roughness: 0.6 });
  const white = std(0xf1ebde);
  const wood = std(0x5a3322, { roughness: 0.7 });
  const tile = std(0x3a3e44, { roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide });
  const under = std(0x2a1c16, { side: THREE.DoubleSide });
  const stone = std(0x8f8b82, { flatShading: true });
  const gold = std(0xc9a24a, { roughness: 0.35, metalness: 0.8 });
  const bronze = std(0x6f7d55, { roughness: 0.4, metalness: 0.7 });
  const windowMat = new THREE.MeshStandardMaterial({ color: 0x3a2618, emissive: 0xffa040, emissiveIntensity: 0 });

  root.add(mesh(new THREE.BoxGeometry(5.4, 0.35, 5.4), stone, 0, 0.17, 0));
  root.add(mesh(new THREE.BoxGeometry(4.7, 0.35, 4.7), stone, 0, 0.52, 0));
  root.add(mesh(new THREE.BoxGeometry(1.4, 0.18, 0.5), stone, 0, 0.09, 2.95));
  root.add(mesh(new THREE.BoxGeometry(1.4, 0.18, 0.4), stone, 0, 0.27, 2.7));

  const bells = [];
  let y = 0.7;
  const TIERS = 5;
  for (let i = 0; i < TIERS; i++) {
    const w = 3.6 - i * 0.42;          // body width
    const bh = 1.3 - i * 0.08;         // body height
    const ew = w / 2 + 1.25 - i * 0.1; // eave half-width
    const tier = new THREE.Group();
    tier.position.y = y;
    root.add(tier);
    tier.add(mesh(new THREE.BoxGeometry(w, bh, w), white, 0, bh / 2, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      tier.add(mesh(new THREE.BoxGeometry(0.2, bh, 0.2), vermil, sx * w / 2, bh / 2, sz * w / 2));
    }
    for (let f = 0; f < 4; f++) {
      const a = (f * Math.PI) / 2;
      const door = mesh(new THREE.BoxGeometry(w * 0.32, bh * 0.68, 0.06), windowMat, Math.sin(a) * w / 2, bh * 0.42, Math.cos(a) * w / 2);
      door.rotation.y = a;
      tier.add(door);
      const beam = mesh(new THREE.BoxGeometry(w + 0.1, 0.16, 0.12), vermil, Math.sin(a) * (w / 2 + 0.02), bh - 0.08, Math.cos(a) * (w / 2 + 0.02));
      beam.rotation.y = a;
      tier.add(beam);
    }
    // bracket layer (tokyō) under the eave
    tier.add(mesh(new THREE.BoxGeometry(w + 0.7, 0.28, w + 0.7), wood, 0, bh + 0.14, 0));
    if (i === 0) {
      // balcony rail around the first floor
      tier.add(mesh(new THREE.BoxGeometry(w + 1.2, 0.1, w + 1.2), wood, 0, 0.05, 0));
    }
    const rh = 0.95 - i * 0.05, curl = 0.65;
    tier.add(mesh(roofGeometry(ew, rh, curl), tile, 0, bh + 0.28, 0));
    tier.add(mesh(roofGeometry(ew - 0.05, rh, curl), under, 0, bh + 0.2, 0));

    // wind bells at the four eave tips
    const tipY = bh + 0.28 + curl * 1.3 - 0.1;
    for (let c = 0; c < 4; c++) {
      const a = Math.PI / 4 + (c * Math.PI) / 2;
      const d = ew * Math.SQRT2 * 0.97;
      const piv = new THREE.Group();
      piv.position.set(Math.sin(a) * d, tipY, Math.cos(a) * d);
      piv.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 4), bronze, 0, -0.15, 0));
      piv.add(mesh(new THREE.CylinderGeometry(0.08, 0.13, 0.26, 8), bronze, 0, -0.42, 0));
      piv.add(mesh(new THREE.BoxGeometry(0.1, 0.16, 0.01), std(0xe9e1c8), 0, -0.66, 0));
      piv.userData.swing = 0;
      piv.userData.pitch = 1 + i * 0.12 + c * 0.03;
      tier.add(piv);
      bells.push(piv);
    }
    // next storey sits where the roof surface meets its walls
    const tNext = Math.min(1, (w - 0.42) / 2 / ew);
    y += bh + 0.28 + roofY(tNext, 0, rh, curl) - 0.03;
  }

  // Sōrin spire: nine rings, water-flame, jewel.
  const spire = new THREE.Group();
  spire.position.y = y - 0.05;
  root.add(spire);
  spire.add(mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.35, 8), bronze, 0, 0.17, 0));
  spire.add(mesh(new THREE.SphereGeometry(0.3, 10, 8), bronze, 0, 0.5, 0));
  spire.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 8), gold, 0, 2.1, 0));
  for (let r = 0; r < 9; r++) spire.add(mesh(new THREE.TorusGeometry(0.3 - r * 0.012, 0.045, 6, 16).rotateX(Math.PI / 2), gold, 0, 1.0 + r * 0.22, 0));
  for (let f = 0; f < 4; f++) {
    const flame = mesh(new THREE.ConeGeometry(0.12, 0.6, 4), gold, 0, 3.25, 0);
    flame.rotation.set(0.5, (f * Math.PI) / 2, 0, 'YXZ');
    flame.position.set(Math.sin((f * Math.PI) / 2) * 0.15, 3.2, Math.cos((f * Math.PI) / 2) * 0.15);
    spire.add(flame);
  }
  const jewel = mesh(new THREE.SphereGeometry(0.16, 12, 10), std(0xe8c35a, { metalness: 0.9, roughness: 0.2, emissive: 0x553300 }), 0, 3.75, 0);
  spire.add(jewel);
  root.userData.top = y + 3.8;

  function ring(b, strength = 1) {
    b.userData.swing = Math.max(b.userData.swing, strength);
    ctx.sfx.bell(b.userData.pitch);
  }
  ctx.updaters.push((dt, t) => {
    const breeze = ctx.uWind.value;
    for (const b of bells) {
      b.userData.swing *= Math.exp(-dt * 1.2);
      b.rotation.z = Math.sin(t * 9 + b.userData.pitch * 7) * b.userData.swing * 0.5 + Math.sin(t * 1.3 + b.userData.pitch * 3) * 0.04 * breeze;
      b.rotation.x = Math.cos(t * 7 + b.userData.pitch * 5) * b.userData.swing * 0.3;
    }
    // occasional random chime when the wind picks up
    if (Math.random() < dt * 0.08 * breeze) ring(bells[(Math.random() * bells.length) | 0], 0.3);
    windowMat.emissiveIntensity = ctx.night * 1.6;
    jewel.material.emissiveIntensity = 0.3 + ctx.night * 2;
  });

  interactive(ctx, root, {
    name: '五重塔', hint: '点击风铃、塔刹或塔身',
    onClick: (pt, obj) => {
      let o = obj;
      while (o && o !== root) {
        if (bells.includes(o)) { ring(o); return; }
        if (o === spire) {
          ctx.sfx.gong();
          bells.forEach((b, k) => setTimeout(() => ring(b, 0.8), k * 70));
          say(ctx, spire, '诸行无常', 4.6, 3);
          return;
        }
        o = o.parent;
      }
      // tier clicked: ring the bells of the nearest tier
      const local = root.worldToLocal(pt.clone());
      const near = bells.slice().sort((a, b) => Math.abs(a.parent.position.y - local.y) - Math.abs(b.parent.position.y - local.y)).slice(0, 4);
      near.forEach((b, k) => setTimeout(() => ring(b), k * 120));
    },
  });
  ctx.pagoda = root;
}
