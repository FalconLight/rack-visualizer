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
      const lvl = ui.check && ui.conn?.devs[dv.id]?.level;   // check mode: problems in colour, the rest faded
      const col = sel ? C('--accent') : devWarn(r, dv) || lvl === 'bad' ? C('--bad') : lvl === 'warn' ? C('--warn')
        : new THREE.Color(devColor(dv)).lerp(C('--dev'), ui.check ? 0.85 : 0.45);
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

  for (const { c, pts } of cableRoutes3D(L, port, S)) {
    const curve = roundedCurve(pts, 0.02);
    if (!curve) continue;
    const sel = isSel('cable', c.id), power = ctype(c.type).kind === 'power';
    const tube = add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(400, 40 + pts.length * 16), sel ? 0.007 : power ? 0.005 : 0.004, 6, false),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(cableColor(c)), emissive: sel ? C('--accent') : 0x000000, emissiveIntensity: 0.4 })));
    tube.userData = { kind: 'cable', id: c.id };
    T.pickables.push(tube);
  }
}

/* Cables run the way real ones do, so they never cut through equipment:
   out of the port, sideways just off the face it is on, into the rack's side cable channel (between the
   rails and the side panel), along the channel (and through the depth of the rack when the two ends are
   on different faces), and between racks up to an overhead tray or down under the floor.
   Every parallel run keeps SEP between centres (the thickest cable is 10 mm), as the 2D diagram does:
   - every cable leaving a device face gets its own slot there: a height track within the device's height
     and a depth off the face, nearest the channel closest to the face, so its run passes in front of
     its neighbours' plugs;
   - the channel is a grid of lanes, across its width and, behind the rails, into the depth of the rack,
     shortest runs nearest the rails, so vertical runs never share a spot; a lane's column is picked so
     no two cables turn into the same column at the same height;
   - lanes sit behind the rails while the runs along a device face stay in front of them, so those never meet. */
const SEP = 0.012, STUB = 0.010, STUB_LEVELS = 4, MAX_LEVELS = 20, TRAY_Z = -0.3;
function cableRoutes3D(L, port, S) {
  const V3 = THREE.Vector3, idx = {};
  doc.racks.forEach((r, i) => (idx[r.id] = i));
  const end = P => {   // the port on the device face, and which way that face looks (+1 front, -1 rear)
    const [z0, z1] = devZ(P.rack, P.dev, S), n = P.side === 'front' ? 1 : -1;
    return { P, n, v: new V3(P.x * S, (L.h - P.y) * S, n > 0 ? z1 + 0.006 : z0 - 0.006) };
  };
  const sideOf = (P, Q) => {   // which side channel P's end uses, Q being the other end
    if (isZeroU(P.dev)) return P.dev.side === 'right' ? 'R' : 'L';   // a vertical PDU already sits in one
    const ch = P.rack.channel || 'both';
    if (ch !== 'both') return ch === 'left' ? 'L' : 'R';
    if (Q.rack !== P.rack) return idx[Q.rack.id] > idx[P.rack.id] ? 'R' : 'L';
    if (isZeroU(Q.dev)) return Q.dev.side === 'right' ? 'R' : 'L';
    return (P.x + Q.x) / 2 < L.racks[P.rack.id].px + PANEL_W / 2 ? 'L' : 'R';
  };
  /* lanes near the front rails serve ends in the front half of the rack, lanes near the rear rails the rest */
  const half = E => (E.v.z > -E.P.rack.depth * S / 2 ? 'F' : 'B');
  const topY = L.h * S + 0.08;
  const items = [], lanes = {};
  for (const c of doc.cables) {
    const a = port(c.a, c.id, c.pa), b = port(c.b, c.id, c.pb);
    if (!a || !b) continue;
    const it = { c, A: end(a), B: end(b), same: a.rack === b.rack };
    if (it.same) {
      it.sA = it.sB = sideOf(a, b);
      (lanes[a.rack.id + ':' + it.sA + half(it.A)] ||= []).push({ it, ends: 'AB', span: Math.abs(it.A.v.y - it.B.v.y) });
    } else {
      it.sA = sideOf(a, b); it.sB = sideOf(b, a);
      it.under = (c.via || doc.settings.via) === 'bottom';
      const ty = it.under ? 0 : topY;
      (lanes[a.rack.id + ':' + it.sA + half(it.A)] ||= []).push({ it, ends: 'A', span: Math.abs(it.A.v.y - ty) });
      (lanes[b.rack.id + ':' + it.sB + half(it.B)] ||= []).push({ it, ends: 'B', span: Math.abs(it.B.v.y - ty) });
    }
    items.push(it);
  }
  /* slots along each device face: height tracks every SEP within the device's height, times depth levels.
     Nearest the channel first: lowest level, then the track nearest its port. Vertical PDUs sit in the
     channel already, so their cables leave straight from the port. */
  const faces = {};
  for (const it of items) for (const e of ['A', 'B']) {
    const E = it[e];
    E.side = it['s' + e];
    if (isZeroU(E.P.dev)) { E.stub = STUB; E.ty = E.v.y; continue; }
    (faces[E.P.dev.id + ':' + E.n] ||= []).push(E);
  }
  for (const list of Object.values(faces)) {
    const P = list[0].P, b = devRect(L, P.rack, P.dev), R = L.racks[P.rack.id];
    const mid = (L.h - b.y - b.h / 2) * S, nT = Math.max(0, Math.floor((b.h * S / 2 - 0.006) / SEP));
    const tracks = [mid];
    for (let j = 1; j <= nT; j++) tracks.push(mid + j * SEP, mid - j * SEP);
    const edge = E => (E.side === 'L' ? R.px : R.px + PANEL_W) * S, used = new Set();
    // a crowded face bulges further out, as a bundle of patch cords does, rather than cables sharing a spot
    const levels = Math.min(MAX_LEVELS, Math.max(STUB_LEVELS, Math.ceil(list.length / tracks.length)));
    list.sort((p, q) => Math.abs(p.v.x - edge(p)) - Math.abs(q.v.x - edge(q)));
    list.forEach((E, k) => {
      let slot = null;
      for (let lv = 0; lv < levels && !slot; lv++) {
        const free = tracks.map((y, t) => ({ y, t })).filter(o => !used.has(lv + ':' + o.t));
        if (free.length) slot = { lv, ...free.sort((p, q) => Math.abs(p.y - E.v.y) - Math.abs(q.y - E.v.y))[0] };
      }
      slot ||= { lv: k % levels, t: -1, y: E.v.y };   // more cables than even that: share
      used.add(slot.lv + ':' + slot.t);
      E.stub = STUB + slot.lv * SEP;
      E.ty = slot.y;
    });
  }
  /* the lane grid: columns outward from the rails, clear of a vertical PDU against the side panel;
     rows into the depth of the rack, starting just behind the rails. Each cable takes the column with
     the fewest lanes so far where nothing else turns in at the same height, nearest the rails on a tie. */
  const columns = {};
  /* a height in column u where nothing else turns in; getting there from the track y is a short step at
     depth za, kept clear of the other steps at that depth */
  const freeHeight = (u, y, za) => {
    for (let m = 0; m < 80; m++) {
      const y2 = y + (m % 2 ? 1 : -1) * Math.ceil(m / 2) * SEP, lo = Math.min(y, y2), hi = Math.max(y, y2);
      if (u.ys.some(v => Math.abs(v - y2) < SEP)) continue;
      if (m && u.steps.some(s => Math.abs(s.za - za) < SEP && s.lo < hi && lo < s.hi)) continue;
      return y2;
    }
    return y;
  };
  for (const key of Object.keys(lanes).sort()) {
    const list = lanes[key];
    const rack = list[0].it[list[0].ends[0]].P.rack, R = L.racks[rack.id], side = key.slice(-2, -1), h = key.slice(-1);
    const pdu = rack.devices.some(d => isZeroU(d) && (d.side === 'right') === (side === 'R'));
    const room = ((rack.width - PANEL_W) / 2 - 12 - (pdu ? ZERO_U_W + 8 : 0)) * S;
    const cols = Array.from({ length: Math.max(1, Math.floor(room / SEP) + 1) }, (_, c) => (columns[rack.id + side + c] ||= { F: 0, B: 0, ys: [], steps: [] }));
    const rail = (h === 'B' ? -(rack.depth - RAIL_INSET) : -RAIL_INSET) * S, deeper = h === 'B' ? 1 : -1;
    for (const l of list.sort((p, q) => p.span - q.span)) {
      const ends = [...l.ends].map(e => l.it[e]);
      let best = null;
      cols.forEach((u, c) => {
        const clash = ends.some(E => u.ys.some(v => Math.abs(v - E.ty) < SEP));
        const score = (clash ? 1e6 : 0) + u[h] * cols.length + c;
        if (!best || score < best.score) best = { u, c, score };
      });
      const layer = best.u[h]++, off = 0.006 + best.c * SEP;
      const x = side === 'L' ? R.px * S - off : (R.px + PANEL_W) * S + off, zl = rail + deeper * (SEP + layer * SEP);
      for (const E of ends) {
        const za = E.v.z + E.n * E.stub, dy = freeHeight(best.u, E.ty, za);
        best.u.ys.push(dy);
        if (dy !== E.ty) best.u.steps.push({ za, lo: Math.min(E.ty, dy), hi: Math.max(E.ty, dy) });
        Object.assign(E, { x, zl, dy });
      }
    }
  }
  /* trays between racks, shortest spans first. Every cable gets its own slot (height level, depth row), so
     the runs along the tray never share a spot; and cables rising from the same channel column turn into
     the tray at different heights, so their short runs across the depth don't either. */
  const trays = items.filter(it => !it.same).sort((p, q) => Math.abs(p.A.x - p.B.x) - Math.abs(q.A.x - q.B.x));
  const levelsAt = new Map(), rowsAt = {};
  for (const it of trays) {
    const cols = [it.A, it.B].map(E => E.x.toFixed(4) + it.under);
    const taken = cols.map(k => levelsAt.get(k) || levelsAt.set(k, new Set()).get(k));
    let l = 0;
    while (taken.some(t => t.has(l))) l++;
    taken.forEach(t => t.add(l));
    const row = (rowsAt[l + it.under] = (rowsAt[l + it.under] ?? -1) + 1);
    it.ty = it.under ? -0.05 - l * SEP : topY + l * SEP;
    it.tz = TRAY_Z - row * SEP;
  }
  return items.map(it => {
    const { A, B } = it, za = A.v.z + A.n * A.stub, zb = B.v.z + B.n * B.stub;
    /* out of the port, to its track, along the face to the channel, to a free height there, into the lane */
    const head = [A.v, new V3(A.v.x, A.v.y, za), new V3(A.v.x, A.ty, za), new V3(A.x, A.ty, za), new V3(A.x, A.dy, za), new V3(A.x, A.dy, A.zl)];
    const tail = [new V3(B.x, B.dy, B.zl), new V3(B.x, B.dy, zb), new V3(B.x, B.ty, zb), new V3(B.v.x, B.ty, zb), new V3(B.v.x, B.v.y, zb), B.v];
    const mid = it.same
      ? []   // one lane: straight along it from the first end's track to the second's
      : [new V3(A.x, it.ty, A.zl), new V3(A.x, it.ty, it.tz), new V3(B.x, it.ty, it.tz), new V3(B.x, it.ty, B.zl)];
    return { c: it.c, pts: [...head, ...mid, ...tail] };
  });
}
/* a polyline with rounded corners, as one curve for TubeGeometry */
function roundedCurve(pts, r) {
  const p = [];
  for (const q of pts) if (!p.length || q.distanceTo(p[p.length - 1]) > 1e-4) p.push(q);
  if (p.length < 2) return null;
  const s = [p[0]];   // drop points where the line goes straight on
  for (let i = 1; i < p.length - 1; i++) {
    const u = p[i].clone().sub(s[s.length - 1]).normalize(), w = p[i + 1].clone().sub(p[i]).normalize();
    if (u.dot(w) < 0.9999) s.push(p[i]);
  }
  s.push(p[p.length - 1]);
  const path = new THREE.CurvePath();
  let cur = s[0];
  for (let i = 1; i < s.length - 1; i++) {
    const c = s[i], rr = Math.min(r, c.distanceTo(s[i - 1]) / 2, c.distanceTo(s[i + 1]) / 2);
    const a = c.clone().add(s[i - 1].clone().sub(c).setLength(rr)), b = c.clone().add(s[i + 1].clone().sub(c).setLength(rr));
    if (cur.distanceTo(a) > 1e-5) path.add(new THREE.LineCurve3(cur, a));
    path.add(new THREE.QuadraticBezierCurve3(a, c, b));
    cur = b;
  }
  if (cur.distanceTo(s[s.length - 1]) > 1e-5 || !path.curves.length) path.add(new THREE.LineCurve3(cur, s[s.length - 1]));
  return path;
}
