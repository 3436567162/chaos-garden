import * as THREE from 'three';
import { rand, mesh, std, makeRockGeometry, rockMaterial, interactive, noise3, clamp, smooth, say } from './util.js';
import { SAND, ISLANDS } from './sand.js';

export const WALL = { x: 27, zBack: -19, zFront: 14, h: 2.6 };
export const PAGODA_POS = new THREE.Vector3(20.5, 0, -15.2);

export function createGarden(ctx) {
  ground(ctx);
  curb(ctx);
  islands(ctx);
  walls(ctx);
  veranda(ctx);
  path(ctx);
}

export function groundHeight(x, z) {
  const out = Math.max(Math.abs(x) - 29, z < 0 ? -z - 21 : z - 26, 0);
  let y = smooth(clamp(out / 30, 0, 1)) * (7 + noise3(x * 0.04, 1, z * 0.04) * 5);
  const dp = (x - PAGODA_POS.x) ** 2 + (z - PAGODA_POS.z) ** 2;
  y += 0.7 * Math.exp(-dp / 22);
  const inMargin = out === 0 && (Math.abs(x) > SAND.W / 2 + 1 || Math.abs(z) > SAND.D / 2 + 1);
  if (inMargin && z < 13) y += 0.12 * (noise3(x * 0.6, 0, z * 0.6) + 1);
  return y;
}

function ground(ctx) {
  const size = 280, seg = 180;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const moss = new THREE.Color(0x4f6a34), grass = new THREE.Color(0x7a8f4c), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, groundHeight(x, z));
    const inside = Math.abs(x) < WALL.x && z > WALL.zBack && z < 19;
    c.copy(inside ? moss : grass).multiplyScalar(0.85 + 0.3 * (noise3(x * 0.3, 2, z * 0.3) * 0.5 + 0.5));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#c8c8c8'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const v = 150 + Math.random() * 105 | 0;
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.beginPath(); g.arc(Math.random() * 256, Math.random() * 256, Math.random() * 2 + 0.5, 0, 7); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(90, 90);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 1 }));
  m.castShadow = false;
  ctx.scene.add(m);
}

function curb(ctx) {
  const hx = SAND.W / 2 + 0.22, hz = SAND.D / 2 + 0.22;
  const segs = [];
  for (let x = -hx; x < hx - 0.1; x += 1.1) segs.push([x + 0.55, -hz, 0], [x + 0.55, hz, 0]);
  for (let z = -hz; z < hz - 0.1; z += 1.1) segs.push([-hx, z + 0.55, Math.PI / 2], [hx, z + 0.55, Math.PI / 2]);
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std(0x8d8a84, { roughness: 0.9 }), segs.length);
  const o = new THREE.Object3D(), c = new THREE.Color();
  segs.forEach(([x, z, r], i) => {
    o.position.set(x, 0.12, z);
    o.rotation.set(0, r + rand(-0.03, 0.03), 0);
    o.scale.set(1.05, rand(0.26, 0.34), 0.44);
    o.updateMatrix();
    inst.setMatrixAt(i, o.matrix);
    inst.setColorAt(i, c.setHSL(0.08, 0.04, rand(0.42, 0.55)));
  });
  inst.castShadow = inst.receiveShadow = true;
  ctx.scene.add(inst);
}

const ISLAND_INFO = [
  ['蓬莱山 · 三尊石', '仙人所居之岛'],
  ['龟岛', '长寿之龟，静卧砂海'],
  ['鹤岛', '鹤立千年'],
  ['独立石', '一石一世界'],
];

function islands(ctx) {
  const mossMat = std(0x4b6831, { flatShading: true });
  ISLANDS.forEach((isl, idx) => {
    const grp = new THREE.Group();
    grp.position.set(isl.x, SAND.Y, isl.z);
    ctx.scene.add(grp);

    const mg = new THREE.SphereGeometry(1, 28, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const p = mg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const n = 1 + noise3(p.getX(i) * 2 + idx, p.getY(i), p.getZ(i) * 2) * 0.08;
      p.setXYZ(i, p.getX(i) * n, p.getY(i), p.getZ(i) * n);
    }
    mg.computeVertexNormals();
    const mound = mesh(mg, mossMat);
    mound.scale.set(isl.r, 0.32, isl.r * 0.92);
    grp.add(mound);

    const m = isl.main, r = isl.r;
    const specs = [
      [-0.1 * r, -0.05 * r, m * 0.75, m * 1.25, m * 0.6],
      [0.5 * r, 0.3 * r, m * 0.5, m * 0.6, m * 0.45],
      [-0.5 * r, -0.4 * r, m * 0.42, m * 0.42, m * 0.4],
      [0.3 * r, -0.5 * r, m * 0.35, m * 0.18, m * 0.3],
    ];
    const rocks = [];
    specs.slice(0, idx < 2 ? 4 : 2).forEach(([x, z, sx, sy, sz], k) => {
      const rock = mesh(makeRockGeometry(idx * 10 + k * 3.7, 0.7), rockMaterial);
      rock.scale.set(sx, sy, sz);
      rock.position.set(x, sy * 0.3 + 0.1, z);
      rock.rotation.set(rand(-0.08, 0.08), rand(0, Math.PI * 2), rand(-0.08, 0.08));
      rock.userData.baseRot = rock.rotation.clone();
      grp.add(rock);
      rocks.push(rock);
    });

    if (idx < 2) grp.add(azalea(-0.55 * r, 0.45 * r));

    interactive(ctx, grp, {
      name: ISLAND_INFO[idx][0],
      hint: '点击轻敲岩石',
      onClick: (pt, obj) => {
        ctx.sfx.tone(180 + idx * 30, 0.25, { type: 'triangle', gain: 0.3 });
        ctx.sfx.pebble();
        say(ctx, grp, ISLAND_INFO[idx][1], m * 1.6 + 1);
        const rock = rocks.includes(obj) ? obj : rocks[0];
        let t = 0;
        ctx.updaters.push((dt) => {
          t += dt;
          const a = Math.sin(t * 28) * 0.05 * Math.exp(-t * 4);
          rock.rotation.x = rock.userData.baseRot.x + a;
          rock.rotation.z = rock.userData.baseRot.z + a * 0.6;
          if (t > 1.5) return false;
        });
      },
    });
  });
}

// Clipped azalea (karikomi) with tiny pink blossoms.
function azalea(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0.25, z);
  const leaf = std(0x2f5a26, { flatShading: true });
  const blobs = [[0, 0, 0, 0.55], [0.45, -0.05, 0.2, 0.42], [-0.35, -0.08, 0.25, 0.38]];
  for (const [bx, by, bz, s] of blobs) {
    const b = mesh(new THREE.IcosahedronGeometry(1, 1), leaf, bx, by + s * 0.5, bz);
    b.scale.set(s, s * 0.7, s);
    g.add(b);
  }
  const fl = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.05, 0), std(0xf28fb1), 40);
  const o = new THREE.Object3D();
  for (let i = 0; i < 40; i++) {
    const [bx, by, bz, s] = blobs[i % 3];
    const d = new THREE.Vector3(rand(-1, 1), rand(0.2, 1), rand(-1, 1)).normalize();
    o.position.set(bx + d.x * s, by + s * 0.5 + d.y * s * 0.7, bz + d.z * s);
    o.updateMatrix();
    fl.setMatrixAt(i, o.matrix);
  }
  g.add(fl);
  return g;
}

function walls(ctx) {
  const stone = std(0x6d6a64), plaster = std(0xdcc58f, { roughness: 0.95 }), white = std(0xf3eee0);
  const tile = std(0x3b3f45, { roughness: 0.6, metalness: 0.1 });
  const h = WALL.h;
  const seg = (x1, z1, x2, z2) => {
    const L = Math.hypot(x2 - x1, z2 - z1);
    const g = new THREE.Group();
    g.position.set((x1 + x2) / 2, 0, (z1 + z2) / 2);
    g.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    g.add(mesh(new THREE.BoxGeometry(L, 0.5, 0.78), stone, 0, 0.25, 0));
    g.add(mesh(new THREE.BoxGeometry(L, h - 0.5, 0.6), plaster, 0, 0.5 + (h - 0.5) / 2, 0));
    for (let k = 0; k < 3; k++) g.add(mesh(new THREE.BoxGeometry(L + 0.01, 0.06, 0.62), white, 0, h - 0.5 - k * 0.3, 0));
    const shape = new THREE.Shape();
    shape.moveTo(-0.78, 0); shape.lineTo(0.78, 0); shape.lineTo(0, 0.5); shape.closePath();
    const rg = new THREE.ExtrudeGeometry(shape, { depth: L + 0.8, bevelEnabled: false });
    rg.translate(0, 0, -(L + 0.8) / 2);
    rg.rotateY(Math.PI / 2);
    g.add(mesh(rg, tile, 0, h, 0));
    g.add(mesh(new THREE.BoxGeometry(L + 0.9, 0.14, 0.22), tile, 0, h + 0.5, 0));
    ctx.scene.add(g);
  };
  seg(-WALL.x, WALL.zBack, WALL.x, WALL.zBack);
  seg(-WALL.x, WALL.zBack, -WALL.x, WALL.zFront);
  seg(WALL.x, WALL.zBack, WALL.x, WALL.zFront);
}

function veranda(ctx) {
  const g = new THREE.Group();
  g.position.set(0, 0, 16);
  ctx.scene.add(g);
  const dark = std(0x4a3020, { roughness: 0.7 });
  const n = 9, depth = 4.2, pw = depth / n;
  for (let i = 0; i < n; i++) {
    g.add(mesh(new THREE.BoxGeometry(30, 0.12, pw * 0.94), std(i % 2 ? 0x9b6b43 : 0x8a5c37, { roughness: 0.55 }),
      0, 0.66, -depth / 2 + pw * (i + 0.5)));
  }
  g.add(mesh(new THREE.BoxGeometry(30.3, 0.26, 0.26), dark, 0, 0.5, -depth / 2));
  for (const x of [-15, -10, -5, 0, 5, 10, 15]) g.add(mesh(new THREE.BoxGeometry(0.28, 0.6, 0.28), dark, x, 0.3, -depth / 2 + 0.1));
  // Kutsunugi-ishi (shoe-removal stone) and cushions
  const step = mesh(makeRockGeometry(42, 0), rockMaterial, 0, 0.12, -depth / 2 - 0.9);
  step.scale.set(1.3, 0.35, 0.7);
  g.add(step);
  for (const x of [-4.2, -2.6, 3.6]) {
    const cush = mesh(new THREE.BoxGeometry(1, 0.12, 1), std(0x6b2f3a), x, 0.78, 0.2);
    g.add(cush);
  }
  ctx.veranda = g;
}

function path(ctx) {
  const curve = new THREE.CatmullRomCurve3([
    [16.2, 15], [17.5, 12.8], [21.5, 10.5], [23.4, 5], [23, -1.5], [23.6, -7], [21.5, -11.4],
  ].map(([x, z]) => new THREE.Vector3(x, 0, z)));
  ctx.path = curve;
  const L = curve.getLength(), n = Math.floor(L / 1.15);
  const mat = rockMaterial;
  for (let i = 0; i <= n; i++) {
    const p = curve.getPointAt(i / n);
    const s = mesh(makeRockGeometry(i * 1.3 + 5, 0.15, 0x8a867e), mat, p.x + rand(-0.15, 0.15), groundHeight(p.x, p.z) + 0.02, p.z);
    s.scale.set(rand(0.45, 0.6), 0.13, rand(0.4, 0.55));
    s.rotation.y = rand(0, Math.PI);
    ctx.scene.add(s);
  }
}
