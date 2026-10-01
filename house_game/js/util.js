import * as THREE from 'three';

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);

export function shadow(obj, cast = true, receive = true) {
  obj.traverse((o) => {
    if (o.isMesh || o.isInstancedMesh) { o.castShadow = cast; o.receiveShadow = receive; }
  });
  return obj;
}

export function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export const std = (color, opts = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts });

// Cheap smooth 3D value-noise built from sines; good enough for rocks and terrain.
export function noise3(x, y, z) {
  return (
    Math.sin(x * 1.7 + Math.sin(z * 1.3)) * 0.5 +
    Math.sin(y * 2.3 + Math.cos(x * 1.1)) * 0.3 +
    Math.sin(z * 2.9 + y * 1.9 + Math.sin(x * 3.1)) * 0.2
  );
}

const MOSS = new THREE.Color(0x5d7a3a);
export function makeRockGeometry(seed = Math.random() * 100, mossy = 0.6, base = 0x77736c) {
  const geo = new THREE.IcosahedronGeometry(1, 3); // polyhedra are already non-indexed
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 1.6 + seed, v.y * 1.6 - seed, v.z * 1.6 + seed * 0.5);
    const n2 = noise3(v.x * 4 + seed, v.y * 4, v.z * 4 - seed) * 0.08;
    v.multiplyScalar(1 + n * 0.22 + n2);
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.2; // flatten the buried base
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const baseC = new THREE.Color(base);
  for (let i = 0; i < pos.count; i += 3) {
    const ny = (nrm.getY(i) + nrm.getY(i + 1) + nrm.getY(i + 2)) / 3;
    const tint = rand(0.85, 1.1);
    c.copy(baseC).multiplyScalar(tint);
    if (ny > 0.55 && Math.random() < mossy) c.lerp(MOSS, clamp((ny - 0.55) * 2.5, 0, 0.9));
    for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export const rockMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.95, flatShading: true,
});

// Speech-bubble style text sprite.
export function textSprite(text, { size = 0.6, bg = 'rgba(251,247,236,0.95)', fg = '#2b2620' } = {}) {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const font = '600 44px "Noto Serif SC", "SimSun", serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 48;
  cv.width = w; cv.height = 96;
  ctx.font = font;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(4, 4, w - 8, 72, 24);
  ctx.moveTo(w / 2 - 12, 74); ctx.lineTo(w / 2, 92); ctx.lineTo(w / 2 + 12, 74);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, 42);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(size * w / 96, size, 1);
  sp.renderOrder = 999;
  return sp;
}

// Pop a bubble above an object for a few seconds.
export function say(ctx, parent, text, height = 2.4, dur = 2.6) {
  if (parent.userData.bubble) parent.remove(parent.userData.bubble);
  const sp = textSprite(text);
  sp.position.y = height;
  parent.add(sp);
  parent.userData.bubble = sp;
  let t = 0;
  ctx.updaters.push(function fade(dt) {
    t += dt;
    sp.material.opacity = t < dur - 0.5 ? 1 : Math.max(0, (dur - t) / 0.5);
    sp.position.y = height + Math.min(t, 0.3) * 0.5;
    if (t >= dur) {
      parent.remove(sp);
      if (parent.userData.bubble === sp) parent.userData.bubble = null;
      return false; // remove updater
    }
  });
}

// Register an object as clickable. `info` = { name, hint, onClick(hitPoint) }
export function interactive(ctx, obj, info) {
  obj.userData.interactive = info;
  ctx.interactives.push(obj);
}
