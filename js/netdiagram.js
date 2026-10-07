'use strict';
/* =====================================================================
   Rack Visualizer · network diagram
   The connections drawn as a diagram: every device with ports is a box,
   the cables between two devices one link (with a count when there are
   several). "Data" shows the network, "Power" the power chain from the
   building feed down. Shown on its own or next to the racks; both views
   share the selection.
   Until a box is moved the diagram arranges itself (top-down tree) and
   follows every change. Moving a box, or picking a layout from "Arrange",
   keeps the positions (per layer, saved with the layout); devices added
   later are placed next to what they connect to.
   ===================================================================== */

const netPane = $('#netPane'), netSvg = $('#netSvg');
const NODE_W = 180, NODE_H = 60, GRID = 20;   // boxes are whole grid cells, so both edges sit on grid lines
const ROW_GAP = 80, COL_GAP = 20, COMP_GAP = 100, LOOSE_GAP = 80;
ui.net = { layer: 'data', cam: { x: 0, y: 0, k: 1 }, fitK: 1, userMoved: false, bounds: null, lastSel: null };
try { ui.net.layer = localStorage.getItem('rackviz.netLayer') === 'power' ? 'power' : 'data'; } catch (e) { /* ignore */ }
const netSet = () => doc.settings.net;
const snapTo = v => Math.round(v / GRID) * GRID;

/* where a device sits, top to bottom, in a data network: incoming lines first, endpoints and copper panels last */
function netTier(d) {
  if (['patch', 'fiber', 'odf'].includes(d.type)) return portConn(d) === 'rj45' ? 6 : 0;
  return { ont: 1, mediaconv: 2, firewall: 2, router: 2, switch: 3, wlc: 4, pbx: 4 }[d.type] ?? 5;
}

/* ---------- graph ---------- */
function netGraph(layer) {
  const power = layer === 'power', nodes = new Map(), links = new Map();
  for (const r of doc.racks) for (const d of r.devices)
    if (power ? nInlets(d) + nOutlets(d) > 0 : nPorts(d) + nUplinks(d) > 0) nodes.set(d.id, { id: d.id, dev: d, rack: r, links: [] });
  for (const c of doc.cables) {
    if (!c.pa || !c.pb || (portKind(c.pa) === 'power') !== power) continue;
    let [a, b, pa, pb] = [c.a, c.b, c.pa, c.pb];
    if (power && pa[0] === 'i') [a, b, pa, pb] = [b, a, pb, pa];   // power flows outlet → inlet, top-down
    if (!nodes.has(a) || !nodes.has(b)) continue;
    const key = power ? a + '>' + b : [a, b].sort().join('|');
    let l = links.get(key);
    if (!l) {
      l = { id: key, a, b, cables: [] };
      links.set(key, l);
      nodes.get(a).links.push(l); nodes.get(b).links.push(l);
    }
    l.cables.push({ c, pa: a === l.a ? pa : pb, pb: a === l.a ? pb : pa });
  }
  /* power: the building feed above every source marked as having it */
  if (power) {
    const mains = [...nodes.values()].filter(n => n.dev.mains && nOutlets(n.dev) > 0);
    if (mains.length) {
      const g = { id: '#mains', mains: true, links: [] };
      nodes.set(g.id, g);
      for (const n of mains) { const l = { id: '#mains>' + n.id, a: g.id, b: n.id, cables: [], feed: true }; links.set(l.id, l); g.links.push(l); n.links.push(l); }
    }
  }
  return { nodes, links, layer };
}
const netOther = (G, n, l) => G.nodes.get(l.a === n.id ? l.b : l.a);
/* rack order, then top to bottom: keeps the diagram close to how the racks read */
function physOrder(n) {
  if (n.mains) return -1;
  return doc.racks.indexOf(n.rack) * 1000 + (n.rack.units - (isZeroU(n.dev) ? 0 : n.dev.u));
}
function netComponents(G) {
  const comps = [], seen = new Set();
  for (const n of [...G.nodes.values()].sort((p, q) => physOrder(p) - physOrder(q))) {
    if (seen.has(n.id) || !n.links.length) continue;
    const list = [], stack = [n];
    seen.add(n.id);
    while (stack.length) {
      const m = stack.pop(); list.push(m);
      for (const l of m.links) { const o = netOther(G, m, l); if (!seen.has(o.id)) { seen.add(o.id); stack.push(o); } }
    }
    comps.push(list);
  }
  comps.sort((p, q) => q.length - p.length);
  return { comps, loose: [...G.nodes.values()].filter(n => !n.links.length).sort((p, q) => physOrder(p) - physOrder(q)) };
}

/* ---------- arrangements ----------
   Each returns a position (top-left of the box) for every node; all of them snap to the grid. */
const ARRANGE = {
  tree: { label: 'Top-down tree', hint: 'Incoming lines at the top, endpoints at the bottom' },
  lr: { label: 'Left to right', hint: 'The same order, flowing left to right' },
  star: { label: 'Star', hint: 'Around the most connected device' },
  racks: { label: 'By rack', hint: 'One column per rack, top to bottom' },
};
/* layers: data counts steps from the incoming lines; power takes the longest chain from the feed */
function netLayers(G, list) {
  if (G.layer === 'power') {
    for (const n of list) n.layer = n.mains || !n.links.some(l => l.b === n.id) ? 0 : -1;
    for (let i = 0; i < list.length; i++) for (const n of list) for (const l of n.links)
      if (l.a === n.id && n.layer >= 0) { const o = G.nodes.get(l.b); o.layer = Math.min(list.length, Math.max(o.layer, n.layer + 1)); }
    for (const n of list) if (n.layer < 0) n.layer = 0;   // a loop with no way in
    return;
  }
  const top = Math.min(...list.map(n => netTier(n.dev)));
  const queue = list.filter(n => netTier(n.dev) === top);
  for (const n of list) n.layer = -1;
  for (const n of queue) n.layer = 0;
  for (let i = 0; i < queue.length; i++)
    for (const l of queue[i].links) { const o = netOther(G, queue[i], l); if (o.layer < 0) { o.layer = queue[i].layer + 1; queue.push(o); } }
}
/* tree / left to right: layers, ordered by the barycentre of the neighbours (fewer crossings), each box
   near its neighbours along the layer */
function layeredArrange(G, comps, horizontal) {
  const along = horizontal ? NODE_H + 40 : NODE_W + COL_GAP, across = horizontal ? NODE_W + 120 : NODE_H + ROW_GAP;
  const pos = new Map();
  let off = 0;
  for (const list of comps) {
    netLayers(G, list);
    const rows = [];
    for (const n of list) (rows[n.layer] ||= []).push(n);
    for (let i = 0; i < rows.length; i++) rows[i] ||= [];
    rows.forEach(r => r.forEach((n, i) => (n.ord = i)));
    const nb = (n, d) => n.links.map(l => netOther(G, n, l)).filter(o => o.layer === n.layer + d);
    const bary = (n, d) => { const v = nb(n, d).map(o => o.ord); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : n.ord; };
    for (let pass = 0; pass < 6; pass++) {
      const down = pass % 2 === 0;
      for (let k = down ? 1 : rows.length - 2; down ? k < rows.length : k >= 0; k += down ? 1 : -1) {
        rows[k].sort((p, q) => bary(p, down ? -1 : 1) - bary(q, down ? -1 : 1) || p.ord - q.ord);
        rows[k].forEach((n, i) => (n.ord = i));
      }
    }
    rows.forEach(r => r.forEach((n, i) => (n.a = i * along)));
    const want = (n, d) => { const v = nb(n, d).map(o => o.a); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : n.a; };
    for (let pass = 0; pass < 8; pass++) {
      for (const r of pass % 2 ? [...rows].reverse() : rows) {
        if (!r.length) continue;
        const d = r.map(n => want(n, pass % 2 ? 1 : -1)), p = [...d];
        for (let i = 1; i < p.length; i++) p[i] = Math.max(p[i], p[i - 1] + along);
        const shift = d.reduce((s, x, i) => s + x - p[i], 0) / d.length;
        r.forEach((n, i) => (n.a = p[i] + shift));
      }
    }
    const min = Math.min(...list.map(n => n.a)), max = Math.max(...list.map(n => n.a));
    for (const n of list) n.a = n.a - min + off;
    off += max - min + (horizontal ? NODE_H : NODE_W) + COMP_GAP;
  }
  /* each gap between layers as wide as its lanes need: as many as the links that overlap there at most
     (plus the ones going round the layer above), like the lanes of the 2D diagram */
  const nodes = comps.flat(), layers = Math.max(0, ...nodes.map(n => n.layer)) + 1, size = horizontal ? NODE_H : NODE_W;
  const spans = Array.from({ length: layers }, () => []);
  for (const l of G.links.values()) {
    const A = G.nodes.get(l.a), B = G.nodes.get(l.b);
    if (A.layer == null || B.layer == null) continue;
    const s = [Math.min(A.a, B.a) + size / 2, Math.max(A.a, B.a) + size / 2];
    if (A.layer !== B.layer) spans[Math.min(A.layer, B.layer)].push(s);
    else if (Math.abs(A.ord - B.ord) > 1) spans[A.layer].push(s);   // goes round the boxes between them
  }
  const most = list => {   // the most spans overlapping at any point
    const ev = list.flatMap(([a, b]) => [[a, 1], [b, -1]]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    let n = 0, top = 0;
    for (const [, d] of ev) top = Math.max(top, (n += d));
    return top;
  };
  const base = horizontal ? 120 : ROW_GAP, at = [0];
  for (let k = 0; k + 1 < layers; k++) at[k + 1] = at[k] + (horizontal ? NODE_W : NODE_H) + Math.max(base, most(spans[k]) * TRACK + 28);
  for (const n of nodes) pos.set(n.id, horizontal ? { x: at[n.layer], y: n.a } : { x: n.a, y: at[n.layer] });
  return pos;
}
/* star: the most connected device in the middle, the others in rings by how many steps away,
   each branch in its own slice of the circle */
function starArrange(G, comps) {
  const pos = new Map();
  let x0 = 0;
  for (const list of comps) {
    const deg = n => n.links.reduce((s, l) => s + Math.max(1, l.cables.length), 0);
    const hub = [...list].sort((p, q) => deg(q) - deg(p) || (p.dev && q.dev ? netTier(p.dev) - netTier(q.dev) : 0))[0];
    const kids = new Map(), level = new Map([[hub.id, 0]]), queue = [hub];
    for (let i = 0; i < queue.length; i++) {
      const m = queue[i];
      kids.set(m.id, []);
      for (const l of m.links) { const o = netOther(G, m, l); if (!level.has(o.id)) { level.set(o.id, level.get(m.id) + 1); kids.get(m.id).push(o); queue.push(o); } }
    }
    const leaves = n => (n.leaves ??= kids.get(n.id).length ? kids.get(n.id).reduce((s, k) => s + leaves(k), 0) : 1);
    list.forEach(n => delete n.leaves);
    const depth = Math.max(...level.values()), count = Array(depth + 1).fill(0);
    for (const v of level.values()) count[v]++;
    const radius = [0];   // rings far enough apart, and long enough for their boxes
    for (let l = 1; l <= depth; l++) radius[l] = Math.max(radius[l - 1] + 230, count[l] * (NODE_W + 40) / (2 * Math.PI));
    const at = new Map();
    const place = (n, a0, a1) => {   // centre of each box: its ring, in the middle of its slice
      const r = radius[level.get(n.id)], mid = (a0 + a1) / 2;
      at.set(n.id, { x: Math.cos(mid) * r, y: Math.sin(mid) * r });
      let from = a0;
      for (const k of kids.get(n.id)) { const span = (a1 - a0) * leaves(k) / leaves(n); place(k, from, from + span); from += span; }
    };
    place(hub, -Math.PI / 2, Math.PI * 1.5);
    const xs = [...at.values()].map(p => p.x), ys = [...at.values()].map(p => p.y), minX = Math.min(...xs), minY = Math.min(...ys);
    for (const [id, p] of at) pos.set(id, { x: p.x - minX + x0, y: p.y - minY });
    x0 += Math.max(...xs) - minX + NODE_W + COMP_GAP;
  }
  return pos;
}
/* by rack: a column per rack, devices top to bottom as they are mounted; the building feed above */
function rackArrange(G) {
  const pos = new Map(), colW = NODE_W + 140;
  doc.racks.forEach((r, i) => {
    const devs = [...G.nodes.values()].filter(n => n.rack === r).sort((p, q) => physOrder(p) - physOrder(q));
    devs.forEach((n, k) => pos.set(n.id, { x: i * colW, y: 140 + k * (NODE_H + 40) }));
  });
  if (G.nodes.has('#mains')) pos.set('#mains', { x: Math.max(0, (doc.racks.length - 1) * colW / 2), y: 0 });
  return pos;
}
function netArrange(G, style) {
  const { comps, loose } = netComponents(G);
  const pos = style === 'racks' ? rackArrange(G) : style === 'star' ? starArrange(G, comps) : layeredArrange(G, comps, style === 'lr');
  let looseY = null;
  if (style !== 'racks' && loose.length) {   // nothing connected: a grid below the rest
    const placed = [...pos.values()];
    const minX = placed.length ? Math.min(...placed.map(p => p.x)) : 0, maxX = placed.length ? Math.max(...placed.map(p => p.x)) + NODE_W : 0;
    looseY = placed.length ? Math.max(...placed.map(p => p.y)) + NODE_H + LOOSE_GAP : 0;
    const cols = Math.max(4, Math.floor((maxX - minX + COL_GAP) / (NODE_W + COL_GAP)));
    loose.forEach((n, i) => pos.set(n.id, { x: minX + (i % cols) * (NODE_W + COL_GAP), y: looseY + Math.floor(i / cols) * (NODE_H + COL_GAP) }));
  }
  for (const p of pos.values()) { p.x = snapTo(p.x); p.y = snapTo(p.y); }
  return { pos, looseY: looseY == null ? null : snapTo(looseY) };
}

/* ---------- positions ---------- */
const overlaps = (p, list) => list.some(q => p.x < q.x + NODE_W + 10 && q.x < p.x + NODE_W + 10 && p.y < q.y + NODE_H + 10 && q.y < p.y + NODE_H + 10);
/* moved boxes keep their place; a box with no place yet goes next to something it connects to, or below */
function netPlace(G) {
  const stored = doc.netPos?.[G.layer];
  if (!stored) {
    const A = netArrange(G, 'tree');
    for (const n of G.nodes.values()) Object.assign(n, A.pos.get(n.id));
    return { auto: true, looseY: A.looseY };
  }
  const placed = [], todo = [];
  for (const n of G.nodes.values()) {
    const p = stored[n.id];
    if (p) { n.x = p[0]; n.y = p[1]; placed.push(n); } else todo.push(n);
  }
  for (const n of todo.sort((p, q) => physOrder(p) - physOrder(q))) {
    const near = n.links.map(l => netOther(G, n, l)).find(o => placed.includes(o));
    const tries = [];
    if (near) for (let ring = 1; ring < 8; ring++) for (const dx of [0, 1, -1, 2, -2, 3, -3]) tries.push({ x: near.x + dx * (NODE_W + COL_GAP), y: near.y + ring * (NODE_H + 60) });
    const maxY = placed.length ? Math.max(...placed.map(q => q.y)) : -NODE_H, minX = placed.length ? Math.min(...placed.map(q => q.x)) : 0;
    for (let i = 0; i < 400; i++) tries.push({ x: minX + (i % 20) * (NODE_W + COL_GAP), y: maxY + NODE_H + LOOSE_GAP + Math.floor(i / 20) * (NODE_H + COL_GAP) });
    const spot = tries.find(t => !overlaps(t, placed)) || tries[tries.length - 1];
    n.x = snapTo(spot.x); n.y = snapTo(spot.y);
    placed.push(n);
  }
  return { auto: false };
}
function netBounds(G) {
  const all = [...G.nodes.values()];
  if (!all.length) return { x: 0, y: 0, w: 400, h: 200 };
  const x = Math.min(...all.map(n => n.x)) - 30, y = Math.min(...all.map(n => n.y)) - 40;
  return { x, y, w: Math.max(...all.map(n => n.x + NODE_W)) + 30 - x, h: Math.max(...all.map(n => n.y + NODE_H)) + 30 - y };
}

/* ---------- links ----------
   A link leaves each box from the side facing the other box (top / bottom when one is clearly above
   the other, else left / right); several links on one side spread along it. Round links are curves,
   angled ones run in straight lines with right-angle turns. */
const SIDE_N = { t: [0, -1], b: [0, 1], l: [-1, 0], r: [1, 0] };
function netLinkGeometry(G) {
  const geo = new Map(), ends = new Map(), flow = netFlow(G.layer);
  const hit = (x0, x1, y0, y1, A, B) => [...G.nodes.values()].some(o => o !== A && o !== B && o.x < x1 && o.x + NODE_W > x0 && o.y < y1 && o.y + NODE_H > y0);
  for (const l of G.links.values()) {
    const A = G.nodes.get(l.a), B = G.nodes.get(l.b);
    const dx = (B.x - A.x), dy = (B.y - A.y), gapX = Math.abs(dx) - NODE_W, gapY = Math.abs(dy) - NODE_H;
    // top-down diagrams join top and bottom whenever one box is clearly above the other; left-to-right ones join the sides
    const vertical = flow === 'h' ? gapX <= 20 : gapY > 20 || gapX <= 10;
    let sa = vertical ? (dy >= 0 ? 'b' : 't') : (dx >= 0 ? 'r' : 'l'), sb = { t: 'b', b: 't', l: 'r', r: 'l' }[sa], around = null;
    const [L, R] = dx >= 0 ? [A, B] : [B, A], [T, D] = dy >= 0 ? [A, B] : [B, A];
    // a box in the way: go round the row (under or over it) or the column (right or left of it) instead of through it
    if (!vertical && hit(L.x + NODE_W, R.x, Math.min(A.y, B.y) + NODE_H * 0.25, Math.max(A.y, B.y) + NODE_H * 0.75, A, B)) around = 'row';
    if (vertical && hit(Math.min(A.x, B.x) + NODE_W * 0.3, Math.max(A.x, B.x) + NODE_W * 0.7, T.y + NODE_H, D.y, A, B)) around = 'col';
    geo.set(l.id, { l, A, B, sa, sb, vertical, around });
  }
  /* which way round: each detour takes the side where it crosses the fewest detours already there
     (two cross when their stretches overlap without one holding the other), longest first */
  const sides = { row: [], col: [] };
  for (const g of geo.values()) if (g.around) {
    const c = g.around === 'row' ? [g.A.x, g.B.x] : [g.A.y, g.B.y];
    sides[g.around].push({ g, s0: Math.min(...c), s1: Math.max(...c) });
  }
  const interleave = (p, q) => (p.s0 < q.s0 && q.s0 < p.s1 && p.s1 < q.s1) || (q.s0 < p.s0 && p.s0 < q.s1 && q.s1 < p.s1);
  for (const [kind, list] of Object.entries(sides)) {
    const [one, two] = kind === 'row' ? ['under', 'over'] : ['right', 'left'], on = { [one]: [], [two]: [] };
    for (const d of list.sort((p, q) => (q.s1 - q.s0) - (p.s1 - p.s0))) {
      const pick = on[two].filter(o => interleave(o, d)).length < on[one].filter(o => interleave(o, d)).length ? two : one;
      on[pick].push(d);
      d.g.around = pick;
      d.g.sa = d.g.sb = { under: 'b', over: 't', right: 'r', left: 'l' }[pick];
    }
  }
  for (const g of geo.values()) for (const [N, s, O] of [[g.A, g.sa, g.B], [g.B, g.sb, g.A]]) {
    const k = N.id + s;
    (ends.get(k) || ends.set(k, []).get(k)).push({ g, end: N === g.A ? 'a' : 'b', o: s === 't' || s === 'b' ? O.x : O.y });
  }
  for (const [k, list] of ends) {
    const side = k.slice(-1), len = side === 't' || side === 'b' ? NODE_W * 0.7 : NODE_H * 0.6;
    list.sort((p, q) => p.o - q.o);
    const span = Math.min(len, (list.length - 1) * (side === 't' || side === 'b' ? 16 : 12));
    list.forEach((e, i) => (e.g['off' + e.end] = list.length > 1 ? -span / 2 + i * span / (list.length - 1) : 0));
  }
  const anchor = (N, s, off) => s === 't' ? [N.x + NODE_W / 2 + off, N.y] : s === 'b' ? [N.x + NODE_W / 2 + off, N.y + NODE_H]
    : s === 'l' ? [N.x, N.y + NODE_H / 2 + off] : [N.x + NODE_W, N.y + NODE_H / 2 + off];
  const angled = netSet().links === 'angled';
  for (const g of geo.values()) {
    [g.x1, g.y1] = anchor(g.A, g.sa, g.offa || 0);
    [g.x2, g.y2] = anchor(g.B, g.sb, g.offb || 0);
    g.ends = [[g.A, g.sa, g.x1, g.y1], [g.B, g.sb, g.x2, g.y2]];
  }
  netTracks(G, geo, angled);
  for (const g of geo.values()) {
    const { x1, y1, x2, y2, t } = g, [n1, n2] = [SIDE_N[g.sa], SIDE_N[g.sb]];
    // the run in the middle: across at height t (links joining top and bottom, or going round a row),
    // or along at x t (links joining the sides, or going round a column)
    const across = g.around === 'under' || g.around === 'over' || (!g.around && g.vertical);
    if (angled || g.around) {
      const pts = across ? [{ x: x1, y: y1 }, { x: x1, y: t }, { x: x2, y: t }, { x: x2, y: y2 }]
        : [{ x: x1, y: y1 }, { x: t, y: y1 }, { x: t, y: y2 }, { x: x2, y: y2 }];
      const bulge = t + (g.around === 'over' || g.around === 'left' ? -12 : 12);
      if (angled) g.d = roundedPath(pts, 6);
      else g.d = across ? `M${x1},${y1} C${x1},${bulge} ${x2},${bulge} ${x2},${y2}` : `M${x1},${y1} C${bulge},${y1} ${bulge},${y2} ${x2},${y2}`;
      g.mid = { x: (pts[1].x + pts[2].x) / 2, y: (pts[1].y + pts[2].y) / 2 };
    } else {
      const c = Math.max(30, (g.vertical ? Math.abs(y2 - y1) : Math.abs(x2 - x1)) / 2);
      const c1 = [x1 + n1[0] * c, y1 + n1[1] * c], c2 = [x2 + n2[0] * c, y2 + n2[1] * c];
      g.d = `M${x1},${y1} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${x2},${y2}`;
      g.mid = { x: (x1 + 3 * c1[0] + 3 * c2[0] + x2) / 8, y: (y1 + 3 * c1[1] + 3 * c2[1] + y2) / 8 };
    }
  }
  return geo;
}

/* Lanes for the middle runs, like the lanes of the 2D diagram: runs that share a gap and overlap get
   their own lane, TRACK apart and centred in the gap, in the order that crosses least. Detours under a
   row or beside a column stack outward, the shortest nearest the boxes. */
const TRACK = 12;
function netTracks(G, geo, angled) {
  const zs = { h: [], v: [] }, detours = { under: [], over: [], right: [], left: [] };
  for (const g of geo.values()) {
    if (g.around) {   // detours stack outward from the boxes they go round
      const across = g.around === 'under' || g.around === 'over', out = g.around === 'under' || g.around === 'right' ? 1 : -1;
      const along = across ? [g.x1, g.x2] : [g.y1, g.y2], from = across ? [g.y1, g.y2] : [g.x1, g.x2];
      detours[g.around].push({ g, out, s0: Math.min(...along), s1: Math.max(...along), base: (out > 0 ? Math.max(...from) : Math.min(...from)) + out * 20 });
      continue;
    }
    // a straight-through run: which end is on the near side of the gap (upper / left), and the gap itself
    const flip = g.vertical ? g.y1 > g.y2 : g.x1 > g.x2;
    const [n, f] = flip ? [[g.x2, g.y2], [g.x1, g.y1]] : [[g.x1, g.y1], [g.x2, g.y2]];
    const s = g.vertical ? { a1: n[0], a2: f[0], lo: n[1] + 14, hi: f[1] - 14 } : { a1: n[1], a2: f[1], lo: n[0] + 14, hi: f[0] - 14 };
    s.g = g;
    g.t = (s.lo + s.hi) / 2;   // alone: the middle of the gap
    if (angled) zs[g.vertical ? 'h' : 'v'].push(s);
  }
  for (const list of Object.values(zs)) for (const group of netOverlapGroups(list, (p, q) => p.lo < q.hi && q.lo < p.hi)) {
    if (group.length < 2) continue;
    const lo = Math.max(...group.map(s => s.lo)), hi = Math.min(...group.map(s => s.hi));
    if (hi - lo < 8) continue;   // no room the runs share: each stays in the middle of its own gap
    const sp = Math.min(TRACK, (hi - lo) / group.length), mid = (lo + hi) / 2;
    netTrackOrder(group).forEach((s, i, all) => (s.g.t = mid + (i - (all.length - 1) / 2) * sp));
  }
  for (const list of Object.values(detours)) {
    for (const d of list) { d.a1 = d.s0; d.a2 = d.s1; }
    for (const group of netOverlapGroups(list, (p, q) => Math.abs(p.base - q.base) < 60)) {
      const out = group[0].out, base = out > 0 ? Math.max(...group.map(d => d.base)) : Math.min(...group.map(d => d.base));
      group.sort((p, q) => (p.s1 - p.s0) - (q.s1 - q.s0)).forEach((d, i) => (d.g.t = base + out * (6 + i * TRACK)));
    }
  }
  /* last, across groups: lanes of different groups can share a gap (a detour over a row sits in the gap
     the links from the row above use). A run lying on another moves to the nearest free lane, inside its
     own gap; detours only further out. */
  if (!angled) return;
  const runs = [];
  for (const s of [...zs.h, ...zs.v]) runs.push({ g: s.g, o: zs.h.includes(s) ? 'h' : 'v', s0: Math.min(s.a1, s.a2), s1: Math.max(s.a1, s.a2), lo: s.lo, hi: s.hi });
  for (const [kind, list] of Object.entries(detours)) for (const d of list)
    runs.push({ g: d.g, o: kind === 'under' || kind === 'over' ? 'h' : 'v', s0: d.s0, s1: d.s1, lo: d.out > 0 ? d.g.t : -Infinity, hi: d.out > 0 ? Infinity : d.g.t, out: d.out });
  const placed = [], boxes = [...G.nodes.values()];
  const clash = (r, t) => placed.some(p => p.o === r.o && Math.abs(p.g.t - t) < TRACK - 1 && Math.min(p.s1, r.s1) - Math.max(p.s0, r.s0) > 6);
  /* would the link, with its run at t, pass through a box other than its own two? (run and both legs) */
  const segIn = (x0, y0, x1, y1, o) => o.x + 2 < Math.max(x0, x1) && Math.min(x0, x1) < o.x + NODE_W - 2 && o.y + 2 < Math.max(y0, y1) && Math.min(y0, y1) < o.y + NODE_H - 2;
  const blocked = (r, t) => {
    const { g } = r, pts = r.o === 'h' ? [[g.x1, g.y1], [g.x1, t], [g.x2, t], [g.x2, g.y2]] : [[g.x1, g.y1], [t, g.y1], [t, g.y2], [g.x2, g.y2]];
    return boxes.some(o => o !== g.A && o !== g.B && [0, 1, 2].some(i => segIn(...pts[i], ...pts[i + 1], o)));
  };
  for (const r of runs) {
    if (clash(r, r.g.t)) {
      for (let k = 1; k < 40; k++) {
        const t = r.out ? r.g.t + r.out * k * TRACK : r.g.t + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * TRACK;
        if (t < r.lo - 0.5 || t > r.hi + 0.5) { if (r.out) break; continue; }
        if (!clash(r, t) && !blocked(r, t)) { r.g.t = t; break; }   // otherwise it stays: touching beats cutting through a box
      }
    }
    placed.push(r);
  }
}
/* runs that overlap along their length (and pass `near`) end up in one group */
function netOverlapGroups(list, near) {
  const up = list.map((_, i) => i), find = i => (up[i] === i ? i : (up[i] = find(up[i])));
  const span = s => [Math.min(s.a1, s.a2), Math.max(s.a1, s.a2)];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const [a0, a1] = span(list[i]), [b0, b1] = span(list[j]);
    if (a0 < b1 + 2 && b0 < a1 + 2 && near(list[i], list[j])) up[find(i)] = find(j);
  }
  const groups = new Map();
  list.forEach((s, i) => (groups.get(find(i)) || groups.set(find(i), []).get(find(i))).push(s));
  return [...groups.values()];
}
/* lane order with the fewest crossings. With p's run nearer the near side than q's, they cross where
   q's near leg passes through p's run and where p's far leg passes through q's run. Each pair prefers
   its cheaper order; the order follows those preferences (any loop broken where it costs least). */
function netTrackOrder(group) {
  const inside = (x, s) => x > Math.min(s.a1, s.a2) + 0.5 && x < Math.max(s.a1, s.a2) - 0.5;
  const cost = (p, q) => inside(q.a1, p) + inside(p.a2, q);
  const n = group.length, after = group.map(() => new Set());   // after[j]: what has to come before j
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const c1 = cost(group[i], group[j]), c2 = cost(group[j], group[i]);
    if (c1 < c2) after[j].add(i); else if (c2 < c1) after[i].add(j);
  }
  const left = new Set(group.keys()), out = [];
  const key = i => Math.min(group[i].a1, group[i].a2);
  while (left.size) {
    let pick = null, best = Infinity;
    for (const i of left) {
      const waits = [...after[i]].filter(j => left.has(j)).length;
      if (waits < best || (waits === best && key(i) < key(pick))) { best = waits; pick = i; }
    }
    out.push(group[pick]);
    left.delete(pick);
  }
  return out;
}

/* ---------- drawing ---------- */
function netNodeSVG(n, G) {
  const box = (cls, inner, attrs = '') => `<g class="nn ${cls}" data-nnode="${esc(n.id)}"${attrs} transform="translate(${n.x},${n.y})">${inner}</g>`;
  if (n.mains) return box('mains', `<rect class="nn-box" width="${NODE_W}" height="${NODE_H}" rx="10"/>`
    + `<text class="nn-name" x="${NODE_W / 2}" y="27" text-anchor="middle">Building power</text><text class="nn-sub" x="${NODE_W / 2}" y="44" text-anchor="middle">where the power chain starts</text>`);
  const d = n.dev, cs = ui.conn?.devs[d.id], sel = isSel('device', d.id) || ui.multi.has(d.id);
  const chk = ui.check && cs?.level ? ' chk-' + cs.level : '';
  let sub;
  if (G.layer === 'power') {
    const src = ui.power.sources.find(s => s.dev.id === d.id);
    sub = src ? `load ${fmtW(src.normal)}${src.cap ? ' of ' + fmtW(src.cap) : ''}` : watts(d) ? `draws ${fmtW(watts(d))}` : T_(d).label;
  } else sub = [d.hostname || T_(d).label, d.ip].filter(Boolean).join(' · ');
  const loc = `${n.rack.name} · ${isZeroU(d) ? '0U ' + d.side : d.h > 1 ? `U${d.u}–${d.u + d.h - 1}` : 'U' + d.u}`;
  const lights = [['Power', cs?.power, cs?.pWhy], ['Data', cs?.data, cs?.dWhy]].filter(l => l[1] && l[1] !== 'na')
    .map(([w, st, why], i, all) => `<circle class="led led-${st}" cx="${NODE_W - 12 - (all.length - 1 - i) * 10}" cy="12" r="3.4"><title>${w}: ${esc(why)}</title></circle>`).join('');
  return box(`k-${T_(d).cat}${sel ? ' sel' : ''}${chk}${n.links.length ? '' : ' loose'}`,
    `<rect class="nn-box" width="${NODE_W}" height="${NODE_H}" rx="8"><title>${esc(`${d.name} · ${T_(d).label} · ${loc} · drag to move`)}</title></rect>`
    + `<rect class="nn-stripe" x="5" y="8" width="4" height="${NODE_H - 16}" rx="2"/>`
    + `<text class="nn-name" x="16" y="21">${esc(clip(d.name, 20))}</text>`
    + `<text class="nn-sub" x="16" y="37">${esc(clip(sub, 27))}</text>`
    + `<text class="nn-loc" x="16" y="51">${esc(clip(loc, 29))}</text>${lights}`,
    ` data-ndev="${d.id}"${d.color ? ` style="--c:${d.color}"` : ''}`);
}
function netLinkSVG(l, g, k) {
  if (l.feed) return `<g class="nl feed"><path class="nl-line" d="${g.d}"/></g>`;
  const c0 = l.cables[0].c, t = ctype(c0.type), n = l.cables.length;
  const sel = l.cables.some(x => isSel('cable', x.c.id)), near = isSel('device', l.a) || isSel('device', l.b);
  const ports = end => { const ks = l.cables.map(x => portShort(x[end])); return ks.length > 3 ? `${ks[0]}…${ks[ks.length - 1]}` : ks.join(', '); };
  let s = `<g class="nl${t.kind === 'power' ? ' power' : ''}${sel ? ' sel' : ''}" data-nlink="${esc(l.id)}">`
    + `<path class="nl-hit" d="${g.d}"/><path class="nl-line" style="stroke:${cableColor(c0)}" d="${g.d}"/>`
    + `<title>${esc(l.cables.map(x => `${cableLabel(x.c)} · ${ctype(x.c.type).name}`).join('\n'))}</title>`;
  if (n > 1) s += `<circle class="nl-count" cx="${g.mid.x}" cy="${g.mid.y}" r="9"/><text class="nl-count-t" x="${g.mid.x}" y="${g.mid.y}">${n}</text>`;
  if (k >= 0.8 || sel || near) {   // port names at both ends, once there is room to read them
    for (const [N, side, x, y] of g.ends) {
      const txt = esc(ports(N.id === l.a ? 'pa' : 'pb'));
      s += side === 't' ? `<text class="nl-port" x="${x + 5}" y="${y - 6}">${txt}</text>`
        : side === 'b' ? `<text class="nl-port" x="${x + 5}" y="${y + 12}">${txt}</text>`
        : `<text class="nl-port" x="${side === 'r' ? x + 6 : x - 6}" y="${y - 5}"${side === 'l' ? ' text-anchor="end"' : ''}>${txt}</text>`;
    }
  }
  return s + '</g>';
}
/* the grid lives outside the camera group, as a pattern that follows the camera */
function netGridSVG() {
  if (!netSet().grid) return '';
  const { x, y, k } = ui.net.cam, minor = GRID * k >= 7;
  return `<defs><pattern id="netGridMinor" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse" patternTransform="translate(${x},${y}) scale(${k})"><path class="net-grid" d="M${GRID} 0H0V${GRID}"/></pattern>`
    + `<pattern id="netGridMajor" width="${GRID * 5}" height="${GRID * 5}" patternUnits="userSpaceOnUse" patternTransform="translate(${x},${y}) scale(${k})"><path class="net-grid major" d="M${GRID * 5} 0H0V${GRID * 5}"/></pattern></defs>`
    + (minor ? '<rect class="net-grid-bg" width="100%" height="100%" fill="url(#netGridMinor)"/>' : '')
    + '<rect class="net-grid-bg" width="100%" height="100%" fill="url(#netGridMajor)"/>';
}
function renderNet() {
  const G = ui.net.G, P = ui.net.placed, k = ui.net.cam.k, geo = netLinkGeometry(G);
  let s = '<g class="nl-all">';
  for (const l of G.links.values()) s += netLinkSVG(l, geo.get(l.id), k);
  s += '</g><g class="nn-all">';
  for (const n of G.nodes.values()) s += netNodeSVG(n, G);
  s += '</g>';
  const loose = [...G.nodes.values()].filter(n => !n.links.length).length;
  if (P.auto && loose && P.looseY != null) s += `<text class="net-group" x="${Math.min(...[...G.nodes.values()].map(n => n.x))}" y="${P.looseY - 14}">${G.layer === 'power' ? 'No power cable' : 'No data connection'} · ${loose}</text>`;
  netSvg.innerHTML = netGridSVG() + `<g id="netCam" transform="translate(${ui.net.cam.x},${ui.net.cam.y}) scale(${k})">${s}</g>`;
  ui.net.drawnK = k;
}

/* ---------- view ---------- */
const netVisible = () => ui.pane === 'net' || ui.pane === 'split';
function drawNet() {
  if (!netVisible()) return;
  const G = netGraph(ui.net.layer);
  ui.net.G = G;
  ui.net.placed = netPlace(G);
  ui.net.bounds = netBounds(G);
  $('#netEmpty').hidden = G.nodes.size > 0;
  $('#netEmpty p').textContent = !doc.racks.length ? 'Add racks and equipment to see how they connect.'
    : ui.net.layer === 'power' ? 'No equipment with power ports yet.' : 'No equipment with data ports yet.';
  if (!ui.net.userMoved) fitNet(false);
  revealNetSel();
  renderNet();
  syncNetBar();
  const used = new Map();
  for (const l of G.links.values()) for (const x of l.cables) used.set(x.c.type, (used.get(x.c.type) || 0) + 1);
  $('#netLegend').hidden = !used.size;
  $('#netLegend').innerHTML = [...used].map(([id, n]) => { const t = ctype(id); return `<span><i class="sw line${t.kind === 'power' ? ' thick' : ''}" style="--c:${t.color}"></i>${esc(t.name)} <span class="muted">${n}</span></span>`; }).join('');
}
function syncNetBar() {
  const s = netSet();
  for (const b of document.querySelectorAll('#netLayerSeg button')) b.classList.toggle('on', b.dataset.layer === ui.net.layer);
  for (const b of document.querySelectorAll('#netLinkSeg button')) b.classList.toggle('on', b.dataset.links === s.links);
  $('#netGridBtn').setAttribute('aria-pressed', s.grid);
  $('#netSnapBtn').setAttribute('aria-pressed', s.grid && s.snap);
  $('#netSnapBtn').disabled = !s.grid;
  $('#netSnapBtn').title = s.grid ? `Snap boxes to the grid: ${s.snap ? 'on' : 'off'}` : 'Snap to the grid (turn the grid on first)';
  const auto = !doc.netPos?.[ui.net.layer];
  for (const b of document.querySelectorAll('#netArrangeMenu [data-arrange]')) b.classList.toggle('on', b.dataset.arrange === 'auto' && auto);
}
function netCamOnly() {   // pan: move the drawing and the grid, redraw only when the zoom changed (port labels depend on it)
  const cam = $('#netCam', netSvg);
  if (!cam || ui.net.cam.k !== ui.net.drawnK) return drawNet();
  const { x, y, k } = ui.net.cam;
  cam.setAttribute('transform', `translate(${x},${y}) scale(${k})`);
  for (const p of netSvg.querySelectorAll('pattern')) p.setAttribute('patternTransform', `translate(${x},${y}) scale(${k})`);
}
function fitNet(draw = true) {
  const r = netSvg.getBoundingClientRect(), b = ui.net.bounds;
  if (!r.width || !r.height || !b) return;
  const top = 56, bottom = 44;   // room for the bar and the legend
  const k = Math.min(1.25, Math.min(r.width / b.w, (r.height - top - bottom) / b.h) * 0.96);
  ui.net.cam = { k, x: (r.width - b.w * k) / 2 - b.x * k, y: top + (r.height - top - bottom - b.h * k) / 2 - b.y * k };
  ui.net.fitK = k; ui.net.userMoved = false;
  if (draw) drawNet();
}
function netZoomAt(mx, my, f) {
  const c = ui.net.cam, k2 = clamp(c.k * f, 0.15, 4);
  ui.net.cam = { k: k2, x: mx - (mx - c.x) * k2 / c.k, y: my - (my - c.y) * k2 / c.k };
  ui.net.userMoved = true;
  netCamOnly();
}
/* bring the selected device or cable into view when it was picked somewhere else */
function revealNetSel() {
  const s = ui.sel, key = s && s.kind + s.id, was = ui.net.lastSel;
  ui.net.lastSel = key;
  if (!s || key === was || !ui.net.userMoved) return;   // fitted: everything is on screen already
  const G = ui.net.G, n = s.kind === 'device' ? G?.nodes.get(s.id) : s.kind === 'cable' && G ? [...G.links.values()].find(l => l.cables.some(x => x.c.id === s.id)) : null;
  if (!n) return;
  const pt = n.x != null ? { x: n.x + NODE_W / 2, y: n.y + NODE_H / 2 } : (() => { const A = G.nodes.get(n.a), B = G.nodes.get(n.b); return { x: (A.x + B.x + NODE_W) / 2, y: (A.y + B.y + NODE_H) / 2 }; })();
  const r = netSvg.getBoundingClientRect(), c = ui.net.cam, sx = c.x + pt.x * c.k, sy = c.y + pt.y * c.k;
  if (sx < 60 || sx > r.width - 60 || sy < 70 || sy > r.height - 50) { c.x += r.width / 2 - sx; c.y += r.height / 2 - sy; }
}
/* the racks follow a selection made in the diagram (2D view: pan so it is on screen) */
function revealInRacks(kind, id) {
  if (ui.pane !== 'split' || ui.view !== '2d') return;
  const L = layout(), r = svg.getBoundingClientRect();
  let b;
  if (kind === 'device') { const f = findDev(id); if (!f) return; b = devRect(L, f.rack, f.dev); }
  else {
    const c = doc.cables.find(c => c.id === id), port = portMap(L), a = c && port(c.a, c.id, c.pa), e = c && port(c.b, c.id, c.pb);
    if (!a || !e) return;
    b = { x: Math.min(a.x, e.x), y: Math.min(a.y, e.y), w: Math.abs(a.x - e.x), h: Math.abs(a.y - e.y) };
  }
  const vx = ui.face === 'rear' ? L.w - b.x - b.w : b.x, k = ui.cam.k;
  const x0 = ui.cam.x + vx * k, x1 = x0 + b.w * k, y0 = ui.cam.y + b.y * k, y1 = y0 + b.h * k;
  if (x0 < 40 || x1 > r.width - 40 || y0 < 40 || y1 > r.height - 40) {
    ui.cam.x += r.width / 2 - (x0 + x1) / 2; ui.cam.y += r.height / 2 - (y0 + y1) / 2; ui.userMoved = true;
  }
}
/* which way the diagram reads: 'h' after "Left to right", else top-down */
const netFlow = layer => (doc.netPos?.[layer]?.['#flow'] === 'h' ? 'h' : 'v');
/* keep every box where it is now, in this layer */
function netFreeze() {
  const P = {}, flow = netFlow(ui.net.layer);
  for (const n of ui.net.G.nodes.values()) P[n.id] = [Math.round(n.x), Math.round(n.y)];
  if (flow === 'h') P['#flow'] = 'h';
  (doc.netPos ||= {})[ui.net.layer] = P;
}

/* ---------- interaction: drag a box to move it, drag empty space to pan, wheel or pinch to zoom, click to select ---------- */
const netTouch = new Map();
let netDrag = null, netPinch = null, netLastLink = { id: null, t: 0 };
netSvg.addEventListener('contextmenu', e => e.preventDefault());
netSvg.addEventListener('pointerdown', e => {
  netTouch.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { netSvg.setPointerCapture(e.pointerId); } catch (err) { /* gone */ }
  if (netTouch.size === 2) {
    const [a, b] = [...netTouch.values()], r = netSvg.getBoundingClientRect();
    netPinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, cam: { ...ui.net.cam } };
    netDrag = null;
    return;
  }
  if (e.button !== 0) { netDrag = { sx: e.clientX, sy: e.clientY, cx: ui.net.cam.x, cy: ui.net.cam.y, target: e.target, moved: false, pan: true }; return; }
  const node = e.target.closest?.('[data-nnode]');
  netDrag = { sx: e.clientX, sy: e.clientY, cx: ui.net.cam.x, cy: ui.net.cam.y, target: e.target, moved: false, node: node?.dataset.nnode };
});
netSvg.addEventListener('pointermove', e => {
  if (netTouch.has(e.pointerId)) netTouch.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (netPinch && netTouch.size === 2) {
    const [a, b] = [...netTouch.values()], p = netPinch, k2 = clamp(p.cam.k * (Math.hypot(a.x - b.x, a.y - b.y) || 1) / p.d, 0.15, 4);
    ui.net.cam = { k: k2, x: p.mx - (p.mx - p.cam.x) * k2 / p.cam.k, y: p.my - (p.my - p.cam.y) * k2 / p.cam.k };
    ui.net.userMoved = true;
    return netCamOnly();
  }
  const d = netDrag;
  if (!d) return;
  if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
  d.moved = true;
  ui.net.userMoved = true;   // the camera stays put while boxes move
  if (d.node && !d.pan) {
    /* move the box, or every selected box when it is one of them */
    if (!d.group) {
      const G = ui.net.G, ids = ui.multi.size > 1 && ui.multi.has(d.node) ? [...ui.multi].filter(id => G.nodes.has(id)) : [d.node];
      d.group = ids.map(id => { const n = G.nodes.get(id); return { n, x0: n.x, y0: n.y }; });
      netSvg.classList.add('moving');
    }
    const k = ui.net.cam.k, s = netSet(), lead = d.group.find(g => g.n.id === d.node) || d.group[0];
    let dx = (e.clientX - d.sx) / k, dy = (e.clientY - d.sy) / k;
    if (s.grid && s.snap) { dx = snapTo(lead.x0 + dx) - lead.x0; dy = snapTo(lead.y0 + dy) - lead.y0; }
    for (const g of d.group) { g.n.x = g.x0 + dx; g.n.y = g.y0 + dy; }
    return renderNet();
  }
  netSvg.classList.add('panning');
  ui.net.cam.x = d.cx + e.clientX - d.sx;
  ui.net.cam.y = d.cy + e.clientY - d.sy;
  netCamOnly();
});
function netPointerEnd(e) {
  netTouch.delete(e.pointerId);
  if (netPinch) { if (netTouch.size < 2) netPinch = null; netDrag = null; return; }
  const d = netDrag;
  netDrag = null;
  netSvg.classList.remove('panning', 'moving');
  if (!d || e.type === 'pointercancel') return d?.group && drawNet();
  if (d.group) {   // dropped: keep the new places (one undo step)
    const id = d.node;
    if (G_isDevice(id) && !ui.multi.has(id)) ui.sel = { kind: 'device', id };
    ui.net.lastSel = ui.sel && ui.sel.kind + ui.sel.id;
    return mutate(netFreeze);
  }
  if (d.moved || d.pan) return;
  const node = d.target.closest?.('[data-ndev]'), link = d.target.closest?.('[data-nlink]');
  if (node) {
    const id = node.dataset.ndev;
    if (e.shiftKey || e.ctrlKey || e.metaKey) return toggleMulti(id);
    ui.net.lastSel = 'device' + id;   // picked here: no need to pan the diagram
    revealInRacks('device', id);
    return select('device', id);
  }
  if (link) {   // a link with several cables: each click picks the next one (but not the second click of a double-click)
    const l = ui.net.G.links.get(link.dataset.nlink);
    if (!l?.cables.length) return;
    const again = netLastLink.id === l.id && e.timeStamp - netLastLink.t < 450;
    netLastLink = { id: l.id, t: e.timeStamp };
    const at = l.cables.findIndex(x => isSel('cable', x.c.id));
    if (again && at >= 0) return;
    const c = l.cables[(at + 1) % l.cables.length].c;
    ui.net.lastSel = 'cable' + c.id;
    revealInRacks('cable', c.id);
    return select('cable', c.id);
  }
  if (d.target.closest?.('[data-nnode]')) return;   // the building feed: nothing to select
  if (ui.sel || ui.multi.size) select(null);
}
const G_isDevice = id => !!ui.net.G?.nodes.get(id)?.dev;
netSvg.addEventListener('pointerup', netPointerEnd);
netSvg.addEventListener('pointercancel', netPointerEnd);
netSvg.addEventListener('wheel', e => {
  e.preventDefault();
  const r = netSvg.getBoundingClientRect();
  netZoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

/* ---------- the bar: layer, arrange, grid, snap, link style ---------- */
$('#netLayerSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-layer]');
  if (!b || b.dataset.layer === ui.net.layer) return;
  ui.net.layer = b.dataset.layer;
  try { localStorage.setItem('rackviz.netLayer', ui.net.layer); } catch (err) { /* ignore */ }
  ui.net.userMoved = false;
  drawNet();
});
const netSetting = (k, v) => { netSet()[k] = v; save(); drawNet(); };
$('#netGridBtn').addEventListener('click', () => netSetting('grid', !netSet().grid));
$('#netSnapBtn').addEventListener('click', () => netSetting('snap', !netSet().snap));
$('#netLinkSeg').addEventListener('click', e => { const b = e.target.closest('[data-links]'); if (b) netSetting('links', b.dataset.links); });
const arrangeBtn = $('#netArrangeBtn'), arrangeMenu = $('#netArrangeMenu');
arrangeMenu.innerHTML = Object.entries(ARRANGE).map(([k, a]) => `<button role="menuitem" data-arrange="${k}"><span class="grow"><span class="ci-main">${a.label}</span><span class="ci-sub">${a.hint}</span></span></button>`).join('')
  + '<hr><button role="menuitem" data-arrange="auto"><span class="grow"><span class="ci-main">Automatic</span><span class="ci-sub">Arranges itself again as cables change; forgets moved boxes</span></span></button>';
const showArrange = on => { arrangeMenu.hidden = !on; arrangeBtn.setAttribute('aria-expanded', on); };
arrangeBtn.addEventListener('click', e => { e.stopPropagation(); showArrange(arrangeMenu.hidden); });
document.addEventListener('click', e => { if (!arrangeMenu.hidden && !e.target.closest('#netArrangeWrap')) showArrange(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !arrangeMenu.hidden) { showArrange(false); arrangeBtn.focus(); } });
arrangeMenu.addEventListener('click', e => {
  const b = e.target.closest('[data-arrange]');
  if (!b) return;
  showArrange(false);
  const style = b.dataset.arrange, layer = ui.net.layer;
  ui.net.userMoved = false;   // fit the new arrangement
  if (style === 'auto') {
    if (!doc.netPos?.[layer]) return drawNet();
    return mutate(() => { delete doc.netPos[layer]; if (!Object.keys(doc.netPos).length) delete doc.netPos; });
  }
  const A = netArrange(netGraph(layer), style);
  mutate(() => {
    const P = Object.fromEntries([...A.pos].map(([id, p]) => [id, [p.x, p.y]]));
    if (style === 'lr') P['#flow'] = 'h';
    (doc.netPos ||= {})[layer] = P;
  });
  toast(`Arranged as ${ARRANGE[style].label.toLowerCase()}. Drag boxes to adjust; Undo puts it back`);
});
const netCenterZoom = f => { const r = netSvg.getBoundingClientRect(); netZoomAt(r.width / 2, r.height / 2, f); };
$('#netZoomIn').addEventListener('click', () => netCenterZoom(1.25));
$('#netZoomOut').addEventListener('click', () => netCenterZoom(0.8));
$('#netFit').addEventListener('click', () => fitNet());
new ResizeObserver(() => { if (!netVisible()) return; if (!ui.net.userMoved) fitNet(); else drawNet(); }).observe(netPane);
