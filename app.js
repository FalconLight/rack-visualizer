'use strict';

/* ================= constants ================= */
const U_MM = 44.45, IN_MM = 25.4;
const PANEL_W = 482.6;                    // 19" front panel width
const BODY_W = 440;                       // typical chassis width
const FRAME_TOP = 60, FRAME_BOT = 80;     // rack structure above / below the rails
const RAIL_INSET = 60;                    // rails distance from front / rear of the rack
const STORE_KEY = 'rackviz.v1';
const UNIT_MM = { mm: 1, cm: 10, in: IN_MM };

const TYPES = {
  patch:    { label: 'Patch panel',     h: 1, d: 120, cat: 'passive', p: 24 },
  fiber:    { label: 'Fiber enclosure', h: 1, d: 250, cat: 'passive', p: 24 },
  manager:  { label: 'Cable manager',   h: 1, d: 80,  cat: 'passive' },
  switch:   { label: 'Switch',          h: 1, d: 300, cat: 'net', p: 24, ul: 4, ut: 'sfp+' },
  router:   { label: 'Router',          h: 1, d: 400, cat: 'net', p: 8, ul: 2, ut: 'sfp+' },
  firewall: { label: 'Firewall',        h: 1, d: 400, cat: 'net', p: 8, ul: 2, ut: 'sfp' },
  server:   { label: 'Server',          h: 2, d: 700, cat: 'compute', p: 4, ul: 2, ut: 'sfp+' },
  storage:  { label: 'Storage',         h: 2, d: 700, cat: 'compute', p: 4, ul: 2, ut: 'sfp+' },
  shelf:    { label: 'Shelf',           h: 1, d: 450, cat: 'other' },
  pdu:      { label: 'PDU',             h: 1, d: 200, cat: 'power' },
  ups:      { label: 'UPS',             h: 2, d: 600, cat: 'power' },
  blank:    { label: 'Blank panel',     h: 1, d: 20,  cat: 'passive' },
  custom:   { label: 'Custom',          h: 1, d: 300, cat: 'other', p: 0, ul: 0, ut: 'rj45' },
};
const UPLINK_TYPES = {
  rj45: 'RJ45 1G', 'rj45-10g': 'RJ45 10G', sfp: 'SFP 1G', 'sfp+': 'SFP+ 10G',
  sfp28: 'SFP28 25G', 'qsfp+': 'QSFP+ 40G', qsfp28: 'QSFP28 100G',
};
const DEFAULT_CABLE_TYPES = [
  { id: 'utp', name: 'UTP', color: '#2f6fdf' },
  { id: 'fiber', name: 'Fiber', color: '#e09a12' },
  { id: 'coax', name: 'Coax', color: '#8a8a8a' },
];
const CATS = [['net', 'Network'], ['passive', 'Passive'], ['compute', 'Compute'], ['power', 'Power'], ['other', 'Other']];
const NEW_TYPE_COLORS = ['#16a34a', '#db2777', '#7c3aed', '#0891b2', '#dc2626', '#65a30d', '#ea580c'];
const RACK_PRESETS = [
  { label: '42U floor · 600 × 1000 mm', units: 42, width: 600, depth: 1000 },
  { label: '47U floor · 800 × 1200 mm', units: 47, width: 800, depth: 1200 },
  { label: '24U floor · 600 × 800 mm',  units: 24, width: 600, depth: 800 },
  { label: '12U wall · 600 × 450 mm',   units: 12, width: 600, depth: 450 },
  { label: '9U wall · 600 × 450 mm',    units: 9,  width: 600, depth: 450 },
  { label: '6U wall · 550 × 350 mm',    units: 6,  width: 550, depth: 350 },
  { label: 'Custom',                    units: 20, width: 600, depth: 600 },
];

/* ================= utils ================= */
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 2) => String(+(+v).toFixed(d));
const toDisp = (mm, u = ui.unit) => +(mm / UNIT_MM[u]).toFixed(u === 'mm' ? 0 : 2);
const fromDisp = (v, u = ui.unit) => v * UNIT_MM[u];
const fmt = (mm, u = ui.unit) => (u === 'mm' ? Math.round(mm / UNIT_MM[u]) : (mm / UNIT_MM[u]).toFixed(u === 'cm' ? 1 : 2)) + ' ' + u;
const fmtU = mm => num(mm / U_MM) + ' U';
const fmtLong = mm => mm >= 1000 && ui.unit !== 'in' ? (mm / 1000).toFixed(2) + ' m'
  : ui.unit === 'in' && mm > 12 * IN_MM ? (mm / 304.8).toFixed(1) + ' ft' : fmt(mm);
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ================= document model ================= */
function blankDoc() { return normalize({ racks: [], cables: [] }); }
function makeRack(o = {}) {
  return { id: uid(), name: o.name || 'Rack', units: o.units || 42, width: o.width || 600, depth: o.depth || 1000, devices: [] };
}
function makeDev(type, o = {}) {
  const t = TYPES[type];
  return { id: uid(), type, name: o.name || t.label, h: o.h || t.h, u: o.u || 1, depth: o.depth || t.d, mount: o.mount || 'front',
    ports: o.ports ?? t.p, uplinks: o.uplinks ?? t.ul, uplinkType: o.uplinkType ?? t.ut };
}
function demoDoc() {
  const d = blankDoc();
  const put = (r, type, u, o = {}) => { const v = makeDev(type, { u, ...o }); r.devices.push(v); return v; };
  const a = makeRack({ name: 'Rack A', units: 42 });
  const fo = put(a, 'fiber', 42);
  const p1 = put(a, 'patch', 41, { name: 'Patch panel 1' });
  put(a, 'manager', 40);
  const s1 = put(a, 'switch', 39, { name: 'Core switch', ports: 48 });
  const p2 = put(a, 'patch', 38, { name: 'Patch panel 2' });
  put(a, 'manager', 37);
  const s2 = put(a, 'switch', 36, { name: 'Access switch' });
  const fw = put(a, 'firewall', 34);
  put(a, 'server', 20, { name: 'Server 1' });
  put(a, 'server', 18, { name: 'Server 2' });
  put(a, 'ups', 2);
  put(a, 'pdu', 1, { mount: 'rear' });
  const b = makeRack({ name: 'Rack B', units: 24, depth: 800 });
  const p3 = put(b, 'patch', 24, { name: 'Coax panel' });
  put(b, 'manager', 23);
  const s3 = put(b, 'switch', 22, { name: 'Edge switch' });
  const m = put(b, 'router', 20, { name: 'Cable modem' });
  put(b, 'shelf', 15, { h: 2 });
  d.racks.push(a, b);
  const cab = (type, x, y, pa = '', pb = '') => ({ id: uid(), type, a: x.id, b: y.id, pa, pb, label: '' });
  d.cables.push(cab('utp', p1, s1, 'p1', 'p1'), cab('utp', p1, s1, 'p2', 'p2'), cab('utp', p2, s2, 'p1', 'p1'),
    cab('fiber', fo, s1, 'p1', 'u1'), cab('fiber', s1, s3, 'u2', 'u1'), cab('coax', p3, m), cab('utp', m, fw, 'p1', 'p1'));
  return d;
}
function validDoc(d) { return d && Array.isArray(d.racks) && Array.isArray(d.cables); }
function normalize(d) {
  d.settings = { unit: 'cm', gap: 300, route: 'curve', catColors: {}, ...(d.settings || {}) };
  if (!Array.isArray(d.settings.cableTypes) || !d.settings.cableTypes.length)
    d.settings.cableTypes = DEFAULT_CABLE_TYPES.map(t => ({ ...t }));
  return d;
}
function load() {
  try { const s = localStorage.getItem(STORE_KEY); if (s) { const d = JSON.parse(s); if (validDoc(d)) return normalize(d); } } catch (e) { /* ignore */ }
  return null;
}
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(doc)); } catch (e) { /* ignore */ } }

let doc = load() || demoDoc();
const ui = {
  view: '2d', mode: 'select', cableType: 'utp', sel: null, lastRack: null,
  pending: null, drag: null, pan: null, measure: null, hover: null,
  cam: { x: 0, y: 0, k: 0.3 }, userMoved: false,
  get unit() { return doc.settings.unit; },
};

const undoStack = [], redoStack = [];
function mutate(fn) {
  undoStack.push(JSON.stringify(doc));
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  fn();
  save();
  renderAll();
}
function undo() {
  const s = undoStack.pop();
  if (!s) return toast('Nothing to undo');
  redoStack.push(JSON.stringify(doc));
  doc = JSON.parse(s);
  save();
  renderAll();
}
function redo() {
  const s = redoStack.pop();
  if (!s) return toast('Nothing to redo');
  undoStack.push(JSON.stringify(doc));
  doc = JSON.parse(s);
  save();
  renderAll();
}

/* ================= geometry ================= */
const rackH = r => r.units * U_MM + FRAME_TOP + FRAME_BOT;
const usableDepth = r => r.depth - 2 * RAIL_INSET;

function layout() {
  const gap = doc.settings.gap;
  const H = doc.racks.length ? Math.max(...doc.racks.map(rackH)) : 2000;
  const racks = {};
  let x = 0;
  for (const r of doc.racks) {
    const h = rackH(r);
    racks[r.id] = {
      x, w: r.width, h, top: H - h, bottom: H,
      railBottom: H - FRAME_BOT, railTop: H - FRAME_BOT - r.units * U_MM,
      px: x + (r.width - PANEL_W) / 2,
    };
    x += r.width + gap;
  }
  return { racks, w: Math.max(0, x - gap), h: H };
}
function devRect(L, rack, d) {
  const R = L.racks[rack.id];
  return { x: R.px, y: R.railBottom - (d.u + d.h - 1) * U_MM, w: PANEL_W, h: d.h * U_MM };
}
function findDev(id) {
  for (const rack of doc.racks) { const dev = rack.devices.find(d => d.id === id); if (dev) return { rack, dev }; }
  return null;
}
function conflict(rack, d) {
  if (d.h < 1) return 'Height must be at least 1U';
  if (d.u < 1 || d.u + d.h - 1 > rack.units) return `Doesn't fit inside ${rack.name} (${rack.units}U)`;
  for (const o of rack.devices) {
    if (o.id === d.id) continue;
    const overlap = d.u <= o.u + o.h - 1 && o.u <= d.u + d.h - 1;
    if (overlap && (o.mount === d.mount || d.depth + o.depth > usableDepth(rack))) return `Overlaps “${o.name}”`;
  }
  return null;
}
function freeSlot(rack, d) {
  for (let u = rack.units - d.h + 1; u >= 1; u--) if (!conflict(rack, { ...d, u })) return u;
  return 0;
}
function occupied(rack) {
  const s = new Set();
  rack.devices.forEach(d => { for (let i = 0; i < d.h; i++) s.add(d.u + i); });
  return s;
}
function usedU(rack) { return [...occupied(rack)].filter(u => u >= 1 && u <= rack.units).length; }
function largestFree(rack) {
  const occ = occupied(rack); let best = 0, cur = 0;
  for (let u = 1; u <= rack.units; u++) { if (occ.has(u)) cur = 0; else best = Math.max(best, ++cur); }
  return best;
}
function devWarn(rack, d) {
  return conflict(rack, d) || (d.depth > usableDepth(rack) ? `Deeper than the rack's usable depth (${fmt(usableDepth(rack))})` : null);
}

/* ports: every cable end plugs into a port */
function portMap(L) {
  const cache = {};
  return (devId, cabId, key) => {
    const f = findDev(devId); if (!f) return null;
    const base = { mount: f.dev.mount, rack: f.rack, dev: f.dev };
    const p = (cache[devId] ??= portLayout(L, f.rack, f.dev) || []).find(p => p.key === key);
    if (p) return { ...base, x: p.x + p.w / 2, y: p.y + p.h / 2 };
    const r = devRect(L, f.rack, f.dev);
    return { ...base, x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };
}
function cableCurve(a, b) {
  const sag = 50 + Math.min(450, Math.abs(a.x - b.x) * 0.12 + Math.abs(a.y - b.y) * 0.12);
  return [a, { x: a.x, y: a.y + sag }, { x: b.x, y: b.y + sag }, b];
}
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
function cableLengths(L = layout()) {
  const port = portMap(L), routes = doc.settings.route === 'ortho' ? diagramRoutes(L, port) : null, out = {};
  for (const c of doc.cables) {
    const a = port(c.a, c.id, c.pa), b = port(c.b, c.id, c.pb);
    if (!a || !b) continue;
    let len = routes ? polyLen(routes[c.id]) : bezLen(cableCurve(a, b));
    if (a.mount !== b.mount) len += Math.max(a.rack.depth, b.rack.depth);
    out[c.id] = len * 1.1; // 10 % slack
  }
  return out;
}

/* Diagram routing: every cable gets its own horizontal track inside each device it touches,
   its own vertical lane beside the rack, and (between racks) its own overhead track. */
const LANE = 8;
function diagramRoutes(L, port) {
  const items = [], idx = {}, routes = {};
  doc.racks.forEach((r, i) => (idx[r.id] = i));
  for (const c of doc.cables) {
    const a = port(c.a, c.id, c.pa), b = port(c.b, c.id, c.pb);
    if (a && b) items.push({ c, a, b });
  }
  // which side of the rack each end leaves from
  for (const it of items) {
    const ra = it.a.rack, rb = it.b.rack, right = idx[rb.id] > idx[ra.id];
    it.sideA = ra === rb || right ? 'R' : 'L';
    it.sideB = ra === rb || !right ? 'R' : 'L';
  }
  // horizontal tracks run in the free band above (top-row ports) or below (other ports) the port grid,
  // ordered so the port farthest from the lane gets the outermost track and stubs never cross tracks
  const bands = {};
  for (const it of items) for (const e of ['a', 'b']) {
    const P = it[e], b = devRect(L, P.rack, P.dev), pl = portLayout(L, P.rack, P.dev) || [];
    const pr = pl.find(q => q.key === it.c['p' + e]);
    const pTop = Math.min(...pl.map(q => q.y)), pBot = Math.max(...pl.map(q => q.y + q.h));
    const up = pr && pr.y + pr.h / 2 < b.y + b.h / 2 - 1;
    const band = up ? [b.y + 2, pTop - 2] : [pr ? pBot + 2 : b.y + 2, b.y + b.h - 2];
    (bands[P.dev.id + (up ? 'T' : 'B')] ||= { up, band, list: [] }).list.push({ it, e, x: P.x, dir: it['side' + e.toUpperCase()] === 'R' ? 1 : -1 });
  }
  for (const { up, band: [y0, y1], list } of Object.values(bands)) {
    list.sort((p, q) => p.x * p.dir - q.x * q.dir);
    const step = (y1 - y0) / list.length;
    list.forEach((l, k) => (l.it[l.e + 'y'] = up ? y0 + (k + 0.5) * step : y1 - (k + 0.5) * step));
  }
  const top = Math.min(...Object.values(L.racks).map(R => R.top)) - 75;
  const lanes = {}, over = [];
  for (const it of items) {
    const ra = it.a.rack, rb = it.b.rack;
    if (ra === rb) {
      (lanes[ra.id + 'R'] ||= []).push({ it, end: 'ab', span: Math.abs(it.ay - it.by) });
    } else {
      (lanes[ra.id + it.sideA] ||= []).push({ it, end: 'a', span: it.ay - top });
      (lanes[rb.id + it.sideB] ||= []).push({ it, end: 'b', span: it.by - top });
      over.push(it);
    }
  }
  for (const [key, list] of Object.entries(lanes)) {
    const R = L.racks[key.slice(0, -1)], side = key.slice(-1);
    list.sort((p, q) => p.span - q.span);
    list.forEach((l, k) => {
      const x = side === 'R' ? R.px + PANEL_W + 12 + k * LANE : R.px - 44 - k * LANE;
      if (l.end.includes('a')) l.it.lxA = x;
      if (l.end.includes('b')) l.it.lxB = x;
    });
  }
  over.sort((p, q) => Math.abs(p.lxA - p.lxB) - Math.abs(q.lxA - q.lxB));
  over.forEach((it, k) => (it.oy = top - k * LANE));
  for (const it of items) {
    const { a, b } = it;
    routes[it.c.id] = it.oy == null
      ? [a, { x: a.x, y: it.ay }, { x: it.lxA, y: it.ay }, { x: it.lxA, y: it.by }, { x: b.x, y: it.by }, b]
      : [a, { x: a.x, y: it.ay }, { x: it.lxA, y: it.ay }, { x: it.lxA, y: it.oy }, { x: it.lxB, y: it.oy },
         { x: it.lxB, y: it.by }, { x: b.x, y: it.by }, b];
  }
  return routes;
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

/* colors */
const ctype = id => doc.settings.cableTypes.find(t => t.id === id) || { id, name: id, color: '#888888' };
const cableColor = c => c.color || ctype(c.type).color;
const devColor = d => d.color || cssVar('--k-' + (TYPES[d.type] || TYPES.custom).cat);
function applyCatColors() {
  const st = document.documentElement.style;
  for (const [k] of CATS) {
    const v = doc.settings.catColors?.[k];
    if (v) st.setProperty('--k-' + k, v); else st.removeProperty('--k-' + k);
  }
}

/* ports */
const hasPorts = d => TYPES[d.type]?.p != null;
const hasUplinks = d => TYPES[d.type]?.ul != null;
const nPorts = d => hasPorts(d) ? (d.ports ?? TYPES[d.type].p) : 0;
const nUplinks = d => hasUplinks(d) ? (d.uplinks ?? TYPES[d.type].ul) : 0;
const upType = d => d.uplinkType ?? TYPES[d.type].ut ?? 'sfp+';
const validPort = (d, k) => k[0] === 'p' ? +k.slice(1) <= nPorts(d) : +k.slice(1) <= nUplinks(d);
const fmtPort = k => !k ? '' : k[0] === 'p' ? ' #' + k.slice(1) : ' UL' + k.slice(1);
const clip = (t, n) => t.length > n ? t.slice(0, n - 1) + '…' : t;

const PORT = 12, PITCH = 14, PORTS_X = 92, PORTS_PAD = 8;  // mm: port square, spacing, start, right margin
function portGrid(d) {
  const n = nPorts(d), m = nUplinks(d), maxRows = d.h * 2;
  const ur = Math.min(maxRows, m > 2 ? 2 : 1), upCols = m ? Math.ceil(m / ur) : 0;
  const avail = PANEL_W - PORTS_X - PORTS_PAD - (upCols ? upCols * PITCH + 10 : 0);
  const maxCols = Math.max(0, Math.floor((avail + PITCH - PORT) / PITCH));
  const rows = n ? Math.min(maxRows, Math.ceil(n / Math.max(1, maxCols))) : 0;
  return { n, m, ur, upCols, rows, max: maxCols * maxRows, fits: n <= maxCols * maxRows };
}
function portLayout(L, rack, d) {
  const g = portGrid(d);
  if (!g.n && !g.m) return null;
  const b = devRect(L, rack, d), pts = [];
  const top = rows => b.y + (b.h - (rows * PITCH - (PITCH - PORT))) / 2;
  const py = top(g.rows), x0 = b.x + PORTS_X;
  for (let i = 0; i < g.n; i++) {
    const col = Math.floor(i / g.rows), row = i % g.rows;
    pts.push({ key: 'p' + (i + 1), x: x0 + col * PITCH, y: py + row * PITCH, w: PORT, h: PORT });
  }
  const uy = top(g.ur), ux0 = b.x + b.w - PORTS_PAD - g.upCols * PITCH + (PITCH - PORT);
  for (let j = 0; j < g.m; j++) {
    const col = Math.floor(j / g.ur), row = j % g.ur;
    pts.push({ key: 'u' + (j + 1), up: true, x: ux0 + col * PITCH, y: uy + row * PITCH, w: PORT, h: PORT });
  }
  return pts;
}
function portUse() {
  const m = {};
  for (const c of doc.cables) {
    if (c.pa) (m[c.a] ||= {})[c.pa] = c;
    if (c.pb) (m[c.b] ||= {})[c.pb] = c;
  }
  return m;
}
function firstFree(d, used = {}) {
  for (let i = 1; i <= nPorts(d); i++) if (!used['p' + i]) return 'p' + i;
  for (let j = 1; j <= nUplinks(d); j++) if (!used['u' + j]) return 'u' + j;
  return '';
}
/* older layouts had cables without ports: plug them into free ports, drop the ones that can't fit */
function ensurePorts() {
  const use = portUse();
  doc.cables = doc.cables.filter(c => {
    for (const [end, key] of [['a', 'pa'], ['b', 'pb']]) {
      const f = findDev(c[end]); if (!f) return false;
      const used = use[c[end]] ||= {};
      if (c[key] && validPort(f.dev, c[key]) && used[c[key]] === c) continue;
      const k = firstFree(f.dev, used);
      if (!k) return false;
      c[key] = k; used[k] = c;
    }
    return true;
  });
}
function portOptions(devId, sel, cabId) {
  const f = findDev(devId); if (!f) return '';
  const use = portUse()[devId] || {}, d = f.dev;
  const opt = (k, label) => {
    const busy = use[k] && use[k].id !== cabId;
    return `<option value="${k}"${k === (sel || '') ? ' selected' : ''}${busy ? ' disabled' : ''}>${label}${busy ? ' · in use' : ''}</option>`;
  };
  let h = '';
  for (let i = 1; i <= nPorts(d); i++) h += opt('p' + i, 'Port ' + i);
  for (let j = 1; j <= nUplinks(d); j++) h += opt('u' + j, `Uplink ${j} · ${UPLINK_TYPES[upType(d)]}`);
  return h;
}
function nearestFree(rack, d, u0, maxDist = rack.units) {
  for (let k = 0; k <= maxDist; k++)
    for (const u of k ? [u0 + k, u0 - k] : [u0]) if (u >= 1 && !conflict(rack, { ...d, u })) return u;
  return 0;
}

/* ================= DOM refs ================= */
const svg = $('#svg'), threeEl = $('#three'), stage = $('#stage'), hudEl = $('#hud'), toastEl = $('#toast');
const propsEl = $('#props'), rackListEl = $('#rackList'), cableListEl = $('#cableList');

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (toastEl.hidden = true), 2400);
}

/* ================= selection & actions ================= */
const isSel = (kind, id) => ui.sel && ui.sel.kind === kind && ui.sel.id === id;
function select(kind, id) {
  ui.sel = kind ? { kind, id } : null;
  if (kind === 'rack') ui.lastRack = id;
  if (kind === 'device') ui.lastRack = findDev(id)?.rack.id;
  renderAll();
}
function targetRack() {
  return doc.racks.find(r => r.id === ui.lastRack) || doc.racks[0] || null;
}
function addDevice(type, rack = targetRack(), u = null) {
  if (!rack) return toast('Add a rack first');
  const d = makeDev(type);
  if (u == null) {
    d.u = freeSlot(rack, d);
    if (!d.u) return toast(`No free ${d.h}U space in ${rack.name}`);
  } else {
    d.u = u;
    const err = conflict(rack, d);
    if (err) return toast(err);
  }
  ui.sel = { kind: 'device', id: d.id }; ui.lastRack = rack.id;
  mutate(() => rack.devices.push(d));
}
function moveDev(id, rackId, u) {
  const f = findDev(id), to = doc.racks.find(r => r.id === rackId);
  if (!f || !to || (f.rack === to && f.dev.u === u)) return;
  mutate(() => {
    f.rack.devices.splice(f.rack.devices.indexOf(f.dev), 1);
    f.dev.u = u;
    to.devices.push(f.dev);
  });
  ui.lastRack = rackId;
}
function connectClick(id, port = '') {
  const dv = findDev(id).dev;
  if (!port) return toast(nPorts(dv) + nUplinks(dv) ? 'Click on a port' : `“${dv.name}” has no ports. Set a port count first`);
  if (port && portUse()[id]?.[port]) return toast(`${fmtPort(port).trim()} on “${findDev(id).dev.name}” is already in use`);
  if (!ui.pending) { ui.pending = id; ui.pendingPort = port; }
  else if (ui.pending === id) {
    if (ui.pendingPort === port) ui.pending = null;
    else return toast('Pick a port on a different device');
  } else {
    const c = { id: uid(), type: ui.cableType, a: ui.pending, b: id, pa: ui.pendingPort, pb: port, label: '' };
    ui.pending = null;
    ui.sel = { kind: 'cable', id: c.id };
    mutate(() => doc.cables.push(c));
    return;
  }
  renderAll();
}
function shiftDev(id, dir) {
  const { rack, dev } = findDev(id);
  for (let u = dev.u + dir; u >= 1 && u + dev.h - 1 <= rack.units; u += dir)
    if (!conflict(rack, { ...dev, u })) return mutate(() => (dev.u = u));
  toast(dir > 0 ? 'No free space above' : 'No free space below');
}
let armTimer;
function arm(id) { ui.armed = id; clearTimeout(armTimer); armTimer = setTimeout(() => (ui.armed = null), 3000); }
function deleteSel(force = false) {
  const s = ui.sel; if (!s) return;
  if (s.kind === 'device') {
    const f = findDev(s.id); if (!f) return;
    mutate(() => {
      f.rack.devices.splice(f.rack.devices.indexOf(f.dev), 1);
      doc.cables = doc.cables.filter(c => c.a !== s.id && c.b !== s.id);
    });
  } else if (s.kind === 'rack') {
    const r = doc.racks.find(r => r.id === s.id); if (!r) return;
    if (r.devices.length && !force && ui.armed !== r.id) { arm(r.id); return toast(`Press Delete again to remove ${r.name} and its ${r.devices.length} device(s)`); }
    const ids = new Set(r.devices.map(d => d.id));
    mutate(() => {
      doc.racks.splice(doc.racks.indexOf(r), 1);
      doc.cables = doc.cables.filter(c => !ids.has(c.a) && !ids.has(c.b));
    });
  } else if (s.kind === 'cable') {
    mutate(() => (doc.cables = doc.cables.filter(c => c.id !== s.id)));
  }
  ui.sel = null; renderAll();
}
function setMode(m) {
  ui.mode = m; ui.pending = null;
  if (m !== 'measure') ui.measure = null;
  stage.dataset.mode = m;
  for (const b of document.querySelectorAll('#modeSeg button')) b.classList.toggle('on', b.dataset.mode === m);
  $('#cableTypeWrap').hidden = m !== 'connect';
  renderStage();
}
function setView(v) {
  ui.view = v;
  svg.toggleAttribute('hidden', v !== '2d');
  threeEl.hidden = v !== '3d';
  for (const b of document.querySelectorAll('#viewSeg button')) b.classList.toggle('on', b.dataset.view === v);
  $('#routeSeg').hidden = v !== '2d';
  $('#zoomLbl').hidden = v !== '2d';
  if (v === '3d' && init3D()) { resize3D(); build3D(); if (!T.framed) { frame3D(); T.framed = true; } }
  renderStage();
}

/* ================= 2D view ================= */
function toWorld(e) {
  const r = svg.getBoundingClientRect();
  return { x: (e.clientX - r.left - ui.cam.x) / ui.cam.k, y: (e.clientY - r.top - ui.cam.y) / ui.cam.k };
}
function fit() {
  const L = layout(), r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return;
  // margins for the ruler labels, the legend and the zoom controls are in screen pixels,
  // so they depend on the scale: iterate a few times to settle it
  const top = Math.min(...Object.values(L.racks).map(R => R.top), L.h) - (doc.settings.route === 'ortho' ? 110 + doc.cables.length * LANE : 90);
  const x1 = Math.max(L.w, 600) + 60;
  let k = 0.2, x0 = -260, y0 = top, y1 = L.h + 80;
  for (let i = 0; i < 3; i++) {
    x0 = -130 - 70 / k;
    y0 = top - (doc.cables.length ? 44 / k : 0);
    y1 = L.h + 30 + 44 / k;
    k = Math.min(r.width / (x1 - x0), r.height / (y1 - y0)) * 0.96;
  }
  ui.cam = { k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k };
  ui.fitK = k;
  ui.userMoved = false;
}
function rackAtX(L, x, nearest) {
  let best = null, bd = Infinity;
  for (const r of doc.racks) {
    const R = L.racks[r.id];
    if (x >= R.x && x <= R.x + r.width) return r;
    const d = Math.abs(x - (R.x + r.width / 2));
    if (d < bd) { bd = d; best = r; }
  }
  return nearest ? best : null;
}
function uFromTop(R, rack, topY, h) {
  return clamp(Math.round((R.railBottom - topY) / U_MM - h) + 1, 1, Math.max(1, rack.units - h + 1));
}

function rulerSVG(L) {
  const k = ui.cam.k, u = ui.unit, x = -120, H = L.h;
  const minor = u === 'in' ? IN_MM : 10, perMid = u === 'in' ? 6 : 5, perMajor = u === 'in' ? 12 : 10;
  const showMinor = minor * k > 3, showMid = minor * perMid * k > 4;
  const n = Math.ceil(H / minor);
  const fs = 11 / k;
  let s = `<g class="ruler"><line x1="${x}" x2="${x}" y1="${H}" y2="${H - n * minor}"/>`;
  for (let i = 0; i <= n; i++) {
    const major = i % perMajor === 0, mid = i % perMid === 0;
    if (!major && !(mid && showMid) && !showMinor) continue;
    const len = (major ? 14 : mid ? 9 : 5) / k, y = H - i * minor;
    s += `<line x1="${x - len}" x2="${x}" y1="${y}" y2="${y}"/>`;
    if (major && (minor * perMajor * k > 22 || i % (perMajor * 5) === 0)) {
      const v = u === 'in' ? `${i} in` : u === 'cm' ? `${i} cm` : `${i * 10}`;
      s += `<text x="${x - 18 / k}" y="${y}" style="font-size:${fs}px">${v}</text>`;
    }
  }
  return s + '</g>';
}

function draw2D() {
  if (ui.view !== '2d') return;
  if (!doc.racks.length) { svg.innerHTML = ''; return; }
  const L = layout(), port = portMap(L), k = ui.cam.k, used = portUse();
  let s = `<line class="floor" x1="-300" x2="${L.w + 300}" y1="${L.h}" y2="${L.h}"/>`;
  s += rulerSVG(L);

  for (const r of doc.racks) {
    const R = L.racks[r.id];
    s += `<g class="rack${isSel('rack', r.id) ? ' sel' : ''}" data-rack="${r.id}">`;
    s += `<rect class="rack-frame" x="${R.x}" y="${R.top}" width="${r.width}" height="${R.h}"/>`;
    s += `<rect class="rack-inner" x="${R.px - 14}" y="${R.railTop}" width="${PANEL_W + 28}" height="${r.units * U_MM}"/>`;
    const every = U_MM * k < 9 ? 5 : 1;
    for (let n = 1; n <= r.units; n++) {
      const y = R.railBottom - n * U_MM;
      s += `<line class="u-tick" x1="${R.px - 14}" x2="${R.px}" y1="${y}" y2="${y}"/><line class="u-tick" x1="${R.px + PANEL_W}" x2="${R.px + PANEL_W + 14}" y1="${y}" y2="${y}"/>`;
      if (n % every === 0 || n === 1) s += `<text class="u-num" x="${R.px - 20}" y="${y + U_MM / 2}">${n}</text>`;
    }
    s += `<text class="rack-name" x="${R.x + r.width / 2}" y="${R.top - 28}">${esc(r.name)}</text>`;
    s += `<text class="rack-meta" x="${R.x + r.width / 2}" y="${R.bottom + 34}">${r.units}U · ${usedU(r)}U used · ${fmt(r.width)} × ${fmt(r.depth)}</text>`;
    s += '</g>';
  }

  for (const r of doc.racks) {
    const devs = [...r.devices].sort((a, b) => (a.mount === 'rear' ? 0 : 1) - (b.mount === 'rear' ? 0 : 1));
    for (const d of devs) {
      const b = devRect(L, r, d), t = TYPES[d.type] || TYPES.custom, pl = portLayout(L, r, d);
      const cls = ['dev', 'k-' + t.cat, d.mount,
        isSel('device', d.id) && 'sel', ui.pending === d.id && 'pending', devWarn(r, d) && 'bad',
        ui.drag?.moved && ui.drag.id === d.id && 'dragging'].filter(Boolean).join(' ');
      s += `<g class="${cls}" data-dev="${d.id}"${d.color ? ` style="--c:${d.color}"` : ''}>`;
      s += `<rect class="dev-body" x="${b.x}" y="${b.y + 1}" width="${b.w}" height="${b.h - 2}" rx="2"><title>${esc(d.name)} · ${d.h}U${d.mount === 'rear' ? ' · rear' : ''}</title></rect>`;
      s += `<rect class="dev-stripe" x="${b.x + 1}" y="${b.y + 2}" width="9" height="${b.h - 4}"/>`;
      s += `<text class="dev-label" x="${b.x + 16}" y="${b.y + b.h / 2}">${esc(pl ? clip(d.name, 14) : d.name)}</text>`;
      if (!pl) s += `<text class="dev-meta" x="${b.x + b.w - 12}" y="${b.y + b.h / 2}">${d.h}U${d.mount === 'rear' ? ' · rear' : ''}</text>`;
      if (pl) for (const p of pl) {
        const c = used[d.id]?.[p.key];
        s += `<rect class="pt${p.up ? ' up' : ''}"${c ? ` style="fill:${cableColor(c)};stroke:${cableColor(c)}"` : ''} data-port="${p.key}" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"><title>${p.up ? 'Uplink ' + p.key.slice(1) + ' · ' + UPLINK_TYPES[upType(d)] : 'Port ' + p.key.slice(1)}${c ? ' · in use' : ''}</title></rect>`;
      }
      s += '</g>';
    }
  }

  const routes = doc.settings.route === 'ortho' ? diagramRoutes(L, port) : null;
  for (const c of doc.cables) {
    const a = port(c.a, c.id, c.pa), b = port(c.b, c.id, c.pb);
    if (!a || !b) continue;
    const p = cableCurve(a, b), col = cableColor(c);
    const d = routes ? roundedPath(routes[c.id], 10) : `M${p[0].x},${p[0].y} C${p[1].x},${p[1].y} ${p[2].x},${p[2].y} ${p[3].x},${p[3].y}`;
    const back = a.mount === 'rear' || b.mount === 'rear';
    s += `<g data-cable="${c.id}"><path class="cable-hit" d="${d}"/>`;
    s += `<path class="cable${back ? ' back' : ''}${isSel('cable', c.id) ? ' sel' : ''}" style="stroke:${col}" d="${d}"/>`;
    s += `<circle class="port" style="fill:${col}" cx="${a.x}" cy="${a.y}" r="6"/><circle class="port" style="fill:${col}" cx="${b.x}" cy="${b.y}" r="6"/></g>`;
  }

  // overlays
  if (ui.pending && ui.hover) {
    const f = findDev(ui.pending);
    if (f) {
      const b = devRect(L, f.rack, f.dev), pp = ui.pendingPort && portLayout(L, f.rack, f.dev)?.find(p => p.key === ui.pendingPort);
      const ox = pp ? pp.x + pp.w / 2 : b.x + b.w / 2, oy = pp ? pp.y + pp.h / 2 : b.y + b.h / 2;
      s += `<line class="pending-line" x1="${ox}" y1="${oy}" x2="${ui.hover.x}" y2="${ui.hover.y}"/>`;
    }
  }
  if (ui.drag?.moved && ui.drag.target) {
    const t = ui.drag.target, r = doc.racks.find(r => r.id === t.rackId), f = findDev(ui.drag.id);
    if (r && f) {
      const b = devRect(L, r, { ...f.dev, u: t.u });
      s += `<rect class="ghost${t.err ? ' bad' : ''}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"/>`;
      s += `<text class="ghost-lbl" x="${b.x + b.w + 22}" y="${b.y + b.h / 2}" style="font-size:${12 / k}px;dominant-baseline:central">U${t.u}${f.dev.h > 1 ? '–' + (t.u + f.dev.h - 1) : ''}</text>`;
    }
  }
  if (ui.mode === 'select' && ui.hover && !ui.drag && !ui.pan) {
    s += `<line class="hover-line" x1="-120" x2="${L.w + 120}" y1="${ui.hover.y}" y2="${ui.hover.y}"/>`;
  }
  if (ui.measure) {
    const { a, b } = ui.measure, fs = 12 / k;
    s += `<g class="measure"><line class="dim" x1="${a.x}" y1="${a.y}" x2="${a.x}" y2="${b.y}"/><line class="dim" x1="${a.x}" y1="${b.y}" x2="${b.x}" y2="${b.y}"/>`;
    s += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><circle cx="${a.x}" cy="${a.y}" r="${3 / k}"/><circle cx="${b.x}" cy="${b.y}" r="${3 / k}"/>`;
    const dy = Math.abs(b.y - a.y), dx = Math.abs(b.x - a.x);
    s += `<text x="${b.x + 10 / k}" y="${b.y - 10 / k}" style="font-size:${fs}px">↕ ${fmt(dy)} · ${fmtU(dy)}</text>`;
    if (dx > 1) s += `<text x="${b.x + 10 / k}" y="${b.y + 8 / k}" style="font-size:${fs}px">↔ ${fmt(dx)}</text>`;
    s += '</g>';
  }

  svg.innerHTML = `<g transform="translate(${ui.cam.x},${ui.cam.y}) scale(${k})">${s}</g>`;
  $('#zoomLbl').textContent = Math.round(k / (ui.fitK || k) * 100) + '%';
}

function hud() {
  let t = '';
  if (ui.view === '3d') {
    t = ui.mode === 'connect'
      ? 'Cables are drawn port to port in the 2D view'
      : 'Drag to orbit · right-drag to pan · scroll to zoom · grid = 50 cm · move devices in 2D';
  } else if (ui.mode === 'connect') {
    const pd = ui.pending && findDev(ui.pending)?.dev;
    t = pd ? `${pd.name}${fmtPort(ui.pendingPort)} → click a port on another device · Esc to cancel`
      : `Click a port to start a ${ctype(ui.cableType).name} cable`;
    const hp = ui.hoverPort && findDev(ui.hoverPort.dev)?.dev;
    if (hp) {
      const k = ui.hoverPort.key, busy = portUse()[hp.id]?.[k];
      t += `   ·   ${hp.name} ${k[0] === 'p' ? 'port ' + k.slice(1) : 'uplink ' + k.slice(1) + ' (' + UPLINK_TYPES[upType(hp)] + ')'} · ${busy ? 'in use' : 'free'}`;
    }
  } else if (ui.mode === 'measure') {
    if (ui.measure) {
      const { a, b } = ui.measure, dy = Math.abs(b.y - a.y), dx = Math.abs(b.x - a.x);
      t = `↕ ${fmt(dy, 'cm')} · ${fmt(dy, 'in')} · ${fmtU(dy)}   ↔ ${fmt(dx, 'cm')} · ${fmt(dx, 'in')}   ⤢ ${fmt(Math.hypot(dx, dy))}`;
    } else t = 'Drag anywhere to measure';
  } else if (ui.drag?.moved && ui.drag.target) {
    const tg = ui.drag.target, r = doc.racks.find(r => r.id === tg.rackId);
    t = tg.err ? tg.err : `→ ${r.name} · U${tg.u}`;
  } else if (ui.hover) {
    const L = layout(), h = L.h - ui.hover.y, r = rackAtX(L, ui.hover.x);
    t = `${fmt(Math.max(0, h))} from floor`;
    if (r) {
      const R = L.racks[r.id], n = Math.floor((R.railBottom - ui.hover.y) / U_MM) + 1;
      if (n >= 1 && n <= r.units) {
        const d = r.devices.find(d => n >= d.u && n <= d.u + d.h - 1);
        t = `${r.name} · U${n}${d ? ' · ' + d.name : ' · free'} · ${t}`;
      }
    }
  }
  hudEl.textContent = t;
}

let rafPending = false;
function schedule() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => { rafPending = false; draw2D(); hud(); });
}

/* pointer interaction */
svg.addEventListener('contextmenu', e => e.preventDefault());
function capture(e) { try { svg.setPointerCapture(e.pointerId); } catch (err) { /* pointer already gone */ } }
const touches = new Map();
let pinch = null;
function touchInfo() {
  const [a, b] = [...touches.values()], r = svg.getBoundingClientRect();
  return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top };
}
svg.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch') {
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      ui.drag = null; ui.pan = null;
      if (ui.measure?.active) ui.measure = null;
      pinch = { ...touchInfo(), cam: { ...ui.cam } };
      capture(e);
      return schedule();
    }
  }
  const p = toWorld(e);
  const startPan = () => { ui.pan = { sx: e.clientX, sy: e.clientY, cx: ui.cam.x, cy: ui.cam.y }; capture(e); };
  if (e.button === 1 || e.button === 2) return startPan();
  if (e.button !== 0) return;
  const devEl = e.target.closest('[data-dev]'), cabEl = e.target.closest('[data-cable]'), rackEl = e.target.closest('[data-rack]');

  if (ui.mode === 'measure') {
    ui.measure = { a: p, b: p, active: true };
    capture(e);
    return schedule();
  }
  if (ui.mode === 'connect') {
    if (devEl) connectClick(devEl.dataset.dev, e.target.closest('[data-port]')?.dataset.port || '');
    else if (ui.pending) { ui.pending = null; renderAll(); }
    else startPan();
    return;
  }
  if (devEl) {
    const id = devEl.dataset.dev, f = findDev(id), b = devRect(layout(), f.rack, f.dev);
    ui.drag = { id, offY: p.y - b.y, sx: e.clientX, sy: e.clientY, moved: false, target: null };
    capture(e);
    return select('device', id);
  }
  if (cabEl) return select('cable', cabEl.dataset.cable);
  if (rackEl) select('rack', rackEl.dataset.rack);
  else if (ui.sel) select(null);
  startPan();
});
svg.addEventListener('pointermove', e => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && touches.size === 2) {
    const t = touchInfo(), c = pinch.cam, k2 = clamp(c.k * t.d / pinch.d, 0.03, 8);
    const wx = (pinch.mx - c.x) / c.k, wy = (pinch.my - c.y) / c.k;
    ui.cam = { k: k2, x: t.mx - wx * k2, y: t.my - wy * k2 };
    ui.userMoved = true;
    return schedule();
  }
  const p = toWorld(e), pe = e.target.closest?.('[data-port]');
  ui.hover = p;
  ui.hoverPort = pe ? { dev: pe.closest('[data-dev]').dataset.dev, key: pe.dataset.port } : null;
  if (ui.pan) {
    ui.cam.x = ui.pan.cx + e.clientX - ui.pan.sx;
    ui.cam.y = ui.pan.cy + e.clientY - ui.pan.sy;
    ui.userMoved = true;
  } else if (ui.drag) {
    if (!ui.drag.moved && Math.hypot(e.clientX - ui.drag.sx, e.clientY - ui.drag.sy) < 4) return;
    ui.drag.moved = true;
    const L = layout(), f = findDev(ui.drag.id), rack = rackAtX(L, p.x, true);
    let u = uFromTop(L.racks[rack.id], rack, p.y - ui.drag.offY, f.dev.h), err = conflict(rack, { ...f.dev, u });
    if (err) { const n = nearestFree(rack, f.dev, u, f.dev.h + 2); if (n) { u = n; err = null; } }
    ui.drag.target = { rackId: rack.id, u, err };
  } else if (ui.measure?.active) {
    ui.measure.b = p;
  }
  schedule();
});
function endPointer(e) {
  touches.delete(e?.pointerId);
  if (pinch) { if (touches.size < 2) pinch = null; ui.pan = null; return; }
  if (ui.drag) {
    const d = ui.drag; ui.drag = null;
    if (d.moved && d.target) {
      if (d.target.err) toast(d.target.err); else moveDev(d.id, d.target.rackId, d.target.u);
    }
    renderAll();
  }
  ui.pan = null;
  if (ui.measure) ui.measure.active = false;
  schedule();
}
svg.addEventListener('pointerup', endPointer);
svg.addEventListener('pointercancel', endPointer);
svg.addEventListener('pointerleave', () => { if (!ui.drag && !ui.pan) { ui.hover = null; schedule(); } });
function zoomAt(mx, my, factor) {
  const k = ui.cam.k, k2 = clamp(k * factor, 0.03, 8);
  ui.cam.x = mx - (mx - ui.cam.x) * k2 / k;
  ui.cam.y = my - (my - ui.cam.y) * k2 / k;
  ui.cam.k = k2;
  ui.userMoved = true;
  schedule();
}
function zoomBy(factor) {
  if (ui.view === '3d') {
    if (!T.ready) return;
    const v = T.camera.position.clone().sub(T.controls.target).multiplyScalar(1 / factor);
    T.camera.position.copy(T.controls.target).add(v);
    return;
  }
  const r = svg.getBoundingClientRect();
  zoomAt(r.width / 2, r.height / 2, factor);
}
svg.addEventListener('wheel', e => {
  e.preventDefault();
  const r = svg.getBoundingClientRect();
  zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });

/* drop from palette */
svg.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/x-rack-type')) e.preventDefault(); });
svg.addEventListener('drop', e => {
  const type = e.dataTransfer.getData('text/x-rack-type');
  if (!type) return;
  e.preventDefault();
  const L = layout(), p = toWorld(e), rack = rackAtX(L, p.x);
  if (!rack) return toast('Drop it onto a rack');
  const h = TYPES[type].h;
  addDevice(type, rack, uFromTop(L.racks[rack.id], rack, p.y - h * U_MM / 2, h));
});

/* ================= 3D view ================= */
const T = { ready: false, framed: false, pickables: [] };
function init3D() {
  if (T.ready) return true;
  if (!window.THREE || !THREE.OrbitControls) {
    threeEl.innerHTML = '<p class="msg">The 3D view needs an internet connection to load three.js.</p>';
    return false;
  }
  const r = T.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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
      const t = TYPES[dv.type] || TYPES.custom;
      const bh = dv.h * U_MM * S - 0.002, bd = dv.depth * S;
      const y = (FRAME_BOT + (dv.u - 1) * U_MM + dv.h * U_MM / 2) * S;
      const front = dv.mount !== 'rear', face = front ? zf : zb;
      const col = isSel('device', dv.id) ? C('--accent') : devWarn(r, dv) ? C('--bad') : new THREE.Color(devColor(dv)).lerp(C('--dev'), 0.45);
      const mat = new THREE.MeshLambertMaterial({ color: col });
      const body = add(new THREE.Mesh(new THREE.BoxGeometry(BODY_W * S, bh, bd), mat));
      body.position.set(cx, y, front ? face - bd / 2 : face + bd / 2);
      const plate = add(new THREE.Mesh(new THREE.BoxGeometry(PANEL_W * S, bh, 0.003), mat));
      plate.position.set(cx, y, front ? face + 0.0015 : face - 0.0015);
      for (const m of [body, plate]) {
        m.userData = { kind: 'device', id: dv.id };
        T.pickables.push(m);
        const e = add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), lineMat));
        e.position.copy(m.position);
      }
    }
  }

  const topY = L.h * S + 0.08;
  for (const c of doc.cables) {
    const a = port(c.a, c.id, c.pa), b = port(c.b, c.id, c.pb);
    if (!a || !b) continue;
    const P = q => {
      const front = q.mount !== 'rear';
      const z = front ? -RAIL_INSET * S + 0.006 : -(q.rack.depth - RAIL_INSET) * S - 0.006;
      return { v: new V3(q.x * S, (L.h - q.y) * S, z), n: front ? 1 : -1 };
    };
    const A = P(a), B = P(b);
    const out = (X, k) => X.v.clone().add(new V3(0, -0.02, 0.07 * X.n * k));
    const pts = [A.v, out(A, 1)];
    if (A.n === B.n) {
      const m = A.v.clone().lerp(B.v, 0.5);
      m.z += 0.12 * A.n;
      m.y = Math.max(0.03, Math.min(A.v.y, B.v.y) - 0.06 - 0.12 * A.v.distanceTo(B.v));
      pts.push(m);
    } else {
      pts.push(new V3(A.v.x, topY, A.v.z + 0.07 * A.n), new V3(B.v.x, topY, B.v.z + 0.07 * B.n));
    }
    pts.push(out(B, 1), B.v);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const sel = isSel('cable', c.id);
    const tube = add(new THREE.Mesh(new THREE.TubeGeometry(curve, 80, sel ? 0.007 : 0.004, 6, false),
      new THREE.MeshLambertMaterial({ color: new THREE.Color(cableColor(c)), emissive: sel ? C('--accent') : 0x000000, emissiveIntensity: 0.4 })));
    tube.userData = { kind: 'cable', id: c.id };
    T.pickables.push(tube);
  }
}

/* ================= side panels ================= */
function renderRackList() {
  rackListEl.innerHTML = doc.racks.length ? doc.racks.map(r => {
    const sel = isSel('rack', r.id) || (ui.sel?.kind === 'device' && findDev(ui.sel.id)?.rack === r);
    const used = usedU(r), pct = Math.round(used / r.units * 100);
    return `<div class="item rack-item${sel ? ' sel' : ''}" data-id="${r.id}" title="${used} of ${r.units}U used (${pct} %)">
      <div class="ri-top"><span class="grow">${esc(r.name)}</span><span class="muted">${used}/${r.units}U</span></div>
      <div class="meter"><i class="${pct >= 90 ? 'full' : ''}" style="width:${pct}%"></i></div></div>`;
  }).join('') : '<div class="empty">No racks yet.</div>';
}
rackListEl.addEventListener('click', e => { const it = e.target.closest('[data-id]'); if (it) select('rack', it.dataset.id); });

function renderCableList() {
  const L = layout(), name = id => esc(findDev(id)?.dev.name ?? '?');
  $('#cableCount').textContent = doc.cables.length || '';
  if (!doc.cables.length) { cableListEl.innerHTML = '<div class="empty">No cables yet. Pick the Cable tool, then click a port and a port on another device.</div>'; return; }
  const totals = {}, lens = cableLengths(L);
  const rows = doc.cables.map(c => {
    const len = lens[c.id] || 0;
    (totals[c.type] ||= { n: 0, len: 0 }); totals[c.type].n++; totals[c.type].len += len;
    return `<div class="item${isSel('cable', c.id) ? ' sel' : ''}" data-id="${c.id}"><span class="sw line" style="--c:${cableColor(c)}"></span>` +
      `<span class="grow">${c.label ? esc(c.label) + ': ' : ''}${name(c.a)}${fmtPort(c.pa)} → ${name(c.b)}${fmtPort(c.pb)}</span><span class="muted">≈${fmtLong(len)}</span></div>`;
  }).join('');
  const sum = Object.entries(totals).map(([t, v]) => `<div class="item"><span class="sw line" style="--c:${ctype(t).color}"></span><span class="grow">${esc(ctype(t).name)} · ${v.n}</span><span class="muted">≈${fmtLong(v.len)}</span></div>`).join('');
  cableListEl.innerHTML = rows + `<h3 class="list-sub">Totals</h3>` + sum;
}
cableListEl.addEventListener('click', e => { const it = e.target.closest('[data-id]'); if (it) select('cable', it.dataset.id); });

function deviceOptions(selected) {
  return doc.racks.map(r => `<optgroup label="${esc(r.name)}">` +
    [...r.devices].sort((a, b) => b.u - a.u).map(d => `<option value="${d.id}"${d.id === selected ? ' selected' : ''}>U${d.u} · ${esc(d.name)}</option>`).join('') +
    '</optgroup>').join('');
}

function renderProps() {
  const s = ui.sel, u = ui.unit;
  $('#propsTitle').textContent = { device: 'Device', rack: 'Rack', cable: 'Cable' }[s?.kind] || 'Properties';
  let h = '';
  if (s?.kind === 'device') {
    const f = findDev(s.id);
    if (!f) { ui.sel = null; return renderProps(); }
    const { rack, dev } = f, warn = devWarn(rack, dev);
    h = `<div class="stack">
      <label>Name<input data-f="name" value="${esc(dev.name)}"></label>
      <label>Type<select data-f="type">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}"${k === dev.type ? ' selected' : ''}>${t.label}</option>`).join('')}</select></label>
      <div class="color-row"><span>Color</span><input type="color" data-f="color" value="${devColor(dev)}"><button data-act="resetColor"${dev.color ? '' : ' disabled'}>Use category color</button></div>
      <label>Rack<select data-f="rack">${doc.racks.map(x => `<option value="${x.id}"${x === rack ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <div class="grid2">
        <label>Height (U)<input data-f="h" type="number" min="1" max="${rack.units}" value="${dev.h}"></label>
        <label>Bottom U<input data-f="u" type="number" min="1" max="${rack.units}" value="${dev.u}"></label>
        <label>Depth (${u})<input data-f="depth" type="number" step="any" min="1" value="${toDisp(dev.depth)}"></label>
        <label>Mounted<select data-f="mount"><option value="front"${dev.mount === 'front' ? ' selected' : ''}>Front</option><option value="rear"${dev.mount === 'rear' ? ' selected' : ''}>Rear</option></select></label>
      </div>
      ${hasPorts(dev) ? `<div class="grid2">
        <label>Ports<input data-f="ports" type="number" min="0" max="96" list="portCounts" value="${nPorts(dev)}"></label>
        ${hasUplinks(dev) ? `<label>Uplinks<input data-f="uplinks" type="number" min="0" max="16" value="${nUplinks(dev)}"></label>
        <label class="full">Uplink type<select data-f="uplinkType">${Object.entries(UPLINK_TYPES).map(([k, v]) => `<option value="${k}"${k === upType(dev) ? ' selected' : ''}>${v}</option>`).join('')}</select></label>` : ''}
      </div>` : ''}
      <dl class="kv">
        <dt>Occupies</dt><dd>U${dev.u}${dev.h > 1 ? '–' + (dev.u + dev.h - 1) : ''}</dd>
        <dt>Height</dt><dd>${fmt(dev.h * U_MM, 'cm')} · ${fmt(dev.h * U_MM, 'in')}</dd>
        <dt>Depth</dt><dd>${fmt(dev.depth, 'cm')} · ${fmt(dev.depth, 'in')}</dd>
        <dt>Cables</dt><dd>${doc.cables.filter(c => c.a === dev.id || c.b === dev.id).length}</dd>
        ${nPorts(dev) + nUplinks(dev) ? `<dt>Ports in use</dt><dd>${Object.keys(portUse()[dev.id] || {}).length} / ${nPorts(dev) + nUplinks(dev)}</dd>` : ''}
      </dl>
      ${warn ? `<p class="warn">⚠ ${esc(warn)}</p>` : ''}
      <div class="row"><button data-act="up" title="Move up to the next free slot">▲ Up</button><button data-act="down" title="Move down to the next free slot">▼ Down</button><button data-act="dup">Duplicate</button><button data-act="del" class="danger">Delete</button></div>
      <p class="hint">Drag it in the 2D view to move it, also into another rack. ↑/↓ keys work too.</p>
    </div>`;
  } else if (s?.kind === 'rack') {
    const r = doc.racks.find(r => r.id === s.id);
    if (!r) { ui.sel = null; return renderProps(); }
    const used = usedU(r), usable = r.units * U_MM;
    h = `<div class="stack">
      <label>Name<input data-f="name" value="${esc(r.name)}"></label>
      <div class="grid2">
        <label>Height (U)<input data-f="units" type="number" min="1" max="100" value="${r.units}"></label>
        <label>Width (${u})<input data-f="width" type="number" step="any" value="${toDisp(r.width)}"></label>
        <label>Depth (${u})<input data-f="depth" type="number" step="any" value="${toDisp(r.depth)}"></label>
      </div>
      <dl class="kv">
        <dt>Usable height</dt><dd>${fmt(usable, 'cm')} · ${fmt(usable, 'in')}</dd>
        <dt>Outer height</dt><dd>${fmt(rackH(r), 'cm')} · ${fmt(rackH(r), 'in')}</dd>
        <dt>Usable depth</dt><dd>${fmt(usableDepth(r))}</dd>
        <dt>Used</dt><dd>${used}U (${Math.round(used / r.units * 100)} %)</dd>
        <dt>Free</dt><dd>${r.units - used}U · ${fmt((r.units - used) * U_MM)}</dd>
        <dt>Largest free block</dt><dd>${largestFree(r)}U</dd>
        <dt>Devices</dt><dd>${r.devices.length}</dd>
      </dl>
      <div class="row"><button data-act="left" title="Move left">←</button><button data-act="right" title="Move right">→</button><button data-act="dup">Duplicate</button><button data-act="del" class="danger">Delete</button></div>
    </div>`;
  } else if (s?.kind === 'cable') {
    const c = doc.cables.find(c => c.id === s.id);
    if (!c) { ui.sel = null; return renderProps(); }
    const len = cableLengths()[c.id] || 0;
    h = `<div class="stack">
      <label>Type<select data-f="type">${doc.settings.cableTypes.map(t => `<option value="${t.id}"${t.id === c.type ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>
      <div class="color-row"><span>Color</span><input type="color" data-f="color" value="${cableColor(c)}"><button data-act="resetColor"${c.color ? '' : ' disabled'}>Use type color</button></div>
      <label>Label<input data-f="label" value="${esc(c.label)}" placeholder="optional"></label>
      <label>From<select data-f="a">${deviceOptions(c.a)}</select></label>
      <label>From port<select data-f="pa">${portOptions(c.a, c.pa, c.id)}</select></label>
      <label>To<select data-f="b">${deviceOptions(c.b)}</select></label>
      <label>To port<select data-f="pb">${portOptions(c.b, c.pb, c.id)}</select></label>
      <dl class="kv"><dt>Estimated length</dt><dd>≈ ${fmtLong(len)} · ${fmt(len, 'in')}</dd></dl>
      <p class="hint">Estimate from the drawn route + 10 % slack.</p>
      <div class="row"><button data-act="del" class="danger">Delete</button></div>
    </div>`;
  } else {
    h = `<div class="stack">
      <div class="empty-props"><svg class="ic"><use href="#i-cursor"/></svg>
        <p><strong>Nothing selected</strong><br>Click a rack, device or cable to see and edit its details.</p></div>
      <h4>Layout</h4>
      <label>Space between racks (${u})<input data-f="gap" type="number" step="any" min="0" value="${toDisp(doc.settings.gap)}"></label>
    </div>`;
  }
  propsEl.innerHTML = h;
}

propsEl.addEventListener('change', e => {
  const f = e.target.dataset.f;
  if (!f) return;
  const raw = e.target.value, s = ui.sel;
  if (!s) {
    if (f === 'gap') mutate(() => (doc.settings.gap = Math.max(0, fromDisp(+raw || 0))));
    return;
  }
  if (s.kind === 'device') updateDevice(s.id, f, raw);
  else if (s.kind === 'rack') updateRack(s.id, f, raw);
  else if (s.kind === 'cable') {
    const c = doc.cables.find(c => c.id === s.id);
    const other = f === 'a' ? c.b : f === 'b' ? c.a : null;
    if (other && raw === other) { toast('A cable needs two different devices'); return renderProps(); }
    if (other) {
      const d = findDev(raw).dev, k = firstFree(d, portUse()[raw]);
      if (!k) { toast(`“${d.name}” has no free ports`); return renderProps(); }
      return mutate(() => { c[f] = raw; c[f === 'a' ? 'pa' : 'pb'] = k; });
    }
    mutate(() => (c[f] = raw));
  }
});
function updateDevice(id, f, raw) {
  const { rack, dev } = findDev(id), next = { ...dev };
  if (f === 'rack') {
    const to = doc.racks.find(r => r.id === raw);
    const u = to && nearestFree(to, dev, clamp(dev.u, 1, to.units));
    if (!u) { toast(`No free ${dev.h}U space in ${to?.name}`); return renderProps(); }
    return moveDev(id, to.id, u);
  }
  if (f === 'name') next.name = raw.trim() || TYPES[dev.type].label;
  else if (f === 'type') {
    const o = TYPES[dev.type], t = TYPES[raw];
    next.type = raw;
    if (dev.name === o.label) next.name = t.label;
    if (dev.h === o.h) next.h = t.h;
    if (dev.depth === o.d) next.depth = t.d;
    next.ports = t.p; next.uplinks = t.ul; next.uplinkType = t.ut;
  }
  else if (f === 'h' || f === 'u') next[f] = Math.max(1, Math.round(+raw) || 1);
  else if (f === 'depth') next.depth = Math.max(5, fromDisp(+raw || 0));
  else if (f === 'mount') next.mount = raw;
  else if (f === 'ports') next.ports = clamp(Math.round(+raw) || 0, 0, 96);
  else if (f === 'uplinks') next.uplinks = clamp(Math.round(+raw) || 0, 0, 16);
  else if (f === 'uplinkType') next.uplinkType = raw;
  else if (f === 'color') next.color = raw;
  const g = portGrid(next);
  const err = conflict(rack, next)
    || (!g.fits && `${g.n} ports don't fit on ${next.h}U${g.m ? ` with ${g.m} uplinks` : ''} (max ${g.max})`)
    || Object.keys(portUse()[id] || {}).filter(k => !validPort(next, k)).map(k => `${fmtPort(k).trim()} has a cable. Remove it first`)[0];
  if (err) { toast(err); return renderProps(); }
  mutate(() => Object.assign(dev, next));
}
function updateRack(id, f, raw) {
  const r = doc.racks.find(r => r.id === id);
  if (f === 'name') return mutate(() => (r.name = raw.trim() || 'Rack'));
  if (f === 'units') {
    const n = clamp(Math.round(+raw) || 1, 1, 100);
    const over = r.devices.find(d => d.u + d.h - 1 > n);
    if (over) { toast(`“${over.name}” sits above U${n} — move it first`); return renderProps(); }
    return mutate(() => (r.units = n));
  }
  if (f === 'width') return mutate(() => (r.width = Math.max(PANEL_W + 20, fromDisp(+raw || 0))));
  if (f === 'depth') return mutate(() => (r.depth = Math.max(2 * RAIL_INSET + 50, fromDisp(+raw || 0))));
}
propsEl.addEventListener('click', e => {
  const act = e.target.closest('[data-act]')?.dataset.act, s = ui.sel;
  if (!act || !s) return;
  if (act === 'resetColor') {
    const o = s.kind === 'device' ? findDev(s.id)?.dev : doc.cables.find(c => c.id === s.id);
    if (o) mutate(() => delete o.color);
    return;
  }
  if (act === 'del') {
    const btn = e.target.closest('[data-act]'), r = s.kind === 'rack' && doc.racks.find(r => r.id === s.id);
    if (r && r.devices.length && !btn.dataset.armed) {
      btn.dataset.armed = '1'; btn.classList.add('armed');
      btn.textContent = `Confirm: delete rack + ${r.devices.length} device${r.devices.length > 1 ? 's' : ''}`;
      return;
    }
    return deleteSel(true);
  }
  if (s.kind === 'device' && (act === 'up' || act === 'down')) return shiftDev(s.id, act === 'up' ? 1 : -1);
  if (s.kind === 'device' && act === 'dup') {
    const { rack, dev } = findDev(s.id), copy = { ...dev, id: uid() };
    copy.u = freeSlot(rack, copy);
    if (!copy.u) return toast(`No free ${dev.h}U space in ${rack.name}`);
    ui.sel = { kind: 'device', id: copy.id };
    mutate(() => rack.devices.push(copy));
  }
  if (s.kind === 'rack') {
    const i = doc.racks.findIndex(r => r.id === s.id), r = doc.racks[i];
    if (act === 'left' && i > 0) mutate(() => doc.racks.splice(i - 1, 0, doc.racks.splice(i, 1)[0]));
    if (act === 'right' && i < doc.racks.length - 1) mutate(() => doc.racks.splice(i + 1, 0, doc.racks.splice(i, 1)[0]));
    if (act === 'dup') {
      const copy = { ...r, id: uid(), name: r.name + ' copy', devices: r.devices.map(d => ({ ...d, id: uid() })) };
      ui.sel = { kind: 'rack', id: copy.id };
      mutate(() => doc.racks.splice(i + 1, 0, copy));
    }
  }
});

/* add-rack form */
const rackForm = $('#addRackForm'), presetSel = $('#presetSel');
const formMM = { width: 600, depth: 1000 };
presetSel.innerHTML = RACK_PRESETS.map((p, i) => `<option value="${i}">${p.label}</option>`).join('');
function nextRackName() {
  for (let i = 0; i < 26; i++) {
    const n = 'Rack ' + String.fromCharCode(65 + i);
    if (!doc.racks.some(r => r.name === n)) return n;
  }
  return 'Rack ' + (doc.racks.length + 1);
}
function applyPreset() {
  const p = RACK_PRESETS[+presetSel.value];
  rackForm.units.value = p.units; formMM.width = p.width; formMM.depth = p.depth;
  renderRackForm();
}
function renderRackForm() {
  rackForm.width.value = toDisp(formMM.width);
  rackForm.depth.value = toDisp(formMM.depth);
  if (!rackForm.name.dataset.touched) rackForm.name.value = nextRackName();
  document.querySelectorAll('.unit-lbl').forEach(el => (el.textContent = ui.unit));
}
presetSel.addEventListener('change', applyPreset);
rackForm.name.addEventListener('input', () => (rackForm.name.dataset.touched = '1'));
rackForm.width.addEventListener('change', () => (formMM.width = fromDisp(+rackForm.width.value || 0)));
rackForm.depth.addEventListener('change', () => (formMM.depth = fromDisp(+rackForm.depth.value || 0)));
rackForm.addEventListener('submit', e => {
  e.preventDefault();
  const r = makeRack({
    name: rackForm.name.value.trim() || nextRackName(),
    units: clamp(Math.round(+rackForm.units.value) || 42, 1, 100),
    width: Math.max(PANEL_W + 20, formMM.width),
    depth: Math.max(2 * RAIL_INSET + 50, formMM.depth),
  });
  delete rackForm.name.dataset.touched;
  showRackForm(false);
  ui.sel = { kind: 'rack', id: r.id }; ui.lastRack = r.id;
  mutate(() => doc.racks.push(r));
  if (ui.view === '2d') { fit(); draw2D(); }
});

const newRackBtn = $('#newRackBtn');
function showRackForm(on) {
  rackForm.hidden = !on;
  newRackBtn.setAttribute('aria-expanded', on);
  newRackBtn.textContent = on ? 'Close' : '+ New rack';
  if (on) rackForm.name.focus();
}
newRackBtn.addEventListener('click', () => showRackForm(rackForm.hidden));
$('#cancelRack').addEventListener('click', () => showRackForm(false));

/* palette */
const paletteEl = $('#palette');
paletteEl.innerHTML = CATS.map(([cat, label]) => {
  const items = Object.entries(TYPES).filter(([, t]) => t.cat === cat);
  return items.length ? `<div class="pal-group"><div class="pal-head">${label}</div>` + items.map(([k, t]) =>
    `<button class="pal" draggable="true" data-type="${k}" title="Add a ${t.label.toLowerCase()} (${t.h}U), or drag it onto a rack">` +
    `<span class="sw k-${cat}"></span><span class="grow">${t.label}</span><span class="muted">${t.h}U</span>` +
    `<svg class="ic add"><use href="#i-plus"/></svg></button>`).join('') + '</div>' : '';
}).join('');
paletteEl.addEventListener('click', e => { const b = e.target.closest('[data-type]'); if (b) addDevice(b.dataset.type); });
paletteEl.addEventListener('dragstart', e => {
  const b = e.target.closest('[data-type]');
  if (b) { e.dataTransfer.setData('text/x-rack-type', b.dataset.type); e.dataTransfer.effectAllowed = 'copy'; }
});

/* converter */
const CV = { U: U_MM, mm: 1, cm: 10, in: IN_MM };
let cvMM = U_MM;
const cvInputs = [...document.querySelectorAll('[data-cv]')];
function renderConverter(except) {
  for (const inp of cvInputs) if (inp.dataset.cv !== except) inp.value = num(cvMM / CV[inp.dataset.cv], 4);
  drawConvRuler();
}
cvInputs.forEach(inp => inp.addEventListener('input', () => {
  const v = parseFloat(inp.value);
  if (!isFinite(v) || v < 0) return;
  cvMM = v * CV[inp.dataset.cv];
  renderConverter(inp.dataset.cv);
}));
function drawConvRuler() {
  const W = 260, X = 10, range = Math.max(cvMM * 1.15, 4 * U_MM), sc = W / range, u = ui.unit;
  let s = '';
  // top scale: rack units
  const nU = Math.floor(range / U_MM), uStep = Math.ceil(nU / 10);
  for (let i = 0; i <= nU; i++) {
    const x = X + i * U_MM * sc;
    s += `<line x1="${x}" x2="${x}" y1="${i % uStep ? 22 : 18}" y2="28"/>`;
    if (i % uStep === 0) s += `<text x="${x}" y="13">${i}U</text>`;
  }
  // value bar
  s += `<rect class="bar-fill" x="${X}" y="30" width="${Math.max(0, cvMM * sc)}" height="10"/>`;
  // bottom scale: metric or imperial
  const steps = u === 'in' ? [IN_MM / 8, IN_MM / 4, IN_MM / 2, IN_MM, 6 * IN_MM, 12 * IN_MM, 60 * IN_MM] : [1, 5, 10, 50, 100, 500, 1000, 5000];
  const tick = steps.find(t => range / t <= 60) || steps[steps.length - 1];
  const lab = steps.find(t => t >= tick && range / t <= 6 && Math.abs(t / tick - Math.round(t / tick)) < 1e-6) || tick * 10;
  for (let i = 0; i * tick <= range + 1e-6; i++) {
    const v = i * tick, x = X + v * sc, isLab = Math.abs(v / lab - Math.round(v / lab)) < 1e-6;
    s += `<line x1="${x}" x2="${x}" y1="42" y2="${isLab ? 52 : 47}"/>`;
    if (isLab) s += `<text x="${x}" y="64">${num(v / UNIT_MM[u], 2)}${i === 0 ? '' : ' ' + u}</text>`;
  }
  s += `<line class="mark" x1="${X + cvMM * sc}" x2="${X + cvMM * sc}" y1="16" y2="54"/>`;
  $('#cvRuler').innerHTML = s;
}

/* colors & cable types editor */
const styleEl = $('#styleEditor'), cableTypeSel = $('#cableType'), unitSel = $('#unitSel');
function renderStyleEditor() {
  const used = {};
  doc.cables.forEach(c => (used[c.type] = (used[c.type] || 0) + 1));
  styleEl.innerHTML = '<div class="sub">Cable types</div>' +
    doc.settings.cableTypes.map(t => `<div class="trow" data-ct="${t.id}">
      <input type="color" data-ct-f="color" value="${t.color}" title="Color">
      <input data-ct-f="name" value="${esc(t.name)}" title="Name">
      <span class="muted" title="Cables of this type">${used[t.id] || 0}</span>
      <button class="icon" data-ct-act="del" title="Remove type">×</button></div>`).join('') +
    '<button class="small" data-ct-act="add">+ Add cable type</button>' +
    '<div class="sub">Equipment colors</div>' +
    CATS.map(([k, label]) => `<div class="trow"><input type="color" data-cat="${k}" value="${cssVar('--k-' + k)}"><span>${label}</span><span class="muted">${Object.values(TYPES).filter(t => t.cat === k).map(t => t.label).join(', ')}</span></div>`).join('') +
    '<button class="small" data-ct-act="resetCats">Reset equipment colors</button>';
  // toolbar cable type picker
  if (!doc.settings.cableTypes.some(t => t.id === ui.cableType)) ui.cableType = doc.settings.cableTypes[0].id;
  cableTypeSel.innerHTML = doc.settings.cableTypes.map(t => `<option value="${t.id}"${t.id === ui.cableType ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
  cableTypeSel.style.borderLeft = `4px solid ${ctype(ui.cableType).color}`;
}
styleEl.addEventListener('change', e => {
  const el = e.target, row = el.closest('[data-ct]');
  if (row && el.dataset.ctF) {
    const t = doc.settings.cableTypes.find(t => t.id === row.dataset.ct);
    const v = el.dataset.ctF === 'name' ? el.value.trim() || t.name : el.value;
    mutate(() => (t[el.dataset.ctF] = v));
  } else if (el.dataset.cat) {
    mutate(() => (doc.settings.catColors[el.dataset.cat] = el.value));
  }
});
styleEl.addEventListener('click', e => {
  const act = e.target.closest('[data-ct-act]')?.dataset.ctAct;
  if (!act) return;
  const types = doc.settings.cableTypes;
  if (act === 'add') {
    const t = { id: uid(), name: 'New type', color: NEW_TYPE_COLORS[types.length % NEW_TYPE_COLORS.length] };
    mutate(() => types.push(t));
    styleEl.querySelector(`[data-ct="${t.id}"] [data-ct-f="name"]`)?.select();
  } else if (act === 'del') {
    const id = e.target.closest('[data-ct]').dataset.ct, t = types.find(t => t.id === id);
    const n = doc.cables.filter(c => c.type === id).length;
    if (n) return toast(`${n} cable${n > 1 ? 's use' : ' uses'} “${t.name}”. Change ${n > 1 ? 'them' : 'it'} first`);
    if (types.length === 1) return toast('Keep at least one cable type');
    mutate(() => types.splice(types.indexOf(t), 1));
  } else if (act === 'resetCats') {
    mutate(() => (doc.settings.catColors = {}));
  }
});

/* ================= toolbar ================= */
$('#viewSeg').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) setView(b.dataset.view); });
$('#modeSeg').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });

cableTypeSel.addEventListener('change', () => { ui.cableType = cableTypeSel.value; renderStyleEditor(); hud(); });
$('#routeSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-route]');
  if (b) { doc.settings.route = b.dataset.route; save(); if (!ui.userMoved) fit(); renderAll(); }
});
unitSel.value = ui.unit;
unitSel.addEventListener('change', () => { doc.settings.unit = unitSel.value; save(); renderAll(); });
$('#fitBtn').addEventListener('click', () => { if (ui.view === '3d' && T.ready) frame3D(); else { fit(); draw2D(); } });
$('#zoomIn').addEventListener('click', () => zoomBy(1.25));
$('#zoomOut').addEventListener('click', () => zoomBy(0.8));
$('#undoBtn').addEventListener('click', undo);
$('#redoBtn').addEventListener('click', redo);

/* file menu */
const fileBtn = $('#fileBtn'), fileMenu = $('#fileMenu');
function showMenu(on) { fileMenu.hidden = !on; fileBtn.setAttribute('aria-expanded', on); }
fileBtn.addEventListener('click', e => { e.stopPropagation(); showMenu(fileMenu.hidden); });
document.addEventListener('click', e => { if (!fileMenu.hidden && !e.target.closest('.menu-wrap')) showMenu(false); });
fileMenu.addEventListener('click', e => { if (e.target.closest('#exportBtn, #importBtn')) showMenu(false); });

/* theme: auto -> light -> dark */
const themeBtn = $('#themeBtn');
let theme = 'auto';
try { theme = localStorage.getItem('rackviz.theme') || 'auto'; } catch (e) { /* ignore */ }
function applyTheme() {
  if (theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  themeBtn.querySelector('use').setAttribute('href', '#i-' + { auto: 'auto', light: 'sun', dark: 'moon' }[theme]);
  themeBtn.title = `Theme: ${theme === 'auto' ? 'match system' : theme} (click to change)`;
}
themeBtn.addEventListener('click', () => {
  theme = { auto: 'light', light: 'dark', dark: 'auto' }[theme];
  try { localStorage.setItem('rackviz.theme', theme); } catch (e) { /* ignore */ }
  applyTheme();
  renderAll();
  toast(`Theme: ${theme === 'auto' ? 'match system' : theme}`);
});
applyTheme();

/* help */
const helpDlg = $('#helpDlg');
$('#helpBtn').addEventListener('click', () => helpDlg.showModal());
helpDlg.addEventListener('click', e => { if (e.target === helpDlg || e.target.closest('[data-close]')) helpDlg.close(); });

/* empty state */
$('#emptyAdd').addEventListener('click', () => {
  const r = makeRack({ name: nextRackName(), units: 42, width: 600, depth: 1000 });
  ui.sel = { kind: 'rack', id: r.id }; ui.lastRack = r.id;
  mutate(() => doc.racks.push(r));
  fit(); draw2D();
});

/* collapsible sidebar sections remember their state */
for (const d of document.querySelectorAll('details.sec')) {
  try { const v = localStorage.getItem('rackviz.open.' + d.dataset.key); if (v != null) d.open = v === '1'; } catch (e) { /* ignore */ }
  d.addEventListener('toggle', () => { try { localStorage.setItem('rackviz.open.' + d.dataset.key, d.open ? '1' : '0'); } catch (e) { /* ignore */ } });
}
$('#exportBtn').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
  a.download = 'rack-layout.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
const importFile = $('#importFile');
$('#importBtn').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files[0]; importFile.value = '';
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!validDoc(d)) throw new Error('bad file');
    ui.sel = null;
    mutate(() => { doc = normalize(d); ensurePorts(); });
    unitSel.value = ui.unit; fit(); renderAll();
    if (T.ready) frame3D();
  } catch { toast('That file is not a rack layout'); }
});
$('#newBtn').addEventListener('click', e => {
  e.stopPropagation();
  const btn = e.currentTarget, lbl = btn.querySelector('span');
  const reset = () => { delete btn.dataset.armed; btn.classList.remove('armed'); lbl.textContent = 'New empty layout'; };
  if (!btn.dataset.armed) {
    btn.dataset.armed = '1'; btn.classList.add('armed'); lbl.textContent = 'Click again to clear everything';
    setTimeout(reset, 3000);
    return;
  }
  reset();
  showMenu(false);
  ui.sel = null; ui.pending = null; ui.measure = null;
  mutate(() => { const s = doc.settings; doc = blankDoc(); doc.settings = s; });
  fit(); renderAll();
});

document.addEventListener('keydown', e => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !typing && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); return redo(); }
  if ((e.ctrlKey || e.metaKey) && key === 'z' && !typing) { e.preventDefault(); return undo(); }
  if (e.key === 'Escape' && !fileMenu.hidden) return showMenu(false);
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') { ui.pending = null; ui.measure = null; ui.sel = null; renderAll(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
  else if (k === 'v') setMode('select');
  else if (k === 'c') setMode('connect');
  else if (k === 'm') setMode('measure');
  else if (k === 'f') $('#fitBtn').click();
  else if (e.key === '+' || e.key === '=') zoomBy(1.25);
  else if (e.key === '-' || e.key === '_') zoomBy(0.8);
  else if (e.key === '?') helpDlg.showModal();
  else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && ui.sel?.kind === 'device') {
    e.preventDefault();
    shiftDev(ui.sel.id, e.key === 'ArrowUp' ? 1 : -1);
  }
});

/* ================= render ================= */
function renderStage() {
  if (ui.view === '2d') draw2D(); else build3D();
  hud();
}
function renderAll() {
  if (ui.sel) {
    const ok = ui.sel.kind === 'device' ? findDev(ui.sel.id)
      : ui.sel.kind === 'rack' ? doc.racks.some(r => r.id === ui.sel.id)
      : doc.cables.some(c => c.id === ui.sel.id);
    if (!ok) ui.sel = null;
  }
  if (ui.pending && !findDev(ui.pending)) ui.pending = null;
  applyCatColors();
  for (const b of document.querySelectorAll('#routeSeg button')) b.classList.toggle('on', b.dataset.route === doc.settings.route);
  renderStyleEditor();
  renderRackList();
  renderProps();
  renderCableList();
  renderRackForm();
  drawConvRuler();
  renderLegend();
  $('#empty').hidden = doc.racks.length > 0;
  if (!doc.racks.length && rackForm.hidden === false) showRackForm(false);
  $('#undoBtn').disabled = !undoStack.length;
  $('#redoBtn').disabled = !redoStack.length;
  renderStage();
}
function renderLegend() {
  const n = {};
  doc.cables.forEach(c => (n[c.type] = (n[c.type] || 0) + 1));
  const el = $('#legend'), types = doc.settings.cableTypes.filter(t => n[t.id]);
  el.hidden = !types.length;
  el.innerHTML = types.map(t => `<span><i class="sw line" style="--c:${t.color}"></i>${esc(t.name)} <span class="muted">${n[t.id]}</span></span>`).join('');
}

new ResizeObserver(() => {
  if (!ui.userMoved) fit();
  if (ui.view === '2d') draw2D();
}).observe(stage);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll);

ensurePorts();
save();
applyPreset();
renderConverter();
renderAll();
