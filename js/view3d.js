'use strict';
/* =====================================================================
   Rack Visualizer · 3D view (three.js)
   Metres; x to the right, y up, z towards the viewer. Rack fronts line up at z = 0.
   ===================================================================== */

const threeEl = $('#three');
const T = { ready: false, framed: false, pickables: [] };

function init3D() {
  if (T.ready) return true;
  if (!window.THREE || !THREE.OrbitControls) {
    threeEl.innerHTML = '<p class="msg">The 3D view needs an internet connection to load three.js.</p>';
    return false;
  }
  const r = T.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  threeEl.appendChild(r.domElement);
  T.scene = new THREE.Scene();
  T.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
  T.controls = new THREE.OrbitControls(T.camera, r.domElement);
  T.controls.enableDamping = true;
  T.scene.add(new THREE.HemisphereLight(0xffffff, 0x808080, 0.85));
  const dl = new THREE.DirectionalLight(0xffffff, 0.5); dl.position.set(2, 4, 3); T.scene.add(dl);
  T.group = new THREE.Group(); T.scene.add(T.group);
  new ResizeObserver(resize3D).observe(threeEl);
  let down = null;
  r.domElement.addEventListener('pointerdown', e => (down = { x: e.clientX, y: e.clientY }));
  r.domElement.addEventListener('pointerup', e => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4 && e.button === 0) pick3D(e);
    down = null;
  });
  const loop = () => {
    requestAnimationFrame(loop);
    if (ui.view !== '3d') return;
    T.controls.update();
    r.render(T.scene, T.camera);
  };
  loop();
  T.ready = true;
  return true;
}
function resize3D() {
  if (!T.ready) return;
  const w = threeEl.clientWidth, h = threeEl.clientHeight;
  if (!w || !h) return;
  T.renderer.setSize(w, h);
  T.camera.aspect = w / h;
  T.camera.updateProjectionMatrix();
}
function frame3D() {
  const L = layout(), S = 0.001, tx = L.w * S / 2, ty = L.h * S / 2;
  const span = Math.max(L.w * S, L.h * S, 1);
  T.controls.target.set(tx, ty * 0.9, -0.4);
  T.camera.position.set(tx + span * 0.6, ty + span * 0.45, span * 1.55);
  T.controls.update();
}
function pick3D(e) {
  const rect = T.renderer.domElement.getBoundingClientRect();
  const v = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  const rc = new THREE.Raycaster(); rc.setFromCamera(v, T.camera);
  const hit = rc.intersectObjects(T.pickables, false)[0];
  if (!hit) { if (ui.mode !== 'connect') select(null); return; }
  const { kind, id } = hit.object.userData;
  if (ui.mode === 'connect') toast('Draw cables in the 2D view, port to port');
  else select(kind, id);
}
function disposeGroup(g) {
  g.traverse(o => {
    o.geometry?.dispose();
    const m = o.material;
    if (m) (Array.isArray(m) ? m : [m]).forEach(mm => { mm.map?.dispose(); mm.dispose(); });
  });
  g.clear();
}
function textSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = color; g.font = '600 46px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 48);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  sp.scale.set(0.6, 0.1125, 1);
  return sp;
}
/* front-to-back extent of a device, in metres (z is negative into the rack) */
function devZ(r, d, S) {
  const zf = -RAIL_INSET * S, zb = -(r.depth - RAIL_INSET) * S;
  if (isZeroU(d)) return d.mount === 'front' ? [zf, zf + 0.06] : [zb - 0.06, zb];
  const dep = d.depth * S;
  return d.mount === 'front' ? [zf - dep, zf] : [zb, zb + dep];
}
function build3D() {
  if (!T.ready) return;
  disposeGroup(T.group);
  T.pickables = [];
  const S = 0.001, L = layout(), port = portMap(L), V3 = THREE.Vector3;
  const C = n => new THREE.Color(cssVar(n));
  const lineMat = new THREE.LineBasicMaterial({ color: C('--line') });
  const softMat = new THREE.LineBasicMaterial({ color: C('--line-soft') });
  const accentLine = new THREE.LineBasicMaterial({ color: C('--accent') });
  const add = o => (T.group.add(o), o);

  const maxDepth = Math.max(1000, ...doc.racks.map(r => r.depth)) * S;
  const size = Math.ceil(Math.max(L.w * S, maxDepth) + 2);
  const grid = add(new THREE.GridHelper(size, size * 2, C('--grid'), C('--grid2')));
  grid.position.set(L.w * S / 2, 0, -maxDepth / 2);

  for (const r of doc.racks) {
    const R = L.racks[r.id], w = r.width * S, h = R.h * S, d = r.depth * S, cx = (R.x + r.width / 2) * S;
    const box = add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)), isSel('rack', r.id) ? accentLine : lineMat));
    box.position.set(cx, h / 2, -d / 2);
    const y0 = FRAME_BOT * S, y1 = (FRAME_BOT + r.units * U_MM) * S, zf = -RAIL_INSET * S, zb = -(r.depth - RAIL_INSET) * S;
    const pts = [];
    for (const x of [R.px * S, (R.px + PANEL_W) * S]) for (const z of [zf, zb]) pts.push(x, y0, z, x, y1, z);
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    add(new THREE.LineSegments(rg, softMat));
    add(textSprite(r.name, cssVar('--fg'))).position.set(cx, h + 0.08, 0);

    for (const dv of r.devices) {
      const b = devRect(L, r, dv), [z0, z1] = devZ(r, dv, S);
      const bx = (b.x + b.w / 2) * S, by = (L.h - (b.y + b.h / 2)) * S, bh = b.h * S - (b.vertical ? 0 : 0.002);
      const sel = isSel('device', dv.id) || ui.multi.has(dv.id);
      const col = sel ? C('--accent') : devWarn(r, dv) ? C('--bad') : new THREE.Color(devColor(dv)).lerp(C('--dev'), 0.45);
      const mat = new THREE.MeshLambertMaterial({ color: col });
      const meshes = [];
      if (b.vertical) {
        const body = add(new THREE.Mesh(new THREE.BoxGeometry(b.w * S, bh, z1 - z0), mat));
        body.position.set(bx, by, (z0 + z1) / 2);
        meshes.push(body);
      } else {
        const bw = (isHalf(dv) ? BODY_W / 2 - 10 : BODY_W) * S;
        const body = add(new THREE.Mesh(new THREE.BoxGeometry(bw, bh, z1 - z0), mat));
        body.position.set(bx, by, (z0 + z1) / 2);
        const front = dv.mount === 'front';
        const plate = add(new THREE.Mesh(new THREE.BoxGeometry(b.w * S, bh, 0.003), mat));
        plate.position.set(bx, by, front ? z1 + 0.0015 : z0 - 0.0015);
        meshes.push(body, plate);
      }
      for (const m of meshes) {
        m.userData = { kind: 'device', id: dv.id };
        T.pickables.push(m);
        add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), lineMat)).position.copy(m.position);
      }
    }
  }

  const topY = L.h * S + 0.08;
  for (const c of doc.cables) {
    const a = port(c.a, c.id, c.pa), b = port(c.b, c.id, c.pb);
    if (!a || !b) continue;
    const P = q => {
      const [z0, z1] = devZ(q.rack, q.dev, S), front = q.side === 'front';
      return { v: new V3(q.x * S, (L.h - q.y) * S, front ? z1 + 0.006 : z0 - 0.006), n: front ? 1 : -1 };
    };
    const A = P(a), B = P(b);
    const out = X => X.v.clone().add(new V3(0, -0.02, 0.07 * X.n));
    const pts = [A.v, out(A)];
    if (A.n === B.n) {
      const m = A.v.clone().lerp(B.v, 0.5);
      m.z += 0.12 * A.n;
      m.y = Math.max(0.03, Math.min(A.v.y, B.v.y) - 0.06 - 0.12 * A.v.distanceTo(B.v));
      pts.push(m);
    } else {
      pts.push(new V3(A.v.x, topY, A.v.z + 0.07 * A.n), new V3(B.v.x, topY, B.v.z + 0.07 * B.n));
    }
    pts.push(out(B), B.v);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const sel = isSel('cable', c.id), power = ctype(c.type).kind === 'power';
    const tube = add(new THREE.Mesh(new THREE.TubeGeometry(curve, 80, sel ? 0.007 : power ? 0.005 : 0.004, 6, false),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(cableColor(c)), emissive: sel ? C('--accent') : 0x000000, emissiveIntensity: 0.4 })));
    tube.userData = { kind: 'cable', id: c.id };
    T.pickables.push(tube);
  }
}
