import * as THREE from 'three';
import { mesh, std, interactive, rand, clamp, smooth, lerp } from './util.js';
import { PAGODA_POS } from './garden.js';

const N = 90;          // spine samples, head → tail
const RS = 14;         // radial segments
const SPACING = 0.17;  // arc length between spine samples
const UPV = new THREE.Vector3(0, 1, 0);

// Lazy wandering loop over the garden; lifts up to clear the pagoda.
function flightPath(u, out) {
  const x = Math.sin(u) * 22 + Math.sin(u * 2.1) * 4;
  const z = Math.sin(u * 2) * 11 - 3 + Math.cos(u * 0.9) * 3;
  let y = 9 + Math.sin(u * 1.7) * 3 + Math.cos(u * 0.6) * 2;
  for (const [ox, oz, rad, top] of OBSTACLES) {
    const d = Math.hypot(x - ox, z - oz);
    if (d < rad) y = lerp(y, Math.max(y, top), smooth(1 - d / rad));
  }
  return out.set(x, y, z);
}
// [x, z, influence radius, min altitude] — pagoda, cherry, back pine
const OBSTACLES = [[PAGODA_POS.x, PAGODA_POS.z, 8, 19.5], [-21.5, -14.5, 7, 12], [14, -16.6, 5, 10]];

function scaleTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#b0b0b0'; g.fillRect(0, 0, 128, 128);
  for (let row = -1; row <= 4; row++) for (let col = -1; col <= 4; col++) {
    const x = col * 32 + (((row % 2) + 2) % 2) * 16, y = row * 32;
    const grd = g.createRadialGradient(x, y, 2, x, y, 22);
    grd.addColorStop(0, '#fff'); grd.addColorStop(0.75, '#e4e4e4'); grd.addColorStop(1, '#909090');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, 20, 0, Math.PI); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildHead() {
  const jade = std(0x2e8b6e, { roughness: 0.45, metalness: 0.2 });
  const gold = std(0xe2b84f, { roughness: 0.35, metalness: 0.6 });
  const red = std(0xd8442a, { flatShading: true });
  const ivory = std(0xf6efdc);
  const head = new THREE.Group();
  head.add(mesh(new THREE.SphereGeometry(0.45, 14, 10).scale(1, 0.85, 1.1), jade, 0, 0.05, 0));
  const snout = mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.8, 7).rotateX(Math.PI / 2).scale(1.25, 1, 1), jade, 0, -0.02, 0.62);
  head.add(snout);
  head.add(mesh(new THREE.SphereGeometry(0.17, 10, 8).scale(1.3, 0.8, 1), jade, 0, 0.04, 1.02));
  for (const sx of [-0.08, 0.08]) head.add(mesh(new THREE.SphereGeometry(0.04, 6, 5), std(0x112218), sx, 0.1, 1.15));
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.15, 0.2);
  jaw.add(mesh(new THREE.BoxGeometry(0.42, 0.1, 0.85), gold, 0, -0.05, 0.42));
  for (let k = 0; k < 5; k++) for (const sx of [-0.16, 0.16]) {
    jaw.add(mesh(new THREE.ConeGeometry(0.03, 0.1, 4), ivory, sx, 0.04, 0.2 + k * 0.15));
  }
  head.add(jaw);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffa000, emissiveIntensity: 0.6 });
  for (const sx of [-1, 1]) {
    head.add(mesh(new THREE.SphereGeometry(0.1, 10, 8), eyeMat, sx * 0.26, 0.2, 0.36));
    head.add(mesh(new THREE.SphereGeometry(0.045, 6, 5), std(0x050505), sx * 0.32, 0.21, 0.42));
    const brow = mesh(new THREE.ConeGeometry(0.06, 0.32, 4), red, sx * 0.3, 0.33, 0.3);
    brow.rotation.set(-1.2, 0, sx * 0.5);
    head.add(brow);
    // antler horns
    const horn = new THREE.Group();
    horn.position.set(sx * 0.2, 0.36, -0.1);
    horn.rotation.set(-1.05, 0, -sx * 0.35);
    horn.add(mesh(new THREE.CylinderGeometry(0.025, 0.065, 0.95, 6), gold, 0, 0.47, 0));
    const tine = mesh(new THREE.CylinderGeometry(0.015, 0.04, 0.4, 5), gold, sx * 0.08, 0.55, 0.06);
    tine.rotation.set(0.6, 0, -sx * 0.5);
    horn.add(tine);
    head.add(horn);
  }
  for (let k = 0; k < 7; k++) {
    const a = (k / 6 - 0.5) * 2.4;
    const tuft = mesh(new THREE.ConeGeometry(0.08, 0.6, 4), red, Math.sin(a) * 0.38, 0.1 + Math.cos(a) * 0.25, -0.3);
    tuft.rotation.set(-1.9 + Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.8);
    head.add(tuft);
  }
  const beard = mesh(new THREE.ConeGeometry(0.1, 0.5, 5), red, 0, -0.32, 0.35);
  beard.rotation.x = 2.5;
  head.add(beard);
  const whiskers = [-1, 1].map((sx) => {
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf2d27a }));
    line.userData.sx = sx;
    head.add(line);
    return line;
  });
  return { head, jaw, eyeMat, whiskers };
}

export function createDragon(ctx) {
  const group = new THREE.Group();
  group.userData.noSnow = true;
  ctx.scene.add(group);
  const P = Array.from({ length: N }, () => new THREE.Vector3());
  const T = P.map(() => new THREE.Vector3()), S = P.map(() => new THREE.Vector3()), U = P.map(() => new THREE.Vector3());
  const R = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    R[i] = s < 0.08 ? 0.34 + (s / 0.08) * 0.16 : 0.5 * Math.pow((1 - s) / 0.92, 0.85) + 0.03;
  }

  // ——— body tube ———
  const V = N * (RS + 1);
  const pos = new Float32Array(V * 3), col = new Float32Array(V * 3), uv = new Float32Array(V * 2), idx = [];
  const belly = new THREE.Color(0xe9c46a), back = new THREE.Color(0x2e8b6e), tipC = new THREE.Color(0xd8442a), c = new THREE.Color();
  for (let i = 0; i < N; i++) for (let j = 0; j <= RS; j++) {
    const k = i * (RS + 1) + j, th = (j / RS) * Math.PI * 2;
    c.copy(back).lerp(belly, THREE.MathUtils.smoothstep(-Math.sin(th), 0.15, 0.65));
    if (i > N - 8) c.lerp(tipC, (i - (N - 8)) / 8);
    col.set([c.r, c.g, c.b], k * 3);
    uv.set([(j / RS) * 6, i * 0.45], k * 2);
    if (i < N - 1 && j < RS) { const b = k + RS + 1; idx.push(k, b, k + 1, k + 1, b, b + 1); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const scales = scaleTexture();
  const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    vertexColors: true, map: scales, bumpMap: scales, bumpScale: 1.5, roughness: 0.4, metalness: 0.25,
  }));
  body.castShadow = true;
  group.add(body);

  // ——— dorsal spines + mane ———
  const spineIdx = [];
  for (let i = 2; i < N - 5; i += 2) spineIdx.push(i);
  const spines = new THREE.InstancedMesh(new THREE.ConeGeometry(0.12, 0.5, 4), std(0xffffff, { flatShading: true }), spineIdx.length);
  spineIdx.forEach((i, k) => spines.setColorAt(k, c.set(i < 10 ? 0xe0532e : 0xc23b22)));
  spines.castShadow = true;
  spines.frustumCulled = false;
  group.add(spines);

  // ——— legs ———
  const claw = std(0xe2b84f, { metalness: 0.6, roughness: 0.3 });
  const legMat = std(0x2e8b6e, { roughness: 0.5 });
  const legs = [[14, 1, 0, 1], [14, -1, Math.PI, 1], [50, 1, Math.PI, 0.75], [50, -1, 0, 0.75]].map(([i, sign, ph, sc]) => {
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    const hip = new THREE.Group();
    hip.scale.setScalar(sc);
    root.add(hip);
    hip.add(mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.6, 6), legMat, 0, -0.3, 0));
    const knee = new THREE.Group();
    knee.position.y = -0.6;
    knee.rotation.x = -0.9;
    hip.add(knee);
    knee.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.5, 6), legMat, 0, -0.25, 0));
    for (let k = -1; k <= 1; k++) {
      const cl = mesh(new THREE.ConeGeometry(0.035, 0.22, 4), claw, k * 0.06, -0.55, 0.06);
      cl.rotation.x = 1.9;
      knee.add(cl);
    }
    group.add(root);
    return { root, hip, i, sign, ph };
  });

  // ——— head ———
  const headRoot = new THREE.Group();
  headRoot.matrixAutoUpdate = false;
  group.add(headRoot);
  const { head, jaw, eyeMat, whiskers } = buildHead();
  headRoot.add(head);
  const fireLight = new THREE.PointLight(0xff7a2a, 0, 14, 1.5);
  fireLight.position.set(0, 0, 1.6);
  head.add(fireLight);

  // ——— pearl ———
  const pearl = mesh(new THREE.SphereGeometry(0.32, 20, 16), new THREE.MeshStandardMaterial({
    color: 0xfff6dc, emissive: 0xffe6a0, emissiveIntensity: 1.2, roughness: 0.15, metalness: 0.1,
  }));
  const pearlLight = new THREE.PointLight(0xffe0a0, 2, 12, 1.5);
  pearl.add(pearlLight);
  pearl.userData.noSnow = true;
  ctx.scene.add(pearl);

  // ——— fire particles ———
  const fcv = document.createElement('canvas');
  fcv.width = fcv.height = 64;
  const fg = fcv.getContext('2d');
  const grd = fg.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  fg.fillStyle = grd; fg.fillRect(0, 0, 64, 64);
  const ftex = new THREE.CanvasTexture(fcv);
  const fires = Array.from({ length: 90 }, () => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ftex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.visible = false;
    ctx.scene.add(sp);
    return { sp, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1 };
  });
  let fireNext = 0;

  const st = { u: 0, boost: 0, fireT: 0, jawT: 0 };
  const tmp = new THREE.Vector3(), prev = new THREE.Vector3(), lastHead = new THREE.Vector3(), vel = new THREE.Vector3();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), dir = new THREE.Vector3();
  const mouth = new THREE.Vector3();
  const api = { group, headPos: new THREE.Vector3(), forward: new THREE.Vector3(0, 0, 1) };
  ctx.dragon = api;
  let first = true;

  ctx.updaters.push((dt, t) => {
    st.boost = Math.max(0, st.boost - dt * 0.9);
    st.u += dt * 0.085 * (1 + st.boost);

    // sample spine at constant arc length behind the head
    let uu = st.u;
    flightPath(uu, P[0]);
    prev.copy(P[0]);
    for (let i = 1; i < N; i++) {
      let acc = 0;
      while (acc < SPACING) { uu -= 0.0012; flightPath(uu, tmp); acc += tmp.distanceTo(prev); prev.copy(tmp); }
      P[i].copy(prev);
    }
    for (let i = 0; i < N; i++) {
      // right-handed frame: S × U = T, so makeBasis(S, U, T) is a pure rotation
      T[i].subVectors(P[Math.max(0, i - 1)], P[Math.min(N - 1, i + 1)]).normalize();
      S[i].crossVectors(UPV, T[i]);
      if (S[i].lengthSq() < 1e-5) S[i].copy(i ? S[i - 1] : tmp.set(1, 0, 0));
      S[i].normalize();
      U[i].crossVectors(T[i], S[i]).normalize();
    }
    // bank into turns
    for (let i = 0; i < N; i++) {
      const j = Math.min(N - 1, i + 4);
      const bank = -clamp(tmp.crossVectors(T[j], T[i]).y * 5, -0.7, 0.7);
      const cb = Math.cos(bank), sb = Math.sin(bank);
      tmp.copy(S[i]).multiplyScalar(cb).addScaledVector(U[i], sb);
      U[i].multiplyScalar(cb).addScaledVector(S[i], -sb);
      S[i].copy(tmp);
    }
    // serpentine undulation (none at the head so it stays on course)
    for (let i = 1; i < N; i++) {
      const k = Math.min(1, (i / N) * 4);
      P[i].addScaledVector(S[i], Math.sin(i * 0.16 - t * 3.2) * 0.55 * k)
        .addScaledVector(U[i], Math.cos(i * 0.11 - t * 2.4) * 0.45 * k);
    }

    const breathe = 1 + Math.sin(t * 2) * 0.03;
    for (let i = 0; i < N; i++) {
      const r = R[i] * breathe;
      for (let j = 0; j <= RS; j++) {
        const th = (j / RS) * Math.PI * 2, cs = Math.cos(th) * r, sn = Math.sin(th) * r * 0.9;
        const k = (i * (RS + 1) + j) * 3;
        pos[k] = P[i].x + S[i].x * cs + U[i].x * sn;
        pos[k + 1] = P[i].y + S[i].y * cs + U[i].y * sn;
        pos[k + 2] = P[i].z + S[i].z * cs + U[i].z * sn;
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    for (let i = 0; i < N; i++) { // weld the UV seam normals
      const a = i * (RS + 1), b = a + RS;
      tmp.fromBufferAttribute(nrm, a).add(prev.fromBufferAttribute(nrm, b)).normalize();
      nrm.setXYZ(a, tmp.x, tmp.y, tmp.z); nrm.setXYZ(b, tmp.x, tmp.y, tmp.z);
    }
    geo.computeBoundingSphere();

    spineIdx.forEach((i, k) => {
      dir.copy(U[i]).addScaledVector(T[i], -0.7).normalize();
      q.setFromUnitVectors(UPV, dir);
      const s = (i < 10 ? 1.7 : 1.1) * R[i] / 0.5 + 0.15;
      m4.compose(tmp.copy(P[i]).addScaledVector(U[i], R[i] * 0.85), q, sc.setScalar(s));
      spines.setMatrixAt(k, m4);
    });
    spines.instanceMatrix.needsUpdate = true;

    for (const L of legs) {
      const i = L.i;
      L.root.matrix.makeBasis(S[i], U[i], T[i]).setPosition(
        tmp.copy(P[i]).addScaledVector(S[i], L.sign * R[i] * 0.6).addScaledVector(U[i], -R[i] * 0.3));
      L.hip.rotation.set(Math.sin(t * 3 * (1 + st.boost * 0.5) + L.ph) * 0.55 - 0.2, 0, L.sign * 0.75);
    }

    headRoot.matrix.makeBasis(S[0], U[0], T[0]).setPosition(tmp.copy(P[0]).addScaledVector(T[0], 0.2));
    head.rotation.set(Math.sin(t * 1.5) * 0.08, Math.sin(t * 0.9) * 0.12, 0);
    st.jawT = Math.max(0, st.jawT - dt);
    jaw.rotation.x = st.jawT > 0 ? Math.min(1, st.jawT * 3) * 0.55 : 0.05 + Math.sin(t * 2) * 0.03;
    for (const w of whiskers) {
      const a = w.geometry.attributes.position;
      for (let k = 0; k < 16; k++) {
        const f = k / 15;
        a.setXYZ(k, w.userData.sx * (0.22 + f * 1.1), -0.02 + Math.sin(t * 3 + f * 5) * 0.12 * f - f * 0.3,
          1.0 - f * 1.4 + Math.cos(t * 2.5 + f * 4) * 0.1 * f);
      }
      a.needsUpdate = true;
    }

    api.headPos.copy(P[0]);
    api.forward.copy(T[0]);
    vel.subVectors(P[0], first ? P[0] : lastHead).divideScalar(Math.max(dt, 1e-3));
    lastHead.copy(P[0]);
    first = false;

    flightPath(st.u + 0.05, pearl.position);
    pearl.position.x += Math.sin(t * 2.1) * 0.5;
    pearl.position.y += Math.cos(t * 2.7) * 0.4 + 0.3;
    pearl.rotation.y += dt;
    pearlLight.intensity = 2 + ctx.night * 14;
    eyeMat.emissiveIntensity = 0.6 + ctx.night * 2.5;

    // fire breath
    group.updateMatrixWorld(true);
    head.localToWorld(mouth.set(0, -0.08, 1.2));
    if (st.fireT > 0) {
      st.fireT -= dt;
      for (let n = 0; n < 3; n++) {
        const f = fires[fireNext]; fireNext = (fireNext + 1) % fires.length;
        f.life = f.max = rand(0.6, 1.0);
        f.p.copy(mouth);
        f.v.copy(api.forward).multiplyScalar(rand(7, 11)).add(vel)
          .add(tmp.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(1.4));
        f.sp.visible = true;
      }
    }
    fireLight.intensity = st.fireT > 0 ? 25 + Math.random() * 15 : Math.max(0, fireLight.intensity - dt * 80);
    for (const f of fires) {
      if (f.life <= 0) continue;
      f.life -= dt;
      f.p.addScaledVector(f.v, dt);
      f.v.multiplyScalar(Math.pow(0.15, dt));
      f.v.y += dt * 2;
      const a = 1 - f.life / f.max;
      f.sp.position.copy(f.p);
      f.sp.scale.setScalar(0.35 + a * 1.8);
      f.sp.material.color.setHSL(0.13 - a * 0.13, 1, 0.65 - a * 0.25);
      f.sp.material.opacity = Math.max(0, 1 - a) * 0.9;
      if (f.life <= 0) f.sp.visible = false;
    }
  });

  interactive(ctx, group, {
    name: '青龙', hint: '点击：龙吟喷火',
    onClick: () => {
      st.boost = 3; st.fireT = 1.3; st.jawT = 1.8;
      ctx.sfx.roar();
      ctx.shake = 0.6;
      ctx.toast('龙吟九霄！');
    },
  });
  interactive(ctx, pearl, {
    name: '龙珠', hint: '点击让青龙追珠',
    onClick: () => {
      st.boost = 2;
      pearl.material.emissiveIntensity = 4;
      ctx.updaters.push((dt) => { pearl.material.emissiveIntensity = Math.max(1.2, pearl.material.emissiveIntensity - dt * 3); if (pearl.material.emissiveIntensity <= 1.2) return false; });
      ctx.sfx.chime();
      ctx.toast('青龙戏珠');
    },
  });
}
