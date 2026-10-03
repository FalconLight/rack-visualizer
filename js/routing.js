'use strict';
/* =====================================================================
   Rack Visualizer · cable geometry
   Port positions, curved cables, diagram routing (cable managers,
   side channels, overhead / underfloor trays), lengths, and the
   crossing-reducing "Tidy" optimiser. Works in front-view coordinates.
   ===================================================================== */

/* where a cable end sits: front-view x/y, plus the face of the rack it is on */
function portMap(L) {
  const cache = {};
  return (devId, cabId, key) => {
    const f = findDev(devId); if (!f) return null;
    const base = { mount: f.dev.mount, rack: f.rack, dev: f.dev, key, side: key ? portSide(f.dev, key) : f.dev.mount };
    const p = (cache[devId] ??= portLayout(L, f.rack, f.dev)).find(q => q.key === key);
    if (p) return { ...base, x: p.x + p.w / 2, y: p.y + p.h / 2 };
    const r = devRect(L, f.rack, f.dev);
    return { ...base, x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };
}
function cableCurve(a, b) {
  const sag = 50 + Math.min(450, Math.abs(a.x - b.x) * 0.12 + Math.abs(a.y - b.y) * 0.12);
  return [a, { x: a.x, y: a.y + sag }, { x: b.x, y: b.y + sag }, b];
}
const bezPath = q => `M${q[0].x},${q[0].y} C${q[1].x},${q[1].y} ${q[2].x},${q[2].y} ${q[3].x},${q[3].y}`;
function bezLen(p) {
  let len = 0, prev = p[0];
  for (let i = 1; i <= 40; i++) {
    const t = i / 40, m = 1 - t;
    const q = {
      x: m * m * m * p[0].x + 3 * m * m * t * p[1].x + 3 * m * t * t * p[2].x + t * t * t * p[3].x,
      y: m * m * m * p[0].y + 3 * m * m * t * p[1].y + 3 * m * t * t * p[2].y + t * t * t * p[3].y,
    };
    len += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q;
  }
  return len;
}
function polyLen(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}
function roundedPath(pts, r) {
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p = pts[i], p1 = pts[i + 1];
    const d0 = Math.hypot(p.x - p0.x, p.y - p0.y), d1 = Math.hypot(p1.x - p.x, p1.y - p.y), rr = Math.min(r, d0 / 2, d1 / 2);
    if (rr < 0.01) { d += ` L${p.x},${p.y}`; continue; }
    d += ` L${p.x + (p0.x - p.x) * rr / d0},${p.y + (p0.y - p.y) * rr / d0} Q${p.x},${p.y} ${p.x + (p1.x - p.x) * rr / d1},${p.y + (p1.y - p.y) * rr / d1}`;
  }
  const e = pts[pts.length - 1];
  return d + ` L${e.x},${e.y}`;
}

/* order `list` by a stored sequence of cable ids; unknown entries slot in by `key` */
function applyOrder(list, stored, key) {
  if (!stored) return list.sort((p, q) => key(p) - key(q));
  const pos = new Map(stored.map((id, i) => [id, i]));
  const known = list.filter(l => pos.has(l.id)).sort((p, q) => pos.get(p.id) - pos.get(q.id));
  for (const l of list.filter(l => !pos.has(l.id)).sort((p, q) => key(p) - key(q))) {
    const i = known.findIndex(o => key(o) > key(l));
    known.splice(i < 0 ? known.length : i, 0, l);
  }
  return known;
}

/* Diagram routing for one face of the racks. Every cable gets
   - a horizontal track: inside the nearest cable manager (within ~4U), else in the free band
     above / below the device's port grid,
   - a vertical lane in the rack's side channel,
   - between racks, its own overhead or underfloor track.
   Two ends that meet in the same cable manager run straight through it.
   `orders`: explicit lane orders (used by the optimiser); undefined = the saved "Tidy" result. */
const LANE = 8;
function diagramRoutes(L, port, face = 'front', orders) {
  const stored = orders === undefined ? doc.routeOrder?.[face] || {} : orders;
  const items = [], idx = {}, routes = {}, meta = { lanes: {}, ends: {}, top: [], bottom: [] };
  doc.racks.forEach((r, i) => (idx[r.id] = i));
  for (const c of doc.cables) {
    const a = port(c.a, c.id, c.pa), b = port(c.b, c.id, c.pb);
    if (a && b && (a.side === face || b.side === face)) items.push({ c, a, b, id: c.id });
  }
  if (!items.length) return { routes, meta };

  const mgrs = {};
  for (const r of doc.racks) mgrs[r.id] = r.devices.filter(d => isMgr(d) && d.mount === face).map(d => ({ dev: d, rect: devRect(L, r, d) }));
  const nearMgr = P => {
    if (P.side !== face || isZeroU(P.dev)) return null;
    let best = null, bd = 4.5 * U_MM;
    for (const m of mgrs[P.rack.id]) {
      const dist = Math.abs(m.rect.y + m.rect.h / 2 - P.y);
      if (m.dev.id !== P.dev.id && dist < bd) { bd = dist; best = m; }
    }
    return best;
  };
  const sideOf = (rack, x, prefer) => {
    const ch = rack.channel || 'both';
    if (ch === 'left') return 'L';
    if (ch === 'right') return 'R';
    return prefer || (x < L.racks[rack.id].px + PANEL_W / 2 ? 'L' : 'R');
  };
  for (const it of items) {
    const { a, b } = it;
    it.ma = nearMgr(a); it.mb = nearMgr(b);
    if (a.rack === b.rack) {
      if (it.ma && it.ma === it.mb) { it.local = it.ma; continue; }
      it.sA = it.sB = sideOf(a.rack, (a.x + b.x) / 2);
    } else {
      const right = idx[b.rack.id] > idx[a.rack.id];
      it.sA = sideOf(a.rack, a.x, right ? 'R' : 'L');
      it.sB = sideOf(b.rack, b.x, right ? 'L' : 'R');
      it.via = it.c.via || doc.settings.via || 'top';
    }
  }

  /* horizontal tracks. The port farthest from the lane gets the track farthest from where
     its stub comes in, so stubs never cross the tracks of their neighbours. */
  const devBands = {}, mgrBands = {};
  for (const it of items) {
    if (it.local) {
      (mgrBands[it.local.dev.id] ||= { rect: it.local.rect, A: [], B: [], L: [] }).L.push({ it, span: Math.abs(it.a.x - it.b.x) });
      continue;
    }
    for (const e of ['a', 'b']) {
      const P = it[e], m = it['m' + e], entry = { it, e, x: P.x, dir: it['s' + e.toUpperCase()] === 'R' ? 1 : -1 };
      const b = devRect(L, P.rack, P.dev);
      if (b.vertical) { it[e + 'y'] = P.y; continue; }               // 0U PDUs sit in the channel already
      if (m) {
        const below = P.y > m.rect.y + m.rect.h / 2;
        (mgrBands[m.dev.id] ||= { rect: m.rect, A: [], B: [], L: [] })[below ? 'B' : 'A'].push(entry);
        continue;
      }
      if (P.side !== face) { (devBands[P.dev.id + ':x'] ||= { range: [b.y + 2, b.y + b.h - 2], fromBelow: true, list: [] }).list.push(entry); continue; }
      const pl = portLayout(L, P.rack, P.dev).filter(q => q.side === face);
      const pr = pl.find(q => q.key === P.key);
      const pTop = Math.min(...pl.map(q => q.y)), pBot = Math.max(...pl.map(q => q.y + q.h));
      if (pr && pr.y + pr.h / 2 < b.y + b.h / 2 - 1) (devBands[P.dev.id + ':t'] ||= { range: [b.y + 2, pTop - 2], fromBelow: true, list: [] }).list.push(entry);
      else (devBands[P.dev.id + ':b'] ||= { range: [pr ? pBot + 2 : b.y + 2, b.y + b.h - 2], fromBelow: false, list: [] }).list.push(entry);
    }
  }
  const assign = (list, [y0, y1], fromBelow) => {
    list.sort((p, q) => p.x * p.dir - q.x * q.dir);
    const step = (y1 - y0) / list.length;
    list.forEach((l, k) => (l.it[l.e + 'y'] = fromBelow ? y0 + (k + 0.5) * step : y1 - (k + 0.5) * step));
  };
  for (const g of Object.values(devBands)) assign(g.list, g.range, g.fromBelow);
  for (const m of Object.values(mgrBands)) {   // cables from above use the top of the manager, from below the bottom
    const y0 = m.rect.y + 5, y1 = m.rect.y + m.rect.h - 5, h = (y1 - y0) / (m.A.length + m.L.length + m.B.length);
    let y = y0;
    if (m.A.length) { assign(m.A, [y, y + h * m.A.length], false); y += h * m.A.length; }
    m.L.sort((p, q) => p.span - q.span).forEach((l, k) => (l.it.ty = y + (k + 0.5) * h));
    y += h * m.L.length;
    if (m.B.length) assign(m.B, [y, y1], true);
  }

  /* vertical lanes in the side channels, shortest runs closest to the rack */
  const top = Math.min(...Object.values(L.racks).map(R => R.top)) - 75, floorY = L.h + 45;
  const lanes = {};
  for (const it of items) {
    if (it.local) continue;
    const ra = it.a.rack, rb = it.b.rack;
    if (ra === rb) (lanes[ra.id + ':' + it.sA] ||= []).push({ it, id: it.id, ends: 'ab', span: Math.abs(it.ay - it.by) });
    else {
      const ty = it.via === 'bottom' ? floorY : top;
      (lanes[ra.id + ':' + it.sA] ||= []).push({ it, id: it.id, ends: 'a', span: Math.abs(it.ay - ty) });
      (lanes[rb.id + ':' + it.sB] ||= []).push({ it, id: it.id, ends: 'b', span: Math.abs(it.by - ty) });
    }
  }
  for (const [key, list0] of Object.entries(lanes)) {
    const [rid, side] = key.split(':'), R = L.racks[rid];
    const list = applyOrder(list0, stored[key], l => l.span);
    meta.lanes[key] = list.map(l => l.id);
    meta.ends[key] = list.map(l => l.ends);
    const sp = list.length > 12 ? Math.max(3, 100 / list.length) : LANE;
    list.forEach((l, k) => {
      const x = side === 'R' ? R.px + PANEL_W + 12 + k * sp : R.px - 44 - k * sp;
      if (l.ends.includes('a')) l.it.lxA = x;
      if (l.ends.includes('b')) l.it.lxB = x;
    });
  }
  /* trays between racks, shortest spans closest to the racks */
  for (const via of ['top', 'bottom']) {
    const list = applyOrder(items.filter(it => !it.local && it.via === via), stored[via], it => Math.abs(it.lxA - it.lxB));
    meta[via] = list.map(it => it.id);
    list.forEach((it, k) => (it.oy = via === 'top' ? top - k * LANE : floorY + k * LANE));
  }
  for (const it of items) {
    const { a, b } = it;
    routes[it.id] = it.local ? [a, { x: a.x, y: it.ty }, { x: b.x, y: it.ty }, b]
      : it.oy == null ? [a, { x: a.x, y: it.ay }, { x: it.lxA, y: it.ay }, { x: it.lxA, y: it.by }, { x: b.x, y: it.by }, b]
      : [a, { x: a.x, y: it.ay }, { x: it.lxA, y: it.ay }, { x: it.lxA, y: it.oy }, { x: it.lxB, y: it.oy },
         { x: it.lxB, y: it.by }, { x: b.x, y: it.by }, b];
  }
  return { routes, meta };
}

/* estimated length of every cable, along the route that is drawn, plus 10 % slack */
function cableLengths(L = layout()) {
  const port = portMap(L), out = {}, ortho = doc.settings.route === 'ortho';
  const R = ortho ? { front: diagramRoutes(L, port, 'front').routes, rear: diagramRoutes(L, port, 'rear').routes } : null;
  for (const c of doc.cables) {
    const a = port(c.a, c.id, c.pa), b = port(c.b, c.id, c.pb);
    if (!a || !b) continue;
    const pts = R && (R[a.side][c.id] || R[b.side][c.id]);
    let len = pts ? polyLen(pts) : bezLen(cableCurve(a, b));
    if (a.side !== b.side) len += Math.max(usableDepth(a.rack), usableDepth(b.rack));   // through the rack
    out[c.id] = len * 1.1;
  }
  return out;
}

/* a route's horizontal segments [x0, x1, y] and vertical segments [y0, y1, x] */
function routeSegs(pts) {
  const H = [], V = [];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1], q = pts[i];
    if (Math.abs(p.y - q.y) < 0.01 && Math.abs(p.x - q.x) > 0.01) H.push([Math.min(p.x, q.x), Math.max(p.x, q.x), p.y]);
    else if (Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) > 0.01) V.push([Math.min(p.y, q.y), Math.max(p.y, q.y), p.x]);
  }
  return { H, V };
}
const crosses = (h, v) => v[2] > h[0] + 0.01 && v[2] < h[1] - 0.01 && h[2] > v[0] + 0.01 && h[2] < v[1] - 0.01;
/* crossings between two cables */
function pairCrossings(A, B) {
  let n = 0;
  for (const h of A.H) for (const v of B.V) if (crosses(h, v)) n++;
  for (const h of B.H) for (const v of A.V) if (crosses(h, v)) n++;
  return n;
}
/* crossings between horizontal and vertical segments of different cables */
function countCrossings(routes) {
  const H = [], V = [];
  for (const [id, pts] of Object.entries(routes)) {
    const s = routeSegs(pts);
    for (const h of s.H) H.push([...h, id]);
    for (const v of s.V) V.push([...v, id]);
  }
  let n = 0;
  for (const h of H) for (const v of V) if (h[3] !== v[3] && crosses(h, v)) n++;
  return n;
}
/* "Tidy": swap neighbouring cables in each lane and tray while that removes crossings.
   Swapping two neighbours only swaps their lane coordinates, so each trial patches those two
   routes and recounts their crossings alone, instead of rebuilding everything.
   Bounded by a time budget so big layouts stay responsive. */
function optimizeRoutes(budget = 1500, start = {}) {   // start: lane orders per face to begin from (default: shortest first)
  const L = layout(), port = portMap(L), t0 = performance.now(), result = {};
  let before = 0, after = 0;
  for (const face of ['front', 'rear']) {
    before += countCrossings(diagramRoutes(L, port, face).routes);
    const base = diagramRoutes(L, port, face, start[face] || {});
    const routes = {}, segs = {};
    for (const [id, pts] of Object.entries(base.routes)) { routes[id] = pts.map(p => ({ x: p.x, y: p.y })); segs[id] = routeSegs(routes[id]); }
    const ids = Object.keys(routes);
    const crossOf = (p, q) => {   // crossings that involve p or q
      let n = 0;
      for (const o of ids) if (o !== p && o !== q) n += pairCrossings(segs[p], segs[o]) + pairCrossings(segs[q], segs[o]);
      return n + pairCrossings(segs[p], segs[q]);
    };
    /* every reorderable list: the cable ids, which route points hold its coordinate, and which axis */
    const lists = [];
    for (const [k, v] of Object.entries(base.meta.lanes))
      lists.push({ key: k, arr: [...v], axis: 'x', pts: base.meta.ends[k].map(e => (e === 'b' ? [4, 5] : [2, 3])) });
    for (const via of ['top', 'bottom']) lists.push({ key: via, arr: [...base.meta[via]], axis: 'y', pts: base.meta[via].map(() => [3, 4]) });
    const swap = (l, i) => {
      const p = l.arr[i], q = l.arr[i + 1], [ip, iq] = [l.pts[i], l.pts[i + 1]];
      const vp = routes[p][ip[0]][l.axis], vq = routes[q][iq[0]][l.axis];
      for (const j of ip) routes[p][j][l.axis] = vq;
      for (const j of iq) routes[q][j][l.axis] = vp;
      segs[p] = routeSegs(routes[p]); segs[q] = routeSegs(routes[q]);
      [l.arr[i], l.arr[i + 1]] = [q, p];
      [l.pts[i], l.pts[i + 1]] = [iq, ip];
    };
    for (let pass = 0; pass < 8 && performance.now() - t0 < budget; pass++) {
      let changed = false;
      for (const l of lists) {
        for (let i = 0; i + 1 < l.arr.length && performance.now() - t0 < budget; i++) {
          const p = l.arr[i], q = l.arr[i + 1], old = crossOf(p, q);
          swap(l, i);
          if (crossOf(p, q) < old) changed = true; else swap(l, i);   // swapping back restores it exactly
        }
      }
      if (!changed) break;
    }
    const orders = Object.fromEntries(lists.map(l => [l.key, l.arr]));
    after += countCrossings(diagramRoutes(L, port, face, orders).routes);
    result[face] = orders;
  }
  return { orders: result, before, after };
}
