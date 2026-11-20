/* WebGL scenes for the story: a dotted globe with flight arcs, and a 3D demand skyline.
   Uses three.js (MIT), vendored in /vendor. Every number comes from story-data.js. */
import * as THREE from './vendor/three.module.min.js';

const S = window.STORY;
const LANE = { buy: 0xF07A35, block: 0x4A93F0, pass: 0x6B7686 };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

function makeRenderer(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  r.setClearColor(0x000000, 0);
  return r;
}
function fit(renderer, camera, canvas) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return false;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  return true;
}
const ll = (lat, lon, R) => {
  const phi = (90 - lat) * Math.PI / 180, th = (lon + 180) * Math.PI / 180;
  return new THREE.Vector3(-R * Math.sin(phi) * Math.cos(th), R * Math.cos(phi), R * Math.sin(phi) * Math.sin(th));
};

/* ---------------- globe ---------------- */
export function globe(canvas, labelLayer) {
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0.2, 7.6);
  const R = 1.5, world = new THREE.Group();
  scene.add(world);

  // dark core so back-facing dots are hidden
  world.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.985, 64, 64), new THREE.MeshBasicMaterial({ color: 0x0A1020 })));

  // land dots
  const D = window.LAND_DOTS, pos = new Float32Array(D.length / 2 * 3), seed = new Float32Array(D.length / 2);
  for (let i = 0; i < D.length; i += 2) { const v = ll(D[i], D[i + 1], R); pos.set([v.x, v.y, v.z], i / 2 * 3); seed[i / 2] = Math.random(); }
  const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); dg.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const dotMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uReveal: { value: 0 }, uPx: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute float seed; uniform float uTime, uReveal, uPx; varying float vA; varying float vS;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mv;
        float tw = 0.55 + 0.45 * sin(uTime*1.6 + seed*40.0);
        vA = smoothstep(seed, seed+0.15, uReveal) * tw; vS = seed;
        gl_PointSize = (2.9 + seed*1.4) * uPx * (6.5 / -mv.z); }`,
    fragmentShader: `varying float vA; varying float vS; void main(){ vec2 c = gl_PointCoord-0.5; float d = length(c); if(d>0.5) discard;
        vec3 col = mix(vec3(0.52,0.62,0.80), vec3(0.86,0.91,1.0), vS*0.6); gl_FragColor = vec4(col, vA * smoothstep(0.5,0.2,d)); }`
  });
  world.add(new THREE.Points(dg, dotMat));

  // atmosphere (fresnel glow)
  const atm = new THREE.Mesh(new THREE.SphereGeometry(R * 1.18, 64, 64), new THREE.ShaderMaterial({
    side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vN; void main(){ float i = pow(0.72 - dot(vN, vec3(0,0,1.0)), 3.0); gl_FragColor = vec4(0.22,0.48,0.95,1.0) * i * 1.4; }`
  }));
  scene.add(atm);

  // places
  const P = { DEL: [28.6, 77.2, 'Delhi'], BOM: [19.1, 72.9, 'Mumbai'], BLR: [13.0, 77.6, 'Bengaluru'], DXB: [25.2, 55.3, 'Dubai'], MKH: [21.4, 39.8, 'Makkah'], BKK: [13.75, 100.5, 'Bangkok'], HKT: [7.9, 98.4, 'Phuket'], DPS: [-8.4, 115.2, 'Bali'], SIN: [1.35, 103.8, 'Singapore'], MLE: [4.2, 73.5, 'Maldives'], LHR: [51.5, -0.1, 'London'], CDG: [48.9, 2.35, 'Paris'], IST: [41.0, 28.98, 'Istanbul'] };
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const sprite = (color, size) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.setScalar(size); return s; };

  // arcs + pulses
  const arcs = [], labels = [];
  const destLane = {};
  S.arcs.forEach((a, i) => {
    const A = ll(P[a.from][0], P[a.from][1], R), Bv = ll(P[a.to][0], P[a.to][1], R);
    const dist = A.distanceTo(Bv), mid = A.clone().add(Bv).normalize().multiplyScalar(R + 0.18 + dist * 0.32);
    const curve = new THREE.QuadraticBezierCurve3(A, mid, Bv);
    const tube = new THREE.TubeGeometry(curve, 80, 0.0075, 6, false);
    const mat = new THREE.MeshBasicMaterial({ color: LANE[a.lane], transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const mesh = new THREE.Mesh(tube, mat); mesh.geometry.setDrawRange(0, 0); world.add(mesh);
    const pulses = [0, 1, 2].map(k => { const s = sprite(LANE[a.lane], 0.11); world.add(s); return { s, off: k / 3 }; });
    arcs.push({ mesh, curve, pulses, count: tube.index.count, delay: 0.25 + i * 0.12, speed: 0.16 + (i % 4) * 0.025 });
    destLane[a.to] = destLane[a.to] || a.lane;
  });
  // markers + labels
  Object.entries(P).forEach(([id, [lat, lon, name]]) => {
    const v = ll(lat, lon, R * 1.005), origin = ['DEL', 'BOM', 'BLR'].includes(id);
    const col = origin ? 0xFFFFFF : LANE[destLane[id] || 'block'];
    const s = sprite(col, origin ? 0.16 : 0.12); s.position.copy(v); world.add(s);
    if (origin) { const ring = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.04, 32), new THREE.MeshBasicMaterial({ color: 0xFFFFFF, transparent: true, side: THREE.DoubleSide, depthWrite: false })); ring.position.copy(v); ring.lookAt(v.clone().multiplyScalar(2)); world.add(ring); labels.push({ ring }); }
    const el = document.createElement('span'); el.className = 'geo-tag' + (origin ? ' origin' : ''); el.textContent = name; labelLayer.appendChild(el);
    labels.push({ el, v, origin, id });
  });

  // face the Middle East / India / SE Asia corridor
  const BASE_Y = 3.62, BASE_X = 0.36; world.rotation.y = BASE_Y; world.rotation.x = BASE_X;
  let t0 = performance.now(), scrollP = 0, mx = 0, my = 0, visible = true, raf;
  addEventListener('pointermove', e => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5; }, { passive: true });
  const tmp = new THREE.Vector3(), camDir = new THREE.Vector3();

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!visible || !fit(renderer, camera, canvas)) return;
    const t = (now - t0) / 1000;
    dotMat.uniforms.uTime.value = t; dotMat.uniforms.uReveal.value = reduced ? 2 : Math.min(1.2, t / 2.2);
    world.rotation.y = BASE_Y + (reduced ? 0 : Math.sin(t * 0.12) * 0.35) + mx * 0.25;
    world.rotation.x = BASE_X + my * 0.12;
    camera.position.z = 7.6 + scrollP * 3.2; camera.position.y = 0.2 - scrollP * 0.8; camera.lookAt(0, 0, 0);
    arcs.forEach(a => {
      const p = reduced ? 1 : Math.min(1, Math.max(0, (t - a.delay) / 1.1));
      a.mesh.geometry.setDrawRange(0, Math.floor(a.count * p) - (Math.floor(a.count * p) % 3));
      a.pulses.forEach(pl => { const u = ((t * a.speed) + pl.off) % 1; pl.s.position.copy(a.curve.getPoint(u)); pl.s.material.opacity = p >= 1 ? Math.sin(u * Math.PI) : 0; });
    });
    camera.getWorldDirection(camDir);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    labels.forEach(L => {
      if (L.ring) { const k = (t * 0.8) % 1; L.ring.scale.setScalar(1 + k * 3); L.ring.material.opacity = 1 - k; return; }
      tmp.copy(L.v).applyMatrix4(world.matrixWorld);
      const facing = tmp.clone().normalize().dot(camera.position.clone().normalize()) > 0.25;
      tmp.project(camera);
      L.el.style.transform = `translate(${(tmp.x * .5 + .5) * w}px, ${(-tmp.y * .5 + .5) * h}px)`;
      L.el.style.opacity = facing && t > 1.5 ? 1 : 0;
    });
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);
  new IntersectionObserver(es => es.forEach(e => { visible = e.isIntersecting; })).observe(canvas);
  return { setScroll: p => { scrollP = p; } };
}

/* ---------------- skyline ---------------- */
export function skyline(canvas, tipEl, labelLayer) {
  const renderer = makeRenderer(canvas);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0E1420, 26, 48);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-8, 14, 10); scene.add(key);
  const rim = new THREE.DirectionalLight(0x4A93F0, 0.9); rim.position.set(10, 6, -10); scene.add(rim);

  const rows = S.rows, nR = rows.length, nC = 12, gap = 1.18;
  const max = Math.max(...rows.flatMap(r => r.cash)) || 1;
  const geo = new THREE.BoxGeometry(0.86, 1, 0.86); geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 });
  const mesh = new THREE.InstancedMesh(geo, mat, nR * nC);
  const base = [], target = [], cur = [], meta = [];
  const colBuy = new THREE.Color(LANE.buy), colBlock = new THREE.Color(LANE.block), colPass = new THREE.Color(0x2A313D);
  const dummy = new THREE.Object3D(), ox = -(nC - 1) * gap / 2, oz = -(nR - 1) * gap / 2;
  rows.forEach((row, r) => row.lanes.forEach((lane, c) => {
    const i = r * nC + c, h = lane === 'pass' ? 0.08 : 0.25 + row.cash[c] / max * 6.2;
    target[i] = h; cur[i] = 0.001; base[i] = lane === 'buy' ? colBuy : lane === 'block' ? colBlock : colPass;
    meta[i] = { row: row.name, week: S.weeks[c], lane, cash: row.cash[c], x: ox + c * gap, z: oz + r * gap };
    mesh.setColorAt(i, base[i]);
  }));
  scene.add(mesh);
  const grid = new THREE.GridHelper(40, 40, 0x24304A, 0x172033); grid.position.y = -0.01; scene.add(grid);

  // row labels for highlighted rows
  const tags = {};
  rows.forEach((row, r) => { const el = document.createElement('span'); el.className = 'sky-tag'; el.textContent = row.name; labelLayer.appendChild(el); tags[row.name] = { el, pos: new THREE.Vector3(ox - 1.1, 0.2, oz + r * gap) }; });

  let start = null, hi = null, visible = false, mouse = null, raf;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), col = new THREE.Color(), tmp = new THREE.Vector3();
  canvas.addEventListener('pointermove', e => { const b = canvas.getBoundingClientRect(); mouse = { x: e.clientX - b.left, y: e.clientY - b.top, w: b.width, h: b.height }; });
  canvas.addEventListener('pointerleave', () => { mouse = null; tipEl.style.opacity = 0; });

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!visible || !fit(renderer, camera, canvas)) return;
    if (start === null) start = now;
    const t = (now - start) / 1000;
    const az = 0.62 + (reduced ? 0 : Math.sin(t * 0.18) * 0.22), radius = 27;
    camera.position.set(Math.sin(az) * radius, 15.5, Math.cos(az) * radius); camera.lookAt(0, 1.2, 0);
    for (let i = 0; i < target.length; i++) {
      const r = Math.floor(i / nC), c = i % nC, d = 0.15 + c * 0.07 + r * 0.035;
      const p = reduced ? 1 : Math.min(1, Math.max(0, (t - d) / 0.9)), e = 1 - Math.pow(1 - p, 4) * Math.cos(p * 5) * (1 - p);
      cur[i] = Math.max(0.001, target[i] * e);
      dummy.position.set(meta[i].x, 0, meta[i].z); dummy.scale.set(1, cur[i], 1); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      const on = !hi || hi.includes(meta[i].row);
      col.copy(base[i]).multiplyScalar(on ? (hi ? 1.25 : 1) : 0.28); mesh.setColorAt(i, col);
    }
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    Object.entries(tags).forEach(([name, T]) => { tmp.copy(T.pos).project(camera); T.el.style.transform = `translate(${(tmp.x * .5 + .5) * w}px, ${(-tmp.y * .5 + .5) * h}px) translate(-100%,-50%)`; T.el.style.opacity = hi && hi.includes(name) ? 1 : 0; });
    if (mouse) {
      ndc.set(mouse.x / mouse.w * 2 - 1, -(mouse.y / mouse.h) * 2 + 1); ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(mesh)[0];
      if (hit) { const m = meta[hit.instanceId]; tipEl.innerHTML = `<b>${m.row}</b> · week of ${m.week}<br>${m.lane[0].toUpperCase() + m.lane.slice(1)}${m.lane !== 'pass' ? ` · ₹${m.cash} L committed` : ' · free sale only'}`; tipEl.style.transform = `translate(${mouse.x + 14}px, ${mouse.y + 14}px)`; tipEl.style.opacity = 1; }
      else tipEl.style.opacity = 0;
    }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);
  return {
    play() { visible = true; start = null; },
    stop() { visible = false; },
    highlight(names) { hi = names; }
  };
}
