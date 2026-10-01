import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sfx } from './audio.js';
import { createScenery } from './scenery.js';
import { createSand } from './sand.js';
import { createGarden } from './garden.js';
import { createPlants } from './plants.js';
import { createProps } from './props.js';
import { createPagoda } from './pagoda.js';
import { createPeople } from './people.js';
import { createDragon } from './dragon.js';
import { SEASONS, makeEnv, createSeasons } from './seasons.js';
import { createWeather } from './weather.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 1500);
const HOME_CAM = new THREE.Vector3(-8, 15, 34), HOME_TARGET = new THREE.Vector3(1, 2, -3);
camera.position.copy(HOME_CAM);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME_TARGET);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 4;
controls.maxDistance = 90;
controls.autoRotateSpeed = 0.5;

const $ = (id) => document.getElementById(id);
const toastEl = $('toast');
let toastTimer;
const startSeason = SEASONS[location.hash.slice(1)] || SEASONS.spring;
const ctx = {
  scene, camera, renderer, controls,
  sfx: new Sfx(),
  updaters: [], interactives: [], lanterns: [],
  night: 0, nightTarget: 0, windGust: 0, shake: 0,
  season: startSeason, env: makeEnv(startSeason),
  uTime: { value: 0 }, uWind: { value: 1 },
  toast(msg) {
    toastEl.textContent = msg;
    toastEl.style.opacity = 1;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.style.opacity = 0), 1800);
  },
};

createScenery(ctx);
createSand(ctx);
createGarden(ctx);
createPlants(ctx);
createProps(ctx);
createPagoda(ctx);
createDragon(ctx);
createPeople(ctx);
createWeather(ctx);
const setSeason = createSeasons(ctx); // last: patches every material already in the scene
ctx.uSnow.value = ctx.env.snow;
window.__garden = ctx; // handy for poking at the scene from devtools

// ——— picking ———
const raycaster = new THREE.Raycaster();
raycaster.params.Line.threshold = 0.05;
const ndc = new THREE.Vector2();
const tooltip = $('tooltip');
const el = renderer.domElement;
let pointerIn = false, mouse = { x: 0, y: 0 }, down = null, stroke = null, raking = false, follow = false, returning = 0;

const setNdc = (e) => ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);

function pick() {
  raycaster.setFromCamera(ndc, camera);
  const sandPt = ctx.sand.pick(raycaster);
  const sandD = sandPt ? sandPt.distanceTo(camera.position) : Infinity;
  for (const h of raycaster.intersectObjects(ctx.interactives, true)) {
    if (h.distance > sandD + 0.05) break;
    let o = h.object;
    while (o && !o.userData.interactive) o = o.parent;
    if (o) return { info: o.userData.interactive, hit: h };
  }
  return sandPt ? { sand: sandPt } : null;
}

// Capture phase so we can disable OrbitControls before it sees a rake stroke begin.
el.addEventListener('pointerdown', (e) => {
  ctx.sfx.init();
  setNdc(e);
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
  if (raking && e.button === 0) {
    raycaster.setFromCamera(ndc, camera);
    const p = ctx.sand.pick(raycaster);
    if (p) {
      stroke = new ctx.sand.Stroke();
      if (!ctx.sand.onIsland(p)) stroke.add(p.x, p.z);
      controls.enabled = false;
      try { el.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
    }
  }
}, { capture: true });

el.addEventListener('pointermove', (e) => {
  setNdc(e);
  pointerIn = true;
  mouse = { x: e.clientX, y: e.clientY };
  if (!stroke) return;
  raycaster.setFromCamera(ndc, camera);
  const p = ctx.sand.pick(raycaster);
  if (!p || ctx.sand.onIsland(p)) { stroke.pts.length = 0; return; }
  if (stroke.add(p.x, p.z) && Math.random() < 0.2) ctx.sfx.rake();
});
el.addEventListener('pointerleave', () => { pointerIn = false; tooltip.style.opacity = 0; });

window.addEventListener('pointerup', (e) => {
  if (stroke) { stroke = null; controls.enabled = true; down = null; return; }
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const quick = performance.now() - down.t < 450;
  down = null;
  if (moved > 6 || !quick || e.target !== el) return;
  setNdc(e);
  const r = pick();
  if (!r) return;
  if (r.info) r.info.onClick(r.hit.point, r.hit.object);
  else if (!ctx.sand.onIsland(r.sand)) { ctx.sand.ripple(r.sand.x, r.sand.z); ctx.sfx.pebble(); }
});

function updateHover() {
  if (!pointerIn || stroke) { tooltip.style.opacity = 0; return; }
  const r = pick();
  let html = '';
  if (r?.info) html = `${r.info.name}<small>${r.info.hint}</small>`;
  else if (r?.sand) html = `白砂<small>${raking ? '按住拖动耙出砂纹' : '点击投下石子'}</small>`;
  el.style.cursor = r?.info ? 'pointer' : '';
  tooltip.innerHTML = html;
  tooltip.style.opacity = html ? 1 : 0;
  tooltip.style.left = mouse.x + 'px';
  tooltip.style.top = mouse.y + 'px';
}

// ——— UI ———
const press = (id, v) => $(id).setAttribute('aria-pressed', String(v));
function toggleNight() {
  ctx.sfx.init();
  ctx.nightTarget = ctx.nightTarget ? 0 : 1;
  ctx.lanterns.forEach((l) => (l.manual = null));
  press('btn-night', !!ctx.nightTarget);
  ctx.sfx.chime();
  ctx.toast(ctx.nightTarget ? '夜 · 月下禅庭' : '昼 · 晴空白砂');
}
function toggleRake() {
  raking = !raking;
  press('btn-rake', raking);
  document.body.classList.toggle('raking', raking);
  ctx.toast(raking ? '耙砂模式：在白砂上拖动' : '视角模式');
}
function toggleFollow() {
  follow = !follow;
  press('btn-follow', follow);
  controls.enabled = !follow;
  if (!follow) returning = 2;
}
$('btn-night').addEventListener('click', toggleNight);
$('btn-rake').addEventListener('click', toggleRake);
$('btn-follow').addEventListener('click', toggleFollow);
$('btn-rotate').addEventListener('click', () => { controls.autoRotate = !controls.autoRotate; press('btn-rotate', controls.autoRotate); });
$('btn-reset').addEventListener('click', () => { ctx.sfx.init(); ctx.sand.reset(); ctx.sfx.rake(); ctx.toast('砂纹已重新耙平'); });
$('btn-sound').addEventListener('click', () => {
  ctx.sfx.init();
  ctx.sfx.enabled = !ctx.sfx.enabled;
  press('btn-sound', ctx.sfx.enabled);
});
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === 'n') toggleNight();
  else if (k === 'r') toggleRake();
  else if (k === 'f') toggleFollow();
  else { const s = Object.values(SEASONS).find((s) => s.key === k); if (s) chooseSeason(s.id); }
});

// ——— season picker ———
const seasonBar = $('seasons');
function chooseSeason(id) {
  if (id !== ctx.season.id) ctx.sfx.init();
  setSeason(id);
  for (const b of seasonBar.querySelectorAll('button')) {
    const on = b.dataset.season === ctx.season.id;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  $('panel-sub').textContent = ctx.season.sub;
}
for (const s of Object.values(SEASONS)) {
  const b = document.createElement('button');
  b.dataset.season = s.id;
  b.setAttribute('role', 'radio');
  b.title = `${s.label}（快捷键 ${s.key}）`;
  b.textContent = s.label.split(' · ')[0];
  b.addEventListener('click', () => chooseSeason(s.id));
  seasonBar.append(b);
}
seasonBar.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const ids = Object.keys(SEASONS), i = ids.indexOf(ctx.season.id);
  chooseSeason(ids[(i + (e.key === 'ArrowRight' ? 1 : ids.length - 1)) % ids.length]);
  seasonBar.querySelector('[aria-checked="true"]').focus();
});
window.addEventListener('hashchange', () => SEASONS[location.hash.slice(1)] && chooseSeason(location.hash.slice(1)));
chooseSeason(startSeason.id); // already active, so this only syncs the buttons
window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ——— loop ———
const clock = new THREE.Clock();
const goal = new THREE.Vector3(), look = new THREE.Vector3(), shakeOff = new THREE.Vector3();
let frame = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  ctx.uTime.value = t;
  ctx.night += (ctx.nightTarget - ctx.night) * Math.min(1, dt * 1.5);
  ctx.windGust = Math.max(0, ctx.windGust - dt);
  ctx.uWind.value = 0.8 + Math.sin(t * 0.3) * 0.3 + Math.sin(t * 1.1) * 0.15 + ctx.windGust * 1.2;

  for (let i = ctx.updaters.length - 1; i >= 0; i--) {
    if (ctx.updaters[i](dt, t) === false) ctx.updaters.splice(i, 1);
  }

  if (follow) {
    const d = ctx.dragon;
    goal.copy(d.headPos).addScaledVector(d.forward, -10).add(look.set(0, 4, 0));
    goal.y = Math.max(goal.y, 2);
    camera.position.lerp(goal, 1 - Math.exp(-dt * 2.5));
    look.copy(d.headPos).addScaledVector(d.forward, 4);
    controls.target.lerp(look, 1 - Math.exp(-dt * 4));
    camera.lookAt(controls.target);
  } else {
    if (returning > 0) {
      returning -= dt;
      const k = 1 - Math.exp(-dt * 2.5);
      controls.target.lerp(HOME_TARGET, k);
      camera.position.lerp(HOME_CAM, k);
    }
    controls.update();
  }

  ctx.shake = Math.max(0, ctx.shake - dt);
  shakeOff.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(ctx.shake * 0.5);
  camera.position.add(shakeOff);
  if (frame++ % 2 === 0) updateHover();
  renderer.render(scene, camera);
  camera.position.sub(shakeOff);
  if (frame === 3) { $('loading').style.opacity = 0; setTimeout(() => $('loading').remove(), 900); }
});
