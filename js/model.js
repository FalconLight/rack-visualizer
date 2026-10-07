'use strict';
/* =====================================================================
   Rack Visualizer · model
   Constants, device catalogue, the saved document, rack geometry,
   ports, power analysis, cable labels and standard cable lengths.
   All lengths are in millimetres.
   ===================================================================== */

/* ---------- units & rack geometry ---------- */
const U_MM = 44.45, IN_MM = 25.4;
const PANEL_W = 482.6;                    // 19" front panel width
const BODY_W = 440;                       // typical chassis width
const FRAME_TOP = 60, FRAME_BOT = 80;     // rack structure above / below the rails
const RAIL_INSET = 60;                    // rails distance from front / rear of the rack
const ZERO_U_W = 22;                      // drawn width of a vertical (0U) PDU
const ZERO_U_MIN = 200;                   // shortest vertical PDU
const MIN_RACK_W = 540;                   // narrowest rack that leaves room for the rails and a vertical PDU
const PORT = 12, PITCH = 14, PORTS_PAD = 8; // port square, port spacing, right margin
const STORE_KEY = 'rackviz.v1';
const UNIT_MM = { mm: 1, cm: 10, in: IN_MM };

/* ---------- connectors ---------- */
const DATA_CONN = { rj45: 'RJ45', lc: 'LC', sc: 'SC', mpo: 'MPO', f: 'F (coax)', bnc: 'BNC' };
const UPLINK_TYPES = {
  rj45: { label: 'RJ45 1G', conn: 'rj45' },
  'rj45-10g': { label: 'RJ45 10G', conn: 'rj45' },
  sfp: { label: 'SFP 1G', conn: 'sfp' },
  'sfp+': { label: 'SFP+ 10G', conn: 'sfp' },
  sfp28: { label: 'SFP28 25G', conn: 'sfp' },
  'qsfp+': { label: 'QSFP+ 40G', conn: 'qsfp' },
  qsfp28: { label: 'QSFP28 100G', conn: 'qsfp' },
  'sc-pon': { label: 'SC/APC (PON)', conn: 'sc' },
  'f-coax': { label: 'F (coax)', conn: 'f' },
};
const POWER_CONN = { c13: 'C13 / C14', c19: 'C19 / C20', schuko: 'Schuko', nema: 'NEMA 5-15', iec309: 'IEC 60309' };
const OUTLET_NAME = { c13: 'C13', c19: 'C19', schuko: 'Schuko', nema: 'NEMA 5-15R', iec309: 'IEC 60309' };
const INLET_NAME = { c13: 'C14', c19: 'C20', schuko: 'Schuko plug', nema: 'NEMA 5-15P', iec309: 'IEC 60309' };

/* ---------- device catalogue ----------
   p/pc: data ports + connector · ul/ut: uplinks + type · pin/pinT: power inlets + connector family
   pout/poutT: outlets + connector family (poutBack: on the rear face) · w: watts · cap: capacity (W) · kg
   A field that is left out means the device doesn't have it; `custom` has all of them. */
const TYPES = {
  switch:    { label: 'Switch', h: 1, d: 300, cat: 'net', p: 24, pc: 'rj45', ul: 4, ut: 'sfp+', pin: 1, pinT: 'c13', w: 60, kg: 4 },
  router:    { label: 'Router', h: 1, d: 400, cat: 'net', p: 8, pc: 'rj45', ul: 2, ut: 'sfp+', pin: 1, pinT: 'c13', w: 45, kg: 5 },
  firewall:  { label: 'Firewall', h: 1, d: 400, cat: 'net', p: 8, pc: 'rj45', ul: 2, ut: 'sfp', pin: 1, pinT: 'c13', w: 50, kg: 5 },
  wlc:       { label: 'Wireless controller', h: 1, d: 300, cat: 'net', p: 8, pc: 'rj45', ul: 2, ut: 'sfp+', pin: 1, pinT: 'c13', w: 80, kg: 4 },
  mediaconv: { label: 'Media converter', h: 1, d: 200, cat: 'net', p: 8, pc: 'rj45', ul: 8, ut: 'sfp', pin: 1, pinT: 'c13', w: 30, kg: 3 },
  ont:       { label: 'ONT / modem', h: 1, d: 200, cat: 'net', p: 4, pc: 'rj45', ul: 1, ut: 'sc-pon', pin: 1, pinT: 'c13', w: 15, kg: 1 },
  pbx:       { label: 'PBX / VoIP gateway', h: 1, d: 350, cat: 'net', p: 8, pc: 'rj45', ul: 2, ut: 'rj45', pin: 1, pinT: 'c13', w: 60, kg: 5 },
  patch:     { label: 'Patch panel', h: 1, d: 120, cat: 'passive', p: 24, pc: 'rj45', kg: 1.5 },
  fiber:     { label: 'Fiber enclosure', h: 1, d: 250, cat: 'passive', p: 24, pc: 'lc', kg: 3 },
  odf:       { label: 'ODF (fiber frame)', h: 2, d: 300, cat: 'passive', p: 48, pc: 'sc', kg: 6 },
  manager:   { label: 'Cable manager', h: 1, d: 80, cat: 'passive', kg: 1, mgr: true },
  brush:     { label: 'Brush panel', h: 1, d: 40, cat: 'passive', kg: 0.8, mgr: true },
  blank:     { label: 'Blank panel', h: 1, d: 20, cat: 'passive', kg: 0.5 },
  server:    { label: 'Server', h: 2, d: 700, cat: 'compute', p: 4, pc: 'rj45', ul: 2, ut: 'sfp+', pin: 2, pinT: 'c13', w: 400, kg: 25 },
  storage:   { label: 'Storage', h: 2, d: 700, cat: 'compute', p: 4, pc: 'rj45', ul: 2, ut: 'sfp+', pin: 2, pinT: 'c13', w: 500, kg: 30 },
  nvr:       { label: 'NVR (CCTV)', h: 2, d: 450, cat: 'compute', p: 16, pc: 'rj45', ul: 1, ut: 'rj45', pin: 1, pinT: 'c13', w: 90, kg: 8 },
  kvm:       { label: 'KVM switch', h: 1, d: 250, cat: 'compute', p: 8, pc: 'rj45', ul: 1, ut: 'rj45', pin: 1, pinT: 'c13', w: 15, kg: 3 },
  monitor:   { label: 'Monitor drawer', h: 1, d: 600, cat: 'compute', p: 1, pc: 'rj45', pin: 1, pinT: 'c13', w: 30, kg: 12 },
  pdu:       { label: 'PDU', h: 1, d: 200, cat: 'power', pout: 8, poutT: 'c13', pin: 1, pinT: 'c19', cap: 3680, kg: 3 },
  vpdu:      { label: 'Vertical PDU (0U)', h: 0, d: 60, cat: 'power', zeroU: true, len: 1500, pout: 24, poutT: 'c13', pin: 1, pinT: 'c19', cap: 3680, kg: 5 },
  ups:       { label: 'UPS', h: 2, d: 600, cat: 'power', pout: 6, poutT: 'c13', poutBack: true, pin: 1, pinT: 'c19', cap: 1350, w: 60, kg: 25 },
  ats:       { label: 'Transfer switch (ATS)', h: 1, d: 250, cat: 'power', pout: 8, poutT: 'c13', poutBack: true, pin: 2, pinT: 'c19', cap: 3680, w: 10, kg: 4 },
  shelf:     { label: 'Shelf', h: 1, d: 450, cat: 'other', kg: 2 },
  kbd:       { label: 'Keyboard tray', h: 1, d: 400, cat: 'other', kg: 3 },
  fan:       { label: 'Fan tray', h: 1, d: 300, cat: 'other', pin: 1, pinT: 'c13', w: 40, kg: 3 },
  custom:    { label: 'Custom', h: 1, d: 300, cat: 'other', p: 0, pc: 'rj45', ul: 0, ut: 'rj45', pin: 0, pinT: 'c13', pout: 0, poutT: 'c13', w: 0, kg: 0 },
};
const CATS = [['net', 'Network'], ['passive', 'Passive'], ['compute', 'Compute & KVM'], ['power', 'Power'], ['other', 'Other']];
const DEV_FIELDS = ['ports', 'portType', 'uplinks', 'uplinkType', 'inlets', 'inletType', 'outlets', 'outletType',
  'watts', 'capacity', 'weight', 'color', 'half', 'feed', 'mains', 'spare', 'hostname', 'ip', 'serial', 'notes'];

/* fits: connector families a cable plugs into; kind keeps data and power apart */
const DEFAULT_CABLE_TYPES = [
  { id: 'utp', name: 'UTP', color: '#2f6fdf', kind: 'data', fits: ['rj45'] },
  { id: 'fiber', name: 'Fiber', color: '#e09a12', kind: 'data', fits: ['lc', 'sc', 'mpo', 'sfp', 'qsfp'] },
  { id: 'coax', name: 'Coax', color: '#8a8a8a', kind: 'data', fits: ['f', 'bnc'] },
  { id: 'dac', name: 'DAC', color: '#0891b2', kind: 'data', fits: ['sfp', 'qsfp'] },
  { id: 'c13', name: 'C13–C14', color: '#e11d48', kind: 'power', fits: ['c13'] },
  { id: 'c19', name: 'C19–C20', color: '#9333ea', kind: 'power', fits: ['c19'] },
  { id: 'schuko', name: 'Schuko', color: '#78716c', kind: 'power', fits: ['schuko'] },
  { id: 'nema', name: 'NEMA 5-15', color: '#0d9488', kind: 'power', fits: ['nema'] },
];
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
/* stock patch-cord / power-cord lengths */
const STD_LENGTHS = {
  metric: { data: [0.25, 0.5, 1, 1.5, 2, 3, 5, 7, 10, 15, 20].map(m => m * 1000), power: [0.6, 1, 1.5, 1.8, 2, 2.5, 3, 5].map(m => m * 1000) },
  imperial: { data: [1, 2, 3, 5, 7, 10, 14, 25, 50].map(f => f * 304.8), power: [2, 3, 4, 6, 8, 10, 15].map(f => f * 304.8) },
};

/* ---------- utils ---------- */
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
const fmtW = w => w >= 1000 ? (w / 1000).toFixed(2) + ' kW' : Math.round(w) + ' W';
const fmtKg = kg => (kg >= 100 ? Math.round(kg) : +kg.toFixed(1)) + ' kg';
const btu = w => Math.round(w * 3.412);
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const clip = (t, n) => t.length > n ? t.slice(0, Math.max(1, n - 1)) + '…' : t;

/* ---------- document ---------- */
function blankDoc() { return normalize({ racks: [], cables: [] }); }
function makeRack(o = {}) {
  return { id: uid(), name: o.name || 'Rack', code: o.code || '', units: o.units || 42, width: o.width || 600,
    depth: o.depth || 1000, channel: o.channel || 'both', devices: [] };
}
function makeDev(type, o = {}) {
  const t = TYPES[type] || TYPES.custom;
  const d = { id: uid(), type, name: o.name || t.label, h: t.zeroU ? 0 : (o.h || t.h), u: o.u || 1,
    depth: o.depth || t.d, mount: o.mount || (t.zeroU ? 'rear' : 'front') };
  if (t.zeroU) Object.assign(d, { side: o.side || 'left', offset: o.offset ?? 0, length: o.length || t.len });
  for (const k of DEV_FIELDS) if (o[k] !== undefined && o[k] !== '') d[k] = o[k];
  return d;
}
function demoDoc() {
  const d = blankDoc();
  const put = (r, type, u, o = {}) => { const v = makeDev(type, { u, ...o }); r.devices.push(v); return v; };
  const a = makeRack({ name: 'Rack A', units: 42 });
  const fo = put(a, 'fiber', 42);
  const p1 = put(a, 'patch', 41, { name: 'Patch panel 1' });
  put(a, 'manager', 40);
  const s1 = put(a, 'switch', 39, { name: 'Core switch', ports: 48, hostname: 'core-sw-01', ip: '10.0.0.2' });
  const p2 = put(a, 'patch', 38, { name: 'Patch panel 2' });
  put(a, 'manager', 37);
  const s2 = put(a, 'switch', 36, { name: 'Access switch', hostname: 'acc-sw-01', ip: '10.0.0.3' });
  const fw = put(a, 'firewall', 34, { hostname: 'fw-01', ip: '10.0.0.1' });
  const sv1 = put(a, 'server', 20, { name: 'Server 1', hostname: 'srv-01' });
  const sv2 = put(a, 'server', 18, { name: 'Server 2', hostname: 'srv-02' });
  const ups = put(a, 'ups', 2, { outletType: 'c19', mains: true });
  const pdu = put(a, 'pdu', 1, { mount: 'rear', name: 'PDU B', feed: 'B' });
  const vp = put(a, 'vpdu', 0, { name: 'PDU A', side: 'right', offset: 120, length: 1500, feed: 'A' });
  const b = makeRack({ name: 'Rack B', units: 24, depth: 800 });
  const p3 = put(b, 'patch', 24, { name: 'Coax panel', portType: 'f', ports: 12 });
  put(b, 'manager', 23);
  const s3 = put(b, 'switch', 22, { name: 'Edge switch' });
  const m = put(b, 'ont', 20, { name: 'Cable modem', uplinkType: 'f-coax' });
  const pb = put(b, 'pdu', 21, { mount: 'rear', name: 'PDU', mains: true });
  put(b, 'shelf', 15, { h: 2 });
  d.racks.push(a, b);
  const cab = (type, x, y, pa, pb_) => ({ id: uid(), type, a: x.id, b: y.id, pa, pb: pb_, label: '' });
  d.cables.push(
    cab('utp', p1, s1, 'p1', 'p1'), cab('utp', p1, s1, 'p2', 'p2'), cab('utp', p2, s2, 'p1', 'p1'),
    cab('fiber', fo, s1, 'p1', 'u1'), cab('fiber', s1, s3, 'u2', 'u1'), cab('coax', p3, m, 'p1', 'u1'), cab('utp', m, fw, 'p1', 'p1'),
    cab('c19', ups, vp, 'o1', 'i1'), cab('c19', ups, pdu, 'o2', 'i1'),
    cab('c13', vp, s1, 'o1', 'i1'), cab('c13', vp, s2, 'o2', 'i1'), cab('c13', vp, fw, 'o3', 'i1'),
    cab('c13', vp, sv1, 'o5', 'i1'), cab('c13', pdu, sv1, 'o1', 'i2'),
    cab('c13', vp, sv2, 'o6', 'i1'), cab('c13', pdu, sv2, 'o2', 'i2'),
    cab('c13', pb, s3, 'o1', 'i1'), cab('c13', pb, m, 'o2', 'i1'));
  return d;
}
function validDoc(d) { return d && Array.isArray(d.racks) && Array.isArray(d.cables); }
function normalize(d) {
  d.settings = { unit: 'cm', gap: 300, route: 'ortho', via: 'top', catColors: {}, labelPattern: '{rack}-U{u}-{port}',
    showLabels: false, templates: [], ...(d.settings || {}) };
  const types = Array.isArray(d.settings.cableTypes) ? d.settings.cableTypes.filter(t => t && typeof t === 'object') : [];
  for (const t of types) {
    const def = DEFAULT_CABLE_TYPES.find(x => x.id === t.id);
    t.kind ||= def?.kind || 'data';
    if (!t.fits && def) t.fits = [...def.fits];
  }
  if ((d.settings.typesVersion || 0) < 2) {   // add the power and DAC types once
    for (const def of DEFAULT_CABLE_TYPES) if (!types.some(t => t.id === def.id)) types.push({ ...def, fits: [...def.fits] });
    d.settings.typesVersion = 2;
  }
  d.settings.cableTypes = types;
  if (!Array.isArray(d.settings.templates)) d.settings.templates = [];
  d.racks = d.racks.filter(r => r && typeof r === 'object');
  for (const r of d.racks) r.devices = Array.isArray(r.devices) ? r.devices.filter(v => v && typeof v === 'object') : [];
  d.cables = d.cables.filter(c => c && typeof c === 'object');
  sanitize(d);
  return d;
}

/* Layouts can come from files other people made: everything that ends up in the page is
   checked here, so ids, colours and choices are always plain, known values. */
const ID_RE = /^[\w-]{1,40}$/, COLOR_RE = /^#[0-9a-f]{6}$/i, PORT_RE = /^[puio]\d{1,3}$/;
function sanitize(d) {
  const str = (v, max = 500) => (v == null ? '' : String(v).slice(0, max));
  const numOr = (v, def, lo = -Infinity, hi = Infinity) => (Number.isFinite(+v) && v !== '' && v !== null ? clamp(+v, lo, hi) : def);
  const pick = (v, list) => (list.includes(v) ? v : undefined);
  const color = v => (COLOR_RE.test(v) ? v : undefined);
  const setOpt = (o, k, v) => { if (v === undefined || v === '') delete o[k]; else o[k] = v; };
  /* fresh ids for missing, malformed or repeated ones; returns old → new */
  const fixIds = list => {
    const seen = new Set(), map = new Map();
    for (const o of list) {
      const old = o.id;
      const bad = typeof old !== 'string' || !ID_RE.test(old);
      if (bad || seen.has(old)) {   // references to a repeated id keep pointing at its first owner
        o.id = uid();
        if (bad && old != null && !map.has(String(old))) map.set(String(old), o.id);
      }
      seen.add(o.id);
    }
    return map;
  };
  const s = d.settings;
  s.unit = pick(s.unit, Object.keys(UNIT_MM)) || 'cm';
  s.route = pick(s.route, ['curve', 'ortho']) || 'ortho';
  s.via = pick(s.via, ['top', 'bottom']) || 'top';
  s.gap = numOr(s.gap, 300, 0, 20000);
  s.labelPattern = str(s.labelPattern, 100) || '{rack}-U{u}-{port}';
  s.showLabels = !!s.showLabels;
  const cats = {};
  for (const [k] of CATS) if (color(s.catColors?.[k])) cats[k] = s.catColors[k];
  s.catColors = cats;

  /* cable types: valid ids and colours, and at least one data and one power type */
  const typeMap = fixIds(s.cableTypes);
  for (const t of s.cableTypes) {
    t.kind = pick(t.kind, ['data', 'power']) || 'data';
    t.name = str(t.name, 60) || 'Cable';
    t.color = color(t.color) || '#888888';
    if (t.fits !== undefined) t.fits = Array.isArray(t.fits) ? t.fits.filter(f => typeof f === 'string' && ID_RE.test(f)) : [];
  }
  for (const kind of ['data', 'power']) {
    if (s.cableTypes.some(t => t.kind === kind)) continue;
    for (const def of DEFAULT_CABLE_TYPES.filter(t => t.kind === kind))
      s.cableTypes.push({ ...def, id: s.cableTypes.some(t => t.id === def.id) ? uid() : def.id, fits: [...def.fits] });
  }

  const cleanDev = v => {
    v.type = typeof v.type === 'string' && TYPES[v.type] ? v.type : 'custom';
    const t = TYPES[v.type];
    v.name = str(v.name, 120) || t.label;
    v.mount = pick(v.mount, ['front', 'rear']) || (t.zeroU ? 'rear' : 'front');
    v.h = t.zeroU ? 0 : Math.round(numOr(v.h, t.h, 1, 100));
    v.u = Math.round(numOr(v.u, 1, 0, 100));
    v.depth = numOr(v.depth, t.d, 5, 5000);
    if (t.zeroU) {
      v.side = pick(v.side, ['left', 'right']) || 'left';
      v.offset = numOr(v.offset, 0, 0, 100 * U_MM);
      v.length = numOr(v.length, t.len, ZERO_U_MIN, 100 * U_MM);
    }
    for (const [k, max] of [['ports', 96], ['uplinks', 16], ['inlets', 4], ['outlets', 48]]) setOpt(v, k, v[k] === undefined ? undefined : Math.round(numOr(v[k], 0, 0, max)));
    for (const k of ['watts', 'capacity', 'weight']) setOpt(v, k, v[k] === undefined ? undefined : numOr(v[k], 0, 0, 1e6));
    setOpt(v, 'portType', pick(v.portType, Object.keys(DATA_CONN)));
    setOpt(v, 'uplinkType', pick(v.uplinkType, Object.keys(UPLINK_TYPES)));
    setOpt(v, 'inletType', pick(v.inletType, Object.keys(POWER_CONN)));
    setOpt(v, 'outletType', pick(v.outletType, Object.keys(POWER_CONN)));
    setOpt(v, 'color', color(v.color));
    setOpt(v, 'half', pick(v.half, ['left', 'right']));
    setOpt(v, 'feed', pick(v.feed, ['A', 'B']));
    for (const k of ['mains', 'spare']) setOpt(v, k, v[k] === true || undefined);
    for (const k of ['hostname', 'ip', 'serial']) setOpt(v, k, v[k] === undefined ? undefined : str(v[k], 120));
    setOpt(v, 'notes', v.notes === undefined ? undefined : str(v.notes, 2000));
  };
  fixIds(d.racks);
  const devMap = fixIds(d.racks.flatMap(r => r.devices));
  for (const r of d.racks) {
    r.name = str(r.name, 80) || 'Rack';
    r.code = str(r.code, 20);
    r.units = Math.round(numOr(r.units, 42, 1, 100));
    r.width = numOr(r.width, 600, MIN_RACK_W, 5000);
    r.depth = numOr(r.depth, 1000, 2 * RAIL_INSET + 50, 5000);
    r.channel = pick(r.channel, ['both', 'left', 'right']) || 'both';
    setOpt(r, 'maxLoad', r.maxLoad === undefined ? undefined : numOr(r.maxLoad, 800, 0, 1e6));
    r.devices.forEach(cleanDev);
  }
  fixIds(d.cables);
  for (const c of d.cables) {
    for (const e of ['a', 'b']) if (devMap.has(c[e])) c[e] = devMap.get(c[e]);
    if (typeMap.has(c.type)) c.type = typeMap.get(c.type);
    c.type = s.cableTypes.some(t => t.id === c.type) ? c.type : pickTypeId(s.cableTypes, /^[io]/.test(c.pa) ? 'power' : 'data');
    for (const e of ['pa', 'pb']) c[e] = PORT_RE.test(c[e]) ? c[e] : '';
    c.label = str(c.label, 120);
    setOpt(c, 'notes', c.notes === undefined ? undefined : str(c.notes, 2000));
    setOpt(c, 'color', color(c.color));
    setOpt(c, 'via', pick(c.via, ['top', 'bottom']));
  }
  s.templates = s.templates.filter(t => t && typeof t === 'object' && t.fields && typeof t.fields === 'object');
  fixIds(s.templates);
  for (const t of s.templates) {
    t.name = str(t.name, 120) || 'Template';
    const v = { ...t.fields, type: t.type, name: t.name };
    cleanDev(v);
    t.type = v.type;
    delete v.type; delete v.name; delete v.u; delete v.id;
    if (!TYPES[t.type].zeroU) { delete v.side; delete v.offset; delete v.length; }
    t.fields = v;
  }
  /* saved "Tidy" orders: { face: { lane: [cable ids] } } */
  const ro = {};
  for (const face of ['front', 'rear']) {
    const src = d.routeOrder?.[face];
    if (!src || typeof src !== 'object') continue;
    ro[face] = {};
    for (const [k, v] of Object.entries(src)) if (Array.isArray(v)) ro[face][k] = v.filter(id => typeof id === 'string');
  }
  if (d.routeOrder) d.routeOrder = ro;
  /* network diagram: look (grid, snap, link style) and the positions of moved boxes, per layer */
  const net = s.net && typeof s.net === 'object' ? s.net : {};
  s.net = { grid: !!net.grid, snap: net.snap !== false, links: pick(net.links, ['curved', 'angled']) || 'curved' };
  const np = {};
  for (const layer of ['data', 'power']) {
    const src = d.netPos?.[layer];
    if (!src || typeof src !== 'object') continue;
    np[layer] = {};
    if (src['#flow'] === 'h') np[layer]['#flow'] = 'h';   // read left to right
    for (const [id, v] of Object.entries(src)) {
      const key = devMap.get(id) || id;
      if ((key === '#mains' || ID_RE.test(key)) && Array.isArray(v) && v.length === 2 && v.every(Number.isFinite))
        np[layer][key] = v.map(n => clamp(Math.round(n), -1e6, 1e6));
    }
  }
  if (Object.keys(np).length) d.netPos = np; else delete d.netPos;
  return d;
}
const pickTypeId = (types, kind) => (types.find(t => t.kind === kind) || types[0]).id;
function load() {
  try { const s = localStorage.getItem(STORE_KEY); if (s) { const d = JSON.parse(s); if (validDoc(d)) return normalize(d); } } catch (e) { /* ignore */ }
  return null;
}
let saveFailed = false;
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(doc)); saveFailed = false; }
  catch (e) {   // storage full or blocked: say so once, until saving works again
    if (!saveFailed && typeof toast === 'function') toast('⚠ Couldn’t save in this browser (storage full or blocked). Use File → Save layout to keep a copy');
    saveFailed = true;
  }
}

let doc = load() || demoDoc();
const ui = {
  view: '2d', face: 'front', mode: 'select', cableType: 'utp', sel: null, multi: new Set(), lastRack: null,
  pending: null, pendingPort: '', drag: null, pan: null, measure: null, marquee: null, hover: null, hoverPort: null,
  rewire: null, clip: null, cam: { x: 0, y: 0, k: 0.3 }, fitK: 0, userMoved: false,
  get unit() { return doc.settings.unit; },
};

/* undo entries: the document plus what was selected, so undo puts you back where you were */
const undoStack = [], redoStack = [];
const selNow = () => ({ sel: ui.sel && { ...ui.sel }, multi: [...ui.multi] });
const snapshot = (s = selNow()) => ({ doc: JSON.stringify(doc), ...s });
function pushUndo() {
  // the selection as last drawn: callers often pick the new selection just before mutating
  undoStack.push(snapshot(ui.shownSel || selNow()));
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}
function mutate(fn) {
  pushUndo();
  fn();
  save();
  renderAll();
}
/* display preferences aren't edits: undo and redo leave them as they are */
const VIEW_PREFS = ['unit', 'route', 'net'];
function restore(e) {
  const keep = Object.fromEntries(VIEW_PREFS.map(k => [k, doc.settings[k]]));
  doc = JSON.parse(e.doc);
  Object.assign(doc.settings, keep);
  ui.sel = e.sel; ui.multi = new Set(e.multi);   // renderAll drops whatever no longer exists
  save();
  renderAll();
}
function undo() {
  const e = undoStack.pop();
  if (!e) return toast('Nothing to undo');
  redoStack.push(snapshot());
  restore(e);
}
function redo() {
  const e = redoStack.pop();
  if (!e) return toast('Nothing to redo');
  undoStack.push(snapshot());
  restore(e);
}

/* ---------- device accessors (fall back to the catalogue) ---------- */
const T_ = d => TYPES[d.type] || TYPES.custom;
const isZeroU = d => !!T_(d).zeroU;
const isHalf = d => d.half === 'left' || d.half === 'right';
const isMgr = d => !!T_(d).mgr;
const hasData = d => T_(d).p != null;
const hasUp = d => T_(d).ul != null;
const hasIn = d => T_(d).pin != null;
const hasOut = d => T_(d).pout != null;
const nPorts = d => hasData(d) ? d.ports ?? T_(d).p : 0;
const nUplinks = d => hasUp(d) ? d.uplinks ?? T_(d).ul : 0;
const nInlets = d => hasIn(d) ? d.inlets ?? T_(d).pin : 0;
const nOutlets = d => hasOut(d) ? d.outlets ?? T_(d).pout : 0;
const portConn = d => d.portType ?? T_(d).pc ?? 'rj45';
const upType = d => d.uplinkType ?? T_(d).ut ?? 'sfp+';
const inletType = d => d.inletType ?? T_(d).pinT ?? 'c13';
const outletType = d => d.outletType ?? T_(d).poutT ?? 'c13';
const watts = d => +(d.watts ?? T_(d).w ?? 0);
const capacity = d => +(d.capacity ?? T_(d).cap ?? 0);
const weight = d => +(d.weight ?? T_(d).kg ?? 0);
const opp = s => (s === 'front' ? 'rear' : 'front');
const rackMaxLoad = r => +(r.maxLoad ?? (r.units <= 15 ? 60 : 800));
const devU = d => isZeroU(d) ? '0U' : d.h + 'U';
const zLen = d => Math.max(ZERO_U_MIN, d.length || T_(d).len);   // vertical PDU length, as drawn and as checked

/* ---------- geometry ---------- */
const rackH = r => r.units * U_MM + FRAME_TOP + FRAME_BOT;
const usableDepth = r => r.depth - 2 * RAIL_INSET;

/* front-view layout: every rack side by side, bottoms on the floor (y grows downwards) */
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
/* device rectangle in front-view coordinates */
function devRect(L, rack, d) {
  const R = L.racks[rack.id];
  if (isZeroU(d)) {
    // in the side channel, against the frame, clear of the rails and the U numbers
    const margin = (rack.width - PANEL_W) / 2 - 14;
    const w = Math.min(ZERO_U_W, Math.max(16, margin - 20));
    const total = rack.units * U_MM, len = clamp(zLen(d), ZERO_U_MIN, total);
    const off = clamp(d.offset || 0, 0, total - len);
    const x = d.side === 'right' ? R.x + rack.width - 3 - w : R.x + 3;
    return { x, y: R.railTop + off, w, h: len, vertical: true };
  }
  return { x: R.px + (d.half === 'right' ? PANEL_W / 2 : 0), y: R.railBottom - (d.u + d.h - 1) * U_MM,
    w: isHalf(d) ? PANEL_W / 2 : PANEL_W, h: d.h * U_MM };
}
function findDev(id) {
  for (const rack of doc.racks) { const dev = rack.devices.find(d => d.id === id); if (dev) return { rack, dev }; }
  return null;
}
const hspan = d => d.half === 'left' ? [0, 1] : d.half === 'right' ? [1, 2] : [0, 2];
/* why `d` can't sit where it is (or null); `ignore` skips devices that move together */
function conflict(rack, d, ignore = null) {
  if (isZeroU(d)) {
    const total = rack.units * U_MM, len = zLen(d), off = d.offset || 0;
    if (len > total + 0.5) return `Longer than the rails (${fmt(total)})`;
    if (off < -0.5 || off + len > total + 0.5) return 'Outside the rails';
    for (const o of rack.devices) {
      if (o.id === d.id || ignore?.has(o.id) || !isZeroU(o) || o.side !== d.side || o.mount !== d.mount) continue;
      const oo = o.offset || 0, ol = zLen(o);
      if (off < oo + ol && oo < off + len) return `Overlaps “${o.name}”`;
    }
    return null;
  }
  if (d.h < 1) return 'Height must be at least 1U';
  if (d.u < 1 || d.u + d.h - 1 > rack.units) return `Doesn't fit inside ${rack.name} (${rack.units}U)`;
  for (const o of rack.devices) {
    if (o.id === d.id || ignore?.has(o.id) || isZeroU(o)) continue;
    const overlap = d.u <= o.u + o.h - 1 && o.u <= d.u + d.h - 1;
    const [a0, a1] = hspan(d), [b0, b1] = hspan(o);
    if (overlap && a0 < b1 && b0 < a1 && (o.mount === d.mount || d.depth + o.depth > usableDepth(rack))) return `Overlaps “${o.name}”`;
  }
  return null;
}
function freeSlot(rack, d) {
  for (let u = rack.units - d.h + 1; u >= 1; u--) if (!conflict(rack, { ...d, u })) return u;
  return 0;
}
function nearestFree(rack, d, u0, maxDist = rack.units, ignore = null) {
  for (let k = 0; k <= maxDist; k++)
    for (const u of k ? [u0 + k, u0 - k] : [u0]) if (u >= 1 && !conflict(rack, { ...d, u }, ignore)) return u;
  return 0;
}
/* a free side position for a vertical PDU */
function freeZeroU(rack, d) {
  const total = rack.units * U_MM, len = Math.min(zLen(d), total);
  for (const side of [d.side || 'left', d.side === 'right' ? 'left' : 'right'])
    for (let off = 0; off + len <= total + 0.5; off += U_MM)
      if (!conflict(rack, { ...d, side, offset: off, length: len })) return { side, offset: off, length: len };
  return null;
}
function occupied(rack) {
  const s = new Set();
  rack.devices.forEach(d => { if (!isZeroU(d)) for (let i = 0; i < d.h; i++) s.add(d.u + i); });
  return s;
}
function usedU(rack) { return [...occupied(rack)].filter(u => u >= 1 && u <= rack.units).length; }
function largestFree(rack) {
  const occ = occupied(rack); let best = 0, cur = 0;
  for (let u = 1; u <= rack.units; u++) { if (occ.has(u)) cur = 0; else best = Math.max(best, ++cur); }
  return best;
}
function devWarn(rack, d) {
  return conflict(rack, d)
    || (!isZeroU(d) && d.depth > usableDepth(rack) ? `Deeper than the rack's usable depth (${fmt(usableDepth(rack))})` : null);
}
const rackWeight = r => r.devices.reduce((s, d) => s + weight(d), 0);

/* ---------- ports ----------
   keys: p# data port · u# uplink · i# power inlet · o# power outlet */
const portKind = k => (k && (k[0] === 'i' || k[0] === 'o') ? 'power' : 'data');
function portCount(d, c) { return c === 'p' ? nPorts(d) : c === 'u' ? nUplinks(d) : c === 'i' ? nInlets(d) : nOutlets(d); }
const validPort = (d, k) => { const n = +k.slice(1); return n >= 1 && n <= portCount(d, k[0]); };
/* which face of the rack a port is on */
function portSide(d, k) {
  if (isZeroU(d)) return d.mount;
  if (k[0] === 'i') return opp(d.mount);
  if (k[0] === 'o') return T_(d).poutBack ? opp(d.mount) : d.mount;
  return d.mount;
}
/* connector family, for cable compatibility */
function portConnector(d, k) {
  switch (k[0]) {
    case 'p': return portConn(d);
    case 'u': return UPLINK_TYPES[upType(d)]?.conn || 'sfp';
    case 'i': return inletType(d);
    default: return outletType(d);
  }
}
function connName(d, k) {
  switch (k[0]) {
    case 'p': return DATA_CONN[portConn(d)] || portConn(d);
    case 'u': return UPLINK_TYPES[upType(d)]?.label || upType(d);
    case 'i': return INLET_NAME[inletType(d)] + ' inlet';
    default: return OUTLET_NAME[outletType(d)] + ' outlet';
  }
}
function portLabel(d, k) {
  const n = k.slice(1);
  switch (k[0]) {
    case 'p': return `Port ${n}` + (portConn(d) !== 'rj45' ? ` (${DATA_CONN[portConn(d)]})` : '');
    case 'u': return `Uplink ${n} · ${UPLINK_TYPES[upType(d)]?.label || upType(d)}`;
    case 'i': return `Power inlet ${n} (${INLET_NAME[inletType(d)]})`;
    default: return `Outlet ${n} (${OUTLET_NAME[outletType(d)]})`;
  }
}
const portShort = k => ({ p: 'P', u: 'UL', i: 'PSU', o: 'O' }[k[0]] || '') + k.slice(1);
const fmtPort = k => (k ? ' ' + portShort(k) : '');
const portName = (d, k) => portLabel(d, k).replace(/ \(.*\)$/, '').toLowerCase();

/* how the ports of a horizontal device are laid out on its faces */
function portGrid(d) {
  const w = isHalf(d) ? PANEL_W / 2 : PANEL_W;
  const maxRows = Math.max(1, (d.h || 1) * 2), x0 = w < 300 ? 58 : 92;
  const n = nPorts(d), m = nUplinks(d), nO = nOutlets(d), nI = nInlets(d), oBack = !!T_(d).poutBack;
  const cols = room => Math.max(0, Math.floor((room + PITCH - PORT) / PITCH));
  const ur = Math.min(maxRows, m > 2 ? 2 : 1), upCols = m ? Math.ceil(m / ur) : 0;
  const upRoom = upCols ? upCols * PITCH + 10 : 0;
  const dCols = cols(w - x0 - PORTS_PAD - upRoom);
  const rows = n ? Math.min(maxRows, Math.ceil(n / Math.max(1, dCols))) : 0;
  const dataCols = rows ? Math.ceil(n / rows) : 0;
  const inRoom = nI ? nI * (PORT + 8) + 10 : 0;
  const ox0 = oBack ? x0 : x0 + (dataCols ? dataCols * PITCH + 12 : 0);
  const oCols = cols(w - ox0 - PORTS_PAD - (oBack ? inRoom : upRoom));
  const orows = nO ? Math.min(maxRows, Math.ceil(nO / Math.max(1, oCols))) : 0;
  return { w, x0, maxRows, ur, upCols, rows, ox0, orows, maxData: dCols * maxRows, maxOut: oCols * maxRows,
    fits: n <= dCols * maxRows && nO <= oCols * maxRows };
}
function zeroUFits(d) {
  const len = zLen(d), n = nOutlets(d);
  return n <= 1 || (len - 40 - 2 * PITCH - PORT) / (n - 1) >= PITCH;
}
/* every port of a device, in front-view coordinates, with the face it is on */
function portLayout(L, rack, d) {
  const b = devRect(L, rack, d), out = [];
  const place = (key, side, lx, y, extra) => out.push({ key, side, y, w: PORT, h: PORT,
    x: side === 'front' ? b.x + lx : b.x + b.w - lx - PORT, ...extra });
  if (b.vertical) {   // outlets in a column, the inlet near the bottom, all on the PDU's face
    const side = d.mount, lx = (b.w - PORT) / 2, nO = nOutlets(d), nI = nInlets(d);
    const step = nO > 1 ? Math.min(PITCH * 1.6, (b.h - 40 - 2 * PITCH - PORT) / (nO - 1)) : 0;
    for (let i = 0; i < nO; i++) place('o' + (i + 1), side, lx, b.y + 20 + i * step, { power: true });
    for (let j = 0; j < nI; j++) place('i' + (j + 1), side, lx, b.y + b.h - 20 - PORT - j * PITCH, { power: true });
    return out;
  }
  const g = portGrid(d), front = d.mount, back = opp(d.mount);
  const top = rows => b.y + (b.h - (rows * PITCH - (PITCH - PORT))) / 2;
  const grid = (prefix, n, rows, side, x0, extra) => {
    const y0 = top(rows);
    for (let i = 0; i < n; i++) place(prefix + (i + 1), side, x0 + Math.floor(i / rows) * PITCH, y0 + (i % rows) * PITCH, extra);
  };
  grid('p', nPorts(d), g.rows, front, g.x0);
  grid('u', nUplinks(d), g.ur, front, g.w - PORTS_PAD - g.upCols * PITCH + (PITCH - PORT), { up: true });
  grid('o', nOutlets(d), g.orows, T_(d).poutBack ? back : front, g.ox0, { power: true });
  const nI = nInlets(d), iy = top(1);   // power supplies at the right-hand end of the back
  for (let j = 0; j < nI; j++) place('i' + (j + 1), back, g.w - PORTS_PAD - PORT - (nI - 1 - j) * (PORT + 8), iy, { power: true });
  return out;
}
function portUse() {
  const m = {};
  for (const c of doc.cables) {
    if (c.pa) (m[c.a] ||= {})[c.pa] = c;
    if (c.pb) (m[c.b] ||= {})[c.pb] = c;
  }
  return m;
}
/* first free port: 'data' (ports then uplinks), 'o' (outlets) or 'i' (inlets) */
function firstFree(d, used = {}, cls = 'data') {
  for (const c of cls === 'data' ? ['p', 'u'] : [cls])
    for (let i = 1; i <= portCount(d, c); i++) if (!used[c + i]) return c + i;
  return '';
}
/* older layouts had cables without ports: plug them into free ports, drop the ones that can't fit */
function ensurePorts() {
  const use = portUse();
  doc.cables = doc.cables.filter(c => {
    const power = ctype(c.type).kind === 'power';
    for (const [end, key] of [['a', 'pa'], ['b', 'pb']]) {
      const f = findDev(c[end]); if (!f) return false;
      const used = use[c[end]] ||= {};
      if (c[key] && validPort(f.dev, c[key]) && used[c[key]] === c) continue;
      const k = firstFree(f.dev, used, power ? (end === 'a' ? 'o' : 'i') : 'data');
      if (!k) return false;
      c[key] = k; used[k] = c;
    }
    return true;
  });
}

/* ---------- cable types & compatibility ---------- */
const ctype = id => doc.settings.cableTypes.find(t => t.id === id) || { id, name: id, color: '#888888', kind: 'data' };
const cableColor = c => c.color || ctype(c.type).color;
/* problems with a cable (or null) */
function cableCheck(c) {
  const A = findDev(c.a), B = findDev(c.b), t = ctype(c.type);
  if (!A || !B || !c.pa || !c.pb) return null;
  const ka = portKind(c.pa), kb = portKind(c.pb);
  if (ka !== kb) return 'Joins a power port to a data port';
  if (t.kind && t.kind !== ka) return `${t.name} is a ${t.kind} cable on ${ka} ports`;
  if (ka === 'power' && !((c.pa[0] === 'o' && c.pb[0] === 'i') || (c.pa[0] === 'i' && c.pb[0] === 'o')))
    return 'Power cables go from an outlet to an inlet';
  if (t.fits?.length) {
    const bad = [[A.dev, c.pa], [B.dev, c.pb]].filter(([d, k]) => !t.fits.includes(portConnector(d, k)));
    if (bad.length) return `${t.name} doesn't fit ${bad.map(([d, k]) => `${d.name} (${connName(d, k)})`).join(' or ')}`;
  }
  return null;
}
/* the best cable type for joining two ports, preferring `pref` */
function pickCableType(pref, d1, k1, d2, k2) {
  const kind = portKind(k1), types = doc.settings.cableTypes;
  const fits = t => !t.fits?.length || (t.fits.includes(portConnector(d1, k1)) && (!d2 || t.fits.includes(portConnector(d2, k2))));
  const p = types.find(t => t.id === pref);
  if (p && p.kind === kind && fits(p)) return p.id;
  return (types.find(t => t.kind === kind && fits(t)) || (p?.kind === kind ? p : types.find(t => t.kind === kind)) || p)?.id;
}

/* ---------- labels ---------- */
function rackCode(r) {
  if (r.code) return r.code;
  const parts = r.name.trim().split(/\s+/);
  return /^rack$/i.test(parts[0]) && parts.length > 1 ? parts.slice(1).join('') : parts.map(p => p[0]).join('').toUpperCase();
}
function endLabel(devId, key) {
  const f = findDev(devId); if (!f) return '?';
  const u = isZeroU(f.dev) ? 'V' + (f.dev.side === 'right' ? 'R' : 'L') : f.dev.u;
  // function replacers, so a "$&" or "$1" in a name is kept as typed
  const tokens = { rack: rackCode(f.rack), u, port: portShort(key || ''), device: f.dev.name };
  return (doc.settings.labelPattern || '{rack}-U{u}-{port}').replace(/\{(rack|u|port|device)\}/g, (_, t) => tokens[t]);
}
const autoLabel = c => `${endLabel(c.a, c.pa)} ↔ ${endLabel(c.b, c.pb)}`;
const cableLabel = c => c.label || autoLabel(c);

/* ---------- standard lengths ---------- */
function stdLength(mm, kind = 'data') {
  const list = STD_LENGTHS[ui.unit === 'in' ? 'imperial' : 'metric'][kind === 'power' ? 'power' : 'data'];
  return list.find(x => x >= mm - 1) ?? null;
}
const fmtStd = mm => (ui.unit === 'in' ? `${Math.round(mm / 304.8)} ft` : `${+(mm / 1000).toFixed(2)} m`);

/* ---------- power ----------
   Follows power cables from outlets to inlets. A device with several connected power supplies
   shares its load between them normally, and puts all of it on one if the other feed fails. */
function powerModel() {
  const devs = {};
  for (const r of doc.racks) for (const d of r.devices) devs[d.id] = { rack: r, dev: d };
  const feeds = {}, children = {};
  for (const c of doc.cables) {
    if (portKind(c.pa) !== 'power' || portKind(c.pb) !== 'power') continue;
    let src, dst, inlet, outlet;
    if (c.pa[0] === 'o' && c.pb[0] === 'i') [src, dst, outlet, inlet] = [c.a, c.b, c.pa, c.pb];
    else if (c.pa[0] === 'i' && c.pb[0] === 'o') [src, dst, outlet, inlet] = [c.b, c.a, c.pb, c.pa];
    else continue;
    if (!devs[src] || !devs[dst]) continue;
    (feeds[dst] ||= []).push({ src, inlet, outlet, cable: c.id });
    (children[src] ||= new Set()).add(dst);
  }
  const memo = {};
  /* normal: own draw plus each child's share through this source */
  function load(id, stack = new Set()) {
    if (memo[id] != null) return memo[id];
    if (stack.has(id)) return 0;
    stack.add(id);
    let total = watts(devs[id].dev);
    for (const ch of children[id] || []) {
      const fs = feeds[ch], mine = fs.filter(f => f.src === id).length;
      total += load(ch, stack) * mine / fs.length;
    }
    stack.delete(id);
    return (memo[id] = total);
  }
  /* worst case: everything downstream lands on this source (each device counted once) */
  function reach(id, acc = new Set()) {
    for (const ch of children[id] || []) if (!acc.has(ch)) { acc.add(ch); reach(ch, acc); }
    return acc;
  }
  const worstLoad = id => [...reach(id)].reduce((s, x) => s + watts(devs[x].dev), 0);
  /* the feed a source belongs to: the nearest A/B label up the chain, else the top of the chain */
  function feedOf(id, seen = new Set()) {
    const d = devs[id].dev;
    if (d.feed) return 'feed ' + d.feed;
    const fs = feeds[id];
    if (!fs?.length || seen.has(id)) return d.name;
    seen.add(id);
    return feedOf(fs[0].src, seen);
  }
  const sources = Object.values(devs).filter(({ dev }) => nOutlets(dev) > 0).map(({ rack, dev }) => ({
    rack, dev, cap: capacity(dev),
    normal: load(dev.id) - watts(dev), worst: worstLoad(dev.id),
    used: Object.keys(portUse()[dev.id] || {}).filter(k => k[0] === 'o').length,
  }));
  const warnings = [], unpowered = [];
  for (const s of sources) {
    if (!s.cap) continue;
    if (s.normal > s.cap) warnings.push({ level: 'bad', id: s.dev.id, text: `${s.dev.name} is overloaded: ${fmtW(s.normal)} of ${fmtW(s.cap)}` });
    else if (s.worst > s.cap) warnings.push({ level: 'bad', id: s.dev.id, text: `${s.dev.name} would carry ${fmtW(s.worst)} if a feed fails, over its ${fmtW(s.cap)}` });
    else if (s.worst > 0.8 * s.cap) warnings.push({ level: 'warn', id: s.dev.id, text: `${s.dev.name} is above 80 % (${fmtW(s.worst)} of ${fmtW(s.cap)})` });
  }
  for (const { dev } of Object.values(devs)) {
    const n = nInlets(dev), fs = feeds[dev.id] || [];
    if (!n) continue;
    if (!fs.length) { if (watts(dev) > 0) unpowered.push(dev.id); continue; }
    if (n >= 2 && fs.length >= 2) {
      const keys = new Set(fs.map(f => feedOf(f.src)));
      if (keys.size === 1) warnings.push({ level: 'warn', id: dev.id, text: `${dev.name}: every power supply is on ${[...keys][0]}` });
    } else if (n >= 2 && fs.length < n) {
      warnings.push({ level: 'warn', id: dev.id, text: `${dev.name}: ${fs.length} of ${n} power supplies connected` });
    }
  }
  const racks = doc.racks.map(r => {
    const w = r.devices.reduce((s, d) => s + watts(d), 0);
    return { rack: r, watts: w, btu: btu(w), kg: rackWeight(r), maxKg: rackMaxLoad(r) };
  });
  for (const r of racks) if (r.kg > r.maxKg) warnings.push({ level: 'bad', rack: r.rack.id, text: `${r.rack.name} carries ${fmtKg(r.kg)}, over its ${fmtKg(r.maxKg)} limit` });
  return { devs, feeds, sources, warnings, unpowered, racks, feedOf, load };
}

/* ---------- connection check ----------
   Per device: power and data status, each 'ok' | 'partial' | 'none' | 'spare' | 'na' (nothing to connect),
   with the reason. Power follows the chain: it starts at sources marked "has building power" (mains)
   and reaches a device only through cabled outlets of live sources. */
function connectionModel(pm = powerModel()) {
  const use = portUse(), names = ids => [...new Set(ids)].map(id => `“${pm.devs[id].dev.name}”`).join(', ');
  /* live sources: walk the power cables forward from the mains-fed ones (loops can't make power) */
  const fedBy = {};
  for (const [dst, fs] of Object.entries(pm.feeds)) for (const f of fs) (fedBy[f.src] ||= []).push(dst);
  const live = new Set(Object.values(pm.devs).filter(({ dev }) => dev.mains && nOutlets(dev) > 0).map(({ dev }) => dev.id));
  for (const queue = [...live]; queue.length;)
    for (const dst of fedBy[queue.shift()] || []) if (!live.has(dst)) { live.add(dst); queue.push(dst); }

  const devs = {}, problems = [];
  for (const { rack, dev } of Object.values(pm.devs)) {
    const n = nInlets(dev), isSrc = nOutlets(dev) > 0, fs = pm.feeds[dev.id] || [];
    let power = 'na', pWhy = '';
    if (dev.mains && isSrc) { power = 'ok'; pWhy = 'Has building power'; }
    else if (n || isSrc) {
      const liveIn = new Set(fs.filter(f => live.has(f.src)).map(f => f.inlet)), need = Math.max(1, n);
      if (!fs.length) {
        power = 'none';
        pWhy = isSrc ? 'No input. Cable it to a source, or switch on “Has building power”'
          : n > 1 ? `None of its ${n} power supplies is connected` : 'Power inlet not connected';
      } else if (!liveIn.size) {
        power = 'none';
        const srcs = fs.map(f => f.src);
        pWhy = `Plugged into ${names(srcs)}, which ${new Set(srcs).size > 1 ? 'have' : 'has'} no power`;
      } else if (liveIn.size < need) {
        power = 'partial';
        const dead = new Set(fs.filter(f => !live.has(f.src)).map(f => f.src));
        pWhy = `${liveIn.size} of ${need} power supplies powered`
          + (dead.size ? ` (${names([...dead])} ${dead.size > 1 ? 'have' : 'has'} no power)` : '');
      } else { power = 'ok'; pWhy = `Powered from ${names(fs.map(f => f.src))}`; }
    }
    const nd = nPorts(dev) + nUplinks(dev);
    let data = 'na', dWhy = '';
    if (nd) {
      const used = Object.keys(use[dev.id] || {}).filter(k => k[0] === 'p' || k[0] === 'u');
      if (!used.length) { data = 'none'; dWhy = 'No data cables'; }
      else if (nUplinks(dev) && !used.some(k => k[0] === 'u')) { data = 'partial'; dWhy = `${used.length} of ${nd} data ports cabled, no uplink in use`; }
      else { data = 'ok'; dWhy = `${used.length} of ${nd} data ports cabled`; }
    }
    if (dev.spare) {
      if (power !== 'na') { power = 'spare'; pWhy = 'Spare: not checked'; }
      if (data !== 'na') { data = 'spare'; dWhy = 'Spare: not checked'; }
    }
    const level = power === 'none' || data === 'none' ? 'bad' : power === 'partial' || data === 'partial' ? 'warn' : null;
    devs[dev.id] = { power, pWhy, data, dWhy, level };
    if (level) problems.push({ id: dev.id, rack, dev, power, pWhy, data, dWhy, level });
  }
  const cableIssues = doc.cables.map(c => ({ c, why: cableCheck(c) })).filter(x => x.why);
  const all = Object.values(devs);
  return {
    devs, problems, cableIssues, live,
    checked: all.filter(d => (d.power !== 'na' || d.data !== 'na') && d.power !== 'spare' && d.data !== 'spare').length,
    spare: all.filter(d => d.power === 'spare' || d.data === 'spare').length,
    bad: problems.filter(p => p.level === 'bad').length, warn: problems.filter(p => p.level === 'warn').length,
  };
}
