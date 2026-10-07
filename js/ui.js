'use strict';
/* =====================================================================
   Rack Visualizer · interface
   Selection and editing, pointer interaction, side panels, search,
   toolbar, keyboard shortcuts and the render loop.
   ===================================================================== */

const propsEl = $('#props'), rackListEl = $('#rackList'), cableListEl = $('#cableList'), cableSumEl = $('#cableSum'), powerEl = $('#powerPanel');

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg; toastEl.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (toastEl.hidden = true), 2800);
}

/* ---------- updating panels in place ----------
   The panels are rebuilt from HTML after every change. Replacing them with innerHTML would also replace
   the field you are tabbing or clicking to (focus jumps to the page, and the click is lost). patchHTML
   updates the elements that are already there and only swaps the ones that really changed. */
const patchTpl = document.createElement('template');
function patchHTML(el, html) {
  patchTpl.innerHTML = html;
  patchChildren(el, patchTpl.content);
}
const sameNode = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName
  && (a.nodeType !== 1 || (a.getAttribute('data-id') === b.getAttribute('data-id') && a.getAttribute('type') === b.getAttribute('type')));
function patchChildren(cur, next) {
  const want = [...next.childNodes];
  want.forEach((n, i) => {
    const o = cur.childNodes[i];
    if (!o) cur.appendChild(n);
    else if (!sameNode(o, n)) cur.replaceChild(n, o);
    else if (o.nodeType === 1) patchEl(o, n);
    else if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue;
  });
  while (cur.childNodes.length > want.length) cur.lastChild.remove();
}
function patchEl(o, n) {
  for (const { name } of [...o.attributes])
    if (!n.hasAttribute(name) && !(name === 'open' && o.tagName === 'DETAILS')) o.removeAttribute(name);   // a section you opened stays open
  for (const { name, value } of n.attributes) if (o.getAttribute(name) !== value) o.setAttribute(name, value);
  const tag = o.tagName;
  if (tag === 'TEXTAREA') { if (o.value !== n.textContent) o.value = n.textContent; return; }
  const pick = tag === 'SELECT' ? (n.querySelector('option[selected]') || n.querySelector('option'))?.value : null;
  patchChildren(o, n);
  if (tag === 'SELECT') { if (pick != null && o.value !== pick) o.value = pick; }
  else if (tag === 'INPUT') {
    if (o.type === 'checkbox' || o.type === 'radio') o.checked = n.hasAttribute('checked');
    else { const v = n.getAttribute('value') ?? ''; if (o.value !== v) o.value = v; }
  }
}

/* ---------- colors ---------- */
const devColor = d => d.color || cssVar('--k-' + T_(d).cat);
function applyCatColors() {
  const st = document.documentElement.style;
  for (const [k] of CATS) {
    const v = doc.settings.catColors?.[k];
    if (v) st.setProperty('--k-' + k, v); else st.removeProperty('--k-' + k);
  }
}

/* ================= selection & actions ================= */
const isSel = (kind, id) => ui.sel?.kind === kind && ui.sel.id === id;
/* a field still being edited in Properties belongs to what is selected now: save it before that changes */
function commitEdit() {
  const a = document.activeElement;
  if (a && propsEl.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) a.blur();   // fires its change event
}
function select(kind, id) {
  commitEdit();
  ui.sel = kind ? { kind, id } : null;
  ui.multi.clear();
  if (kind === 'rack') ui.lastRack = id;
  if (kind === 'device') ui.lastRack = findDev(id)?.rack.id;
  renderAll();
}
const selectedDevIds = () => (ui.multi.size ? [...ui.multi] : ui.sel?.kind === 'device' ? [ui.sel.id] : []);
function setMulti(ids) {
  commitEdit();
  ui.multi = new Set(ids);
  if (ui.multi.size === 1) { ui.sel = { kind: 'device', id: ids[0] }; ui.multi.clear(); }
  else ui.sel = ui.multi.size ? { kind: 'device', id: [...ui.multi][0] } : null;
}
function toggleMulti(id) {
  commitEdit();
  const cur = new Set(selectedDevIds());
  if (cur.has(id)) cur.delete(id); else cur.add(id);
  setMulti([...cur]);
  if (ui.sel) ui.lastRack = findDev(ui.sel.id)?.rack.id;
  renderAll();
}
function targetRack() {
  return doc.racks.find(r => r.id === ui.lastRack) || doc.racks[0] || null;
}
function addDevice(type, rack = targetRack(), u = null, fields = {}) {
  if (!rack) return toast('Add a rack first');
  const d = makeDev(type, fields);
  if (isZeroU(d)) {
    const pos = freeZeroU(rack, d);
    if (!pos) return toast(`No free side space in ${rack.name} for a vertical PDU`);
    Object.assign(d, pos);
  } else if (u == null) {
    d.u = freeSlot(rack, d);
    if (!d.u) return toast(`No free ${d.h}U space in ${rack.name}`);
  } else {
    d.u = u;
    const err = conflict(rack, d);
    if (err) {   // dropped on something: take the nearest slot where it fits
      d.u = nearestFree(rack, d, clamp(u, 1, Math.max(1, rack.units - d.h + 1)));
      if (!d.u) return toast(err);
    }
  }
  ui.sel = { kind: 'device', id: d.id }; ui.multi.clear(); ui.lastRack = rack.id;
  mutate(() => rack.devices.push(d));
  if (ui.view === '2d' && d.mount !== ui.face) toast(`Added at the ${d.mount}. Press R to see the ${d.mount} view`);
}
/* apply drag targets: [{ id, rackId, patch }] */
function applyMoves(targets) {
  const changes = targets.filter(t => {
    const f = findDev(t.id);
    return f && (f.rack.id !== t.rackId || Object.entries(t.patch).some(([k, v]) => f.dev[k] !== v));
  });
  if (!changes.length) return;
  mutate(() => {
    for (const t of changes) {
      const f = findDev(t.id), to = doc.racks.find(r => r.id === t.rackId);
      Object.assign(f.dev, t.patch);
      if (f.rack !== to) { f.rack.devices.splice(f.rack.devices.indexOf(f.dev), 1); to.devices.push(f.dev); }
    }
  });
  ui.lastRack = targets[0].rackId;
}
function moveToRack(id, rackId) {
  const f = findDev(id), to = doc.racks.find(r => r.id === rackId);
  if (!f || !to) return;
  if (isZeroU(f.dev)) {
    const pos = freeZeroU(to, f.dev);
    if (!pos) return toast(`No free side space in ${to.name}`);
    return applyMoves([{ id, rackId, patch: pos }]);
  }
  const u = nearestFree(to, f.dev, clamp(f.dev.u, 1, to.units));
  if (!u) return toast(`No free ${f.dev.h}U space in ${to.name}`);
  applyMoves([{ id, rackId, patch: { u } }]);
}
/* a click on a device rather than on one of its ports (they are tiny until you zoom in) stands for its first free
   port that fits: the same kind as the cable already started (an outlet for an inlet), else one on this side */
function autoPort(id) {
  const f = findDev(id); if (!f) return '';
  const used = portUse()[id] || {}, ka = ui.pending && ui.pending !== id ? ui.pendingPort : null;
  const shown = new Set(portLayout(layout(), f.rack, f.dev).filter(p => p.side === ui.face).map(p => p.key));
  const keys = allPortKeys(f.dev).filter(k => !used[k]
    && (!ka || (portKind(k) === portKind(ka) && (portKind(k) !== 'power' || k[0] !== ka[0]))));
  return keys.find(k => shown.has(k)) || keys[0] || '';
}
function connectClick(id, port = '') {
  const dv = findDev(id).dev;
  const total = nPorts(dv) + nUplinks(dv) + nInlets(dv) + nOutlets(dv);
  if (!total) return toast(`“${dv.name}” has no ports. Set a port count first`);
  let picked = false;
  if (!port && ui.pending !== id) {
    port = autoPort(id); picked = !!port;
    if (!port) return toast(ui.pending ? `“${dv.name}” has no free port that fits this cable` : `“${dv.name}” has no free ports`);
  }
  if (!port) return toast('Click another device to finish the cable, or press Esc to cancel');
  if (portUse()[id]?.[port]) return toast(`${dv.name} ${portName(dv, port)} is already in use`);
  if (picked && !ui.pending) toast(`${dv.name} ${portName(dv, port)}, the first free one. Now click another device or one of its ports`);
  if (!ui.pending) { ui.pending = id; ui.pendingPort = port; return renderAll(); }
  if (ui.pending === id) {
    if (ui.pendingPort === port) { ui.pending = null; return renderAll(); }
    return toast('Pick a port on a different device');
  }
  const a = findDev(ui.pending).dev, ka = ui.pendingPort;
  if (portKind(ka) !== portKind(port)) return toast('Data ports connect to data ports, power outlets to power inlets');
  if (portKind(ka) === 'power' && ka[0] === port[0]) return toast(port[0] === 'o' ? 'Connect an outlet to a power inlet' : 'Connect a power inlet to an outlet');
  const type = pickCableType(ui.cableType, a, ka, dv, port);
  const c = { id: uid(), type, a: ui.pending, b: id, pa: ka, pb: port, label: '' };
  if (portKind(ka) === 'power' && ka[0] === 'i') Object.assign(c, { a: id, b: ui.pending, pa: port, pb: ka });   // power runs outlet → inlet
  ui.pending = null;
  ui.sel = { kind: 'cable', id: c.id }; ui.multi.clear();
  mutate(() => doc.cables.push(c));
  const warn = cableCheck(c);
  if (warn) toast('⚠ ' + warn);
  else if (type !== ui.cableType) toast(`Used a ${ctype(type).name} cable for these ports`);
  else if (picked) toast(`Connected to ${dv.name} ${portName(dv, port)}, its first free port. Change the ports in Properties`);
}
/* patch runs: the port pairs after cable c (P5→P5 gives P6→P6, P7→P7, …) while both are there and free */
function runPairs(c, max = 96) {
  const A = findDev(c.a)?.dev, B = findDev(c.b)?.dev, use = portUse(), out = [];
  if (!A || !B || !c.pa || !c.pb) return out;
  for (let i = 1; i <= max; i++) {
    const pa = c.pa[0] + (+c.pa.slice(1) + i), pb = c.pb[0] + (+c.pb.slice(1) + i);
    if (!validPort(A, pa) || !validPort(B, pb) || use[c.a]?.[pa] || use[c.b]?.[pb]) break;
    out.push([pa, pb]);
  }
  return out;
}
function continueRun(c, n) {
  const pairs = runPairs(c, n);
  if (!pairs.length) return toast('The next ports are taken or don’t exist');
  const keep = ['type', 'color', 'via'].filter(k => c[k] !== undefined);
  mutate(() => {
    for (const [pa, pb] of pairs) doc.cables.push({ id: uid(), a: c.a, b: c.b, pa, pb, label: '', ...Object.fromEntries(keep.map(k => [k, c[k]])) });
  });
  const A = findDev(c.a).dev, B = findDev(c.b).dev, last = pairs[pairs.length - 1];
  toast(`Added ${pairs.length} cable${pairs.length > 1 ? 's' : ''}: ${A.name} ${portShort(pairs[0][0])}–${portShort(last[0])} → ${B.name} ${portShort(pairs[0][1])}–${portShort(last[1])}`
    + (pairs.length < n ? ` (stopped at a port that is taken or missing)` : ''));
}
/* move devices up / down to the next position where all of them fit */
function shiftDevs(ids, dir) {
  const items = ids.map(findDev).filter(f => f && !isZeroU(f.dev));
  if (!items.length) return;
  const ignore = new Set(items.map(f => f.dev.id));
  for (let k = 1; k <= 100; k++) {
    const du = dir * k;
    if (items.some(f => f.dev.u + du < 1 || f.dev.u + du + f.dev.h - 1 > f.rack.units)) break;
    if (items.every(f => !conflict(f.rack, { ...f.dev, u: f.dev.u + du }, ignore)))
      return applyMoves(items.map(f => ({ id: f.dev.id, rackId: f.rack.id, patch: { u: f.dev.u + du } })));
  }
  toast(dir > 0 ? 'No free space above' : 'No free space below');
}
let armTimer;
function arm(id) { ui.armed = id; clearTimeout(armTimer); armTimer = setTimeout(() => (ui.armed = null), 3000); }
function deleteDevices(ids) {
  const set = new Set(ids);
  mutate(() => {
    for (const r of doc.racks) r.devices = r.devices.filter(d => !set.has(d.id));
    doc.cables = doc.cables.filter(c => !set.has(c.a) && !set.has(c.b));
  });
}
function deleteSel(force = false) {
  const s = ui.sel; if (!s) return;
  if (ui.multi.size > 1 || s.kind === 'device') {
    const ids = selectedDevIds();
    ui.multi.clear(); ui.sel = null;
    deleteDevices(ids);
    return ids.length > 1 && toast(`Deleted ${ids.length} devices`);
  }
  if (s.kind === 'rack') {
    const r = doc.racks.find(r => r.id === s.id); if (!r) return;
    if (r.devices.length && !force && ui.armed !== r.id) { arm(r.id); return toast(`Press Delete again to remove ${r.name} and its ${r.devices.length} device(s)`); }
    const ids = new Set(r.devices.map(d => d.id));
    ui.sel = null;
    mutate(() => {
      doc.racks.splice(doc.racks.indexOf(r), 1);
      doc.cables = doc.cables.filter(c => !ids.has(c.a) && !ids.has(c.b));
    });
  } else if (s.kind === 'cable') {
    ui.sel = null;
    mutate(() => (doc.cables = doc.cables.filter(c => c.id !== s.id)));
  }
}
/* copy / paste / duplicate devices */
function copySel() {
  const ids = selectedDevIds();
  if (!ids.length) return toast('Select devices to copy');
  ui.clip = ids.map(id => JSON.parse(JSON.stringify(findDev(id).dev)));
  toast(`Copied ${ids.length} device${ids.length > 1 ? 's' : ''}. Ctrl+V pastes into the selected rack`);
}
function placeCopies(pairs) {   // pairs: [{ src, rack }]
  const added = [];
  let skipped = 0;
  mutate(() => {
    for (const { src, rack } of pairs.sort((a, b) => b.src.u - a.src.u)) {
      const d = { ...JSON.parse(JSON.stringify(src)), id: uid() };
      if (isZeroU(d)) {
        const pos = freeZeroU(rack, d);
        if (!pos) { skipped++; continue; }
        Object.assign(d, pos);
      } else {
        const u = nearestFree(rack, d, clamp(d.u, 1, Math.max(1, rack.units - d.h + 1)));
        if (!u) { skipped++; continue; }
        d.u = u;
      }
      rack.devices.push(d);
      added.push(d.id);
    }
    setMulti(added);
  });
  toast(`${added.length ? `Added ${added.length} device${added.length > 1 ? 's' : ''}` : 'Nothing added'}${skipped ? `, ${skipped} didn't fit` : ''}`);
}
function pasteClip() {
  const rack = targetRack();
  if (!ui.clip?.length) return toast('Nothing to paste. Copy devices with Ctrl+C first');
  if (!rack) return toast('Add a rack first');
  placeCopies(ui.clip.map(src => ({ src, rack })));
}
function duplicateSel() {
  const ids = selectedDevIds();
  if (!ids.length) return toast('Select devices to duplicate');
  placeCopies(ids.map(findDev).map(f => ({ src: f.dev, rack: f.rack })));
}
function saveTemplate(dev) {
  const fields = { h: dev.h, depth: dev.depth, mount: dev.mount };
  if (isZeroU(dev)) fields.length = dev.length;
  for (const k of DEV_FIELDS) if (dev[k] !== undefined && !['hostname', 'ip', 'serial', 'notes', 'spare'].includes(k)) fields[k] = dev[k];
  const t = { id: uid(), name: dev.name, type: dev.type, fields };
  mutate(() => doc.settings.templates.push(t));
  toast(`Saved “${dev.name}” as a template in the equipment list`);
}

function syncToolbar() {
  const two = ui.view === '2d' && ui.pane !== 'net';
  $('#viewBar').hidden = !two;   // front / rear and how cables are drawn: options of the 2D view, shown on it
  $('#zoomLbl').hidden = !two;
  $('#tidyBtn').hidden = doc.settings.route !== 'ortho';
  $('#cableTypeWrap').hidden = ui.mode !== 'connect';
  stage.dataset.mode = ui.mode;
  markOn('#viewSeg [data-view]', 'view', ui.pane === 'net' ? null : ui.view);
  setOn($('#viewSeg [data-pane="net"]'), ui.pane === 'net');
  $('#splitBtn').setAttribute('aria-pressed', ui.pane === 'split');
  markOn('#faceSeg button', 'face', ui.face);
  markOn('#routeSeg button', 'route', doc.settings.route);
  markOn('#modeSeg button', 'mode', ui.mode);
}
function setMode(m) {
  ui.mode = m; ui.pending = null;
  if (m !== 'measure') ui.measure = null;
  syncToolbar();
  renderStage();
}
function setView(v) {
  ui.view = v;
  svg.toggleAttribute('hidden', v !== '2d');
  threeEl.hidden = v !== '3d';
  syncToolbar();
  if (v === '3d' && ui.pane !== 'net' && init3D()) { resize3D(); build3D(); if (!T.framed) { frame3D(); T.framed = true; } }
  renderStage();
}
/* side panels: either can be hidden for more room; both remember it */
const mainEl = $('main'), PANEL_NAME = { left: 'racks and equipment panel ([)', right: 'properties panel (])' };
ui.panels = { left: true, right: true };
try { const p = JSON.parse(localStorage.getItem('rackviz.panels') || '{}'); for (const k of ['left', 'right']) if (typeof p[k] === 'boolean') ui.panels[k] = p[k]; } catch (e) { /* ignore */ }
function setPanel(side, open) {
  ui.panels[side] = open;
  mainEl.classList.toggle('no-' + side, !open);
  for (const b of document.querySelectorAll(`[data-panel="${side}"]`)) {
    b.setAttribute('aria-expanded', open);
    if (b.classList.contains('edge-tab')) { b.title = (open ? 'Hide the ' : 'Show the ') + PANEL_NAME[side]; b.setAttribute('aria-label', b.title); }
  }
  try { localStorage.setItem('rackviz.panels', JSON.stringify(ui.panels)); } catch (e) { /* ignore */ }
}
document.addEventListener('click', e => { const b = e.target.closest('[data-panel]'); if (b) setPanel(b.dataset.panel, !ui.panels[b.dataset.panel]); });
setPanel('left', ui.panels.left);
setPanel('right', ui.panels.right);
/* double-click (or double-tap, or Enter) anything to see its properties: opens the right panel at the top.
   The first click has already selected what was clicked, so that is what opens. Detected by hand: the
   views redraw on that first click, and the browser drops its own dblclick when the element under the
   pointer is replaced in between. */
function openDetails() {
  if (!ui.sel && !ui.multi.size) return;
  setPanel('right', true);
  const smooth = matchMedia('(max-width: 900px)').matches && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('.props-sec').scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
}
function onDoubleClick(el, fn) {
  let down = null, last = null;
  el.addEventListener('pointerdown', e => { down = e.button === 0 ? { x: e.clientX, y: e.clientY } : null; });
  el.addEventListener('pointerup', e => {
    const click = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 5;   // not a drag or a pan
    down = null;
    if (!click) { last = null; return; }
    const dbl = last && e.timeStamp - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 8;
    last = dbl ? null : { t: e.timeStamp, x: e.clientX, y: e.clientY };
    if (dbl) fn();
  });
}
onDoubleClick(svg, () => { if (ui.mode === 'select') openDetails(); });   // not while drawing cables or measuring
onDoubleClick(netSvg, openDetails);
onDoubleClick(threeEl, openDetails);
onDoubleClick(rackListEl, openDetails);

/* what the middle of the screen shows: the racks, the network diagram, or both side by side */
const viewsEl = $('#views');
function setPane(p) {
  ui.pane = p;
  try { localStorage.setItem('rackviz.pane', p); } catch (e) { /* ignore */ }
  viewsEl.classList.toggle('split', p === 'split');
  stage.hidden = p === 'net';
  netPane.hidden = p === 'racks';
  $('#splitter').hidden = p !== 'split';
  syncToolbar();
  if (p !== 'net') setView(ui.view);   // also starts the 3D view if that is the one showing
  if (p !== 'racks') { ui.net.userMoved = false; drawNet(); }
  hud();
}
function setSplit(r) {
  ui.splitAt = clamp(r, 0.2, 0.8);
  viewsEl.style.setProperty('--split', ui.splitAt * 100 + '%');
}
try { ui.pane = ['racks', 'net', 'split'].includes(localStorage.getItem('rackviz.pane')) ? localStorage.getItem('rackviz.pane') : 'racks'; } catch (e) { ui.pane = 'racks'; }
try { setSplit(+localStorage.getItem('rackviz.splitAt') || 0.5); } catch (e) { setSplit(0.5); }
/* the divider between the two views: drag (or arrow keys) to resize, double-click for half and half */
const splitterEl = $('#splitter');
splitterEl.addEventListener('pointerdown', e => {
  splitterEl.setPointerCapture(e.pointerId);
  const move = ev => {
    const r = viewsEl.getBoundingClientRect(), column = getComputedStyle(viewsEl).flexDirection === 'column';
    setSplit(column ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width);
  };
  const up = () => {
    splitterEl.removeEventListener('pointermove', move); splitterEl.removeEventListener('pointerup', up);
    try { localStorage.setItem('rackviz.splitAt', ui.splitAt); } catch (err) { /* ignore */ }
  };
  splitterEl.addEventListener('pointermove', move); splitterEl.addEventListener('pointerup', up);
});
splitterEl.addEventListener('dblclick', () => { setSplit(0.5); try { localStorage.setItem('rackviz.splitAt', 0.5); } catch (e) { /* ignore */ } });
splitterEl.addEventListener('keydown', e => {
  const d = { ArrowLeft: -0.05, ArrowUp: -0.05, ArrowRight: 0.05, ArrowDown: 0.05 }[e.key];
  if (!d) return;
  e.preventDefault(); e.stopPropagation();
  setSplit(ui.splitAt + d);
  try { localStorage.setItem('rackviz.splitAt', ui.splitAt); } catch (err) { /* ignore */ }
});
function setFace(f) {
  ui.face = f; ui.pending = null; ui.measure = null;
  cancelRewire();
  syncToolbar();
  renderStage();
}

/* ================= pointer interaction (2D) ================= */
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
      ui.drag = null; ui.pan = null; ui.marquee = null; cancelRewire();
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
  let devEl = e.target.closest('[data-dev]');
  const cabEl = e.target.closest('[data-cable]'), rackEl = e.target.closest('[data-rack]');

  if (ui.mode === 'measure') {
    ui.measure = { a: p, b: p, active: true };
    capture(e);
    return schedule(true);
  }
  if (ui.mode === 'connect') {
    if (devEl) connectClick(devEl.dataset.dev, e.target.closest('[data-port]')?.dataset.port || '');
    else if (ui.pending) { ui.pending = null; renderAll(); }
    else startPan();
    return;
  }
  // a cable drawn across a device: dragging moves the device, a plain click still selects the cable
  let usedPt = e.target.closest('.pt.used'), viaCable = null;
  if (cabEl && e.target.classList.contains('cable-hit')) {
    const under = document.elementsFromPoint(e.clientX, e.clientY).find(el => el.closest('[data-dev]'));
    if (under) { viaCable = cabEl.dataset.cable; devEl = under.closest('[data-dev]'); usedPt = under.closest('.pt.used'); }
  }
  // grab a cable end: a handle on the selected cable, or a plugged-in port
  const endEl = e.target.closest('[data-end]');
  let grab = endEl && { cid: endEl.dataset.cid, end: endEl.dataset.end };
  if (!grab && usedPt && devEl && !e.shiftKey) {
    const dev = devEl.dataset.dev, key = usedPt.dataset.port, c = portUse()[dev]?.[key];
    if (c) grab = { cid: c.id, end: c.a === dev && c.pa === key ? 'a' : 'b' };
  }
  if (grab) {
    ui.rewire = { ...grab, click: viaCable, sx: e.clientX, sy: e.clientY, moved: false, target: null };
    stage.classList.add('rewiring');
    capture(e);
    return;
  }
  if (devEl) {
    const id = devEl.dataset.dev;
    if (e.shiftKey || e.ctrlKey || e.metaKey) return toggleMulti(id);
    const f = findDev(id), b = devRect(layout(), f.rack, f.dev);
    const group = ui.multi.size > 1 && ui.multi.has(id) ? [...ui.multi] : [id];
    ui.drag = { ids: group, primary: id, click: viaCable, offY: p.y - b.y, sx: e.clientX, sy: e.clientY, moved: false, targets: null, err: null };
    capture(e);
    if (viaCable) return;   // decided on release: a drag selects the device, a click the cable
    if (group.length === 1) return select('device', id);
    ui.sel = { kind: 'device', id };
    return renderAll();
  }
  if (cabEl) return select('cable', cabEl.dataset.cable);
  if (e.shiftKey) {   // box select
    ui.marquee = { a: p, b: p, add: e.ctrlKey || e.metaKey, sx: e.clientX, sy: e.clientY };
    capture(e);
    return schedule(true);
  }
  if (rackEl) select('rack', rackEl.dataset.rack);
  else if (ui.sel || ui.multi.size) select(null);
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
  ui.hoverDev = e.target.closest?.('[data-dev]')?.dataset.dev || null;
  let light = true;   // most moves only touch the camera or the overlays
  if (ui.pan) {
    ui.cam.x = ui.pan.cx + e.clientX - ui.pan.sx;
    ui.cam.y = ui.pan.cy + e.clientY - ui.pan.sy;
    ui.userMoved = true;
  } else if (ui.rewire) {
    if (!ui.rewire.moved && Math.hypot(e.clientX - ui.rewire.sx, e.clientY - ui.rewire.sy) < 4) return;
    const was = ui.rewire.target, now = rewireTarget(e);
    // the scene shows the ghosted cable and the highlighted drop port: redraw it when those change
    light = ui.rewire.moved && was?.dev === now?.dev && was?.key === now?.key && was?.err === now?.err;
    ui.rewire.moved = true;
    ui.rewire.target = now;
  } else if (ui.drag) {
    if (!ui.drag.moved && Math.hypot(e.clientX - ui.drag.sx, e.clientY - ui.drag.sy) < 4) return;
    if (!ui.drag.moved && ui.drag.click) {   // started on a cable over the device: now it's a device drag
      ui.drag.click = null;
      if (ui.drag.ids.length === 1) select('device', ui.drag.primary); else { ui.sel = { kind: 'device', id: ui.drag.primary }; renderAll(); }
    }
    light = ui.drag.moved;   // the first move marks the dragged devices; after that only the ghost moves
    ui.drag.moved = true;
    dragTargets(p);
  } else if (ui.marquee) {
    ui.marquee.b = p;
  } else if (ui.measure?.active) {
    ui.measure.b = p;
  }
  schedule(light);
});
/* where the dragged device(s) would land */
function dragTargets(p) {
  const L = layout(), D = ui.drag, f = findDev(D.primary), fx = frontX(L, p.x);
  if (!f) return;
  if (isZeroU(f.dev)) {
    const rack = rackAtX(L, fx, true), R = L.racks[rack.id];
    const len = Math.min(zLen(f.dev), rack.units * U_MM);
    const patch = { side: fx < R.x + rack.width / 2 ? 'left' : 'right', length: len,
      offset: clamp(Math.round((p.y - D.offY - R.railTop) / U_MM) * U_MM, 0, rack.units * U_MM - len) };
    D.targets = [{ id: f.dev.id, rackId: rack.id, patch }];
    D.err = conflict(rack, { ...f.dev, ...patch });
    return;
  }
  if (D.ids.length === 1) {
    const rack = rackAtX(L, fx, true), R = L.racks[rack.id], patch = {};
    if (isHalf(f.dev)) patch.half = fx < R.px + PANEL_W / 2 ? 'left' : 'right';
    const cand = { ...f.dev, ...patch };
    let u = uFromTop(R, rack, p.y - D.offY, f.dev.h), err = conflict(rack, { ...cand, u });
    if (err) { const n = nearestFree(rack, cand, u, f.dev.h + 2); if (n) { u = n; err = null; } }
    patch.u = u;
    D.targets = [{ id: f.dev.id, rackId: rack.id, patch }];
    D.err = err;
    return;
  }
  // a group moves up or down together; every device stays in its own rack
  const ignore = new Set(D.ids), R = L.racks[f.rack.id];
  const du = uFromTop(R, f.rack, p.y - D.offY, f.dev.h) - f.dev.u;
  D.targets = []; D.err = null;
  for (const id of D.ids) {
    const g = findDev(id);
    if (!g || isZeroU(g.dev)) continue;
    const patch = { u: g.dev.u + du };
    D.targets.push({ id, rackId: g.rack.id, patch });
    D.err ||= conflict(g.rack, { ...g.dev, ...patch }, ignore);
  }
}
/* moving a cable end to another port */
function rewireTarget(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-port]');
  if (!el) return null;
  const dev = el.closest('[data-dev]').dataset.dev, key = el.dataset.port, { cid, end } = ui.rewire;
  const c = doc.cables.find(c => c.id === cid), cur = c['p' + end], busy = portUse()[dev]?.[key];
  const d = findDev(dev).dev;
  const err = dev === (end === 'a' ? c.b : c.a) ? 'A cable needs two different devices'
    : portKind(key) !== portKind(cur) ? (portKind(cur) === 'power' ? 'A power cable needs a power port' : 'A data cable needs a data port')
    : portKind(key) === 'power' && key[0] !== cur[0] ? (cur[0] === 'o' ? 'Move it to another outlet' : 'Move it to another power inlet')
    : busy && busy !== c ? `${d.name} ${portName(d, key)} is already in use` : null;
  return { dev, key, err };
}
function cancelRewire() {
  ui.rewire = null;
  stage.classList.remove('rewiring');
}
function finishRewire() {
  const r = ui.rewire;
  cancelRewire();
  if (!r.moved) return select('cable', r.click || r.cid);
  const t = r.target, c = doc.cables.find(c => c.id === r.cid);
  if (t?.err) toast(t.err);
  else if (t && c && !(c[r.end] === t.dev && c['p' + r.end] === t.key)) {
    ui.sel = { kind: 'cable', id: c.id };
    mutate(() => { c[r.end] = t.dev; c['p' + r.end] = t.key; });
    const d = findDev(t.dev).dev, warn = cableCheck(c);
    return toast(warn ? '⚠ ' + warn : `Moved to ${d.name} ${portName(d, t.key)}`);
  }
  renderAll();
}
function finishMarquee() {
  const { a, b, add, sx, sy } = ui.marquee, L = layout();
  ui.marquee = null;
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const hits = [];
  for (const r of doc.racks) for (const d of r.devices) {
    const rb = devRect(L, r, d), vx = ui.face === 'rear' ? L.w - rb.x - rb.w : rb.x;
    if (vx < x1 && vx + rb.w > x0 && rb.y < y1 && rb.y + rb.h > y0) hits.push(d.id);
  }
  setMulti(add ? [...new Set([...selectedDevIds(), ...hits])] : hits);
  if (ui.sel) ui.lastRack = findDev(ui.sel.id)?.rack.id;
  renderAll();
  if (hits.length > 1) toast(`${ui.multi.size} devices selected`);
}
function endPointer(e) {
  touches.delete(e?.pointerId);
  if (pinch) { if (touches.size < 2) pinch = null; ui.pan = null; return; }
  if (ui.rewire) return finishRewire();
  if (ui.marquee) return finishMarquee();
  if (ui.drag) {
    const D = ui.drag; ui.drag = null;
    if (!D.moved && D.click) return select('cable', D.click);
    if (D.moved && D.targets?.length) { if (D.err) toast(D.err); else applyMoves(D.targets); }
    renderAll();
  }
  ui.pan = null;
  if (ui.measure) ui.measure.active = false;
  schedule();
}
svg.addEventListener('pointerup', endPointer);
svg.addEventListener('pointercancel', endPointer);
svg.addEventListener('pointerleave', () => { if (!ui.drag && !ui.pan && !ui.rewire && !ui.marquee) { ui.hover = ui.hoverDev = ui.hoverPort = null; schedule(true); } });
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

/* drop from the equipment list */
svg.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/x-rack-type')) e.preventDefault(); });
svg.addEventListener('drop', e => {
  const data = e.dataTransfer.getData('text/x-rack-type');
  if (!data) return;
  e.preventDefault();
  const L = layout(), p = toWorld(e), rack = rackAtX(L, frontX(L, p.x));
  if (!rack) return toast('Drop it onto a rack');
  const [type, tid] = data.split(':'), tpl = tid && doc.settings.templates.find(t => t.id === tid);
  const fields = tpl ? { ...tpl.fields, name: tpl.name } : { mount: TYPES[type].zeroU ? 'rear' : ui.face };
  const h = tpl?.fields.h || TYPES[type].h;
  if (TYPES[type].zeroU) return addDevice(type, rack, null, fields);
  addDevice(type, rack, uFromTop(L.racks[rack.id], rack, p.y - h * U_MM / 2, h), fields);
});

/* ================= side panels ================= */
function renderRackList() {
  const pm = ui.power;
  const hasSel = r => isSel('rack', r.id) || selectedDevIds().some(id => findDev(id)?.rack === r);
  const tab = (doc.racks.find(hasSel) || doc.racks[0])?.id;   // the one row in the tab order (arrow keys reach the others)
  rackListEl.setAttribute('role', doc.racks.length ? 'listbox' : 'none');
  patchHTML(rackListEl, doc.racks.length ? doc.racks.map(r => {
    const sel = hasSel(r);
    const used = usedU(r), pct = Math.round(used / r.units * 100), info = pm.racks.find(x => x.rack === r);
    const heavy = info.kg > info.maxKg;
    return `<div class="item rack-item${sel ? ' sel' : ''}" role="option" aria-selected="${isSel('rack', r.id)}" tabindex="${r.id === tab ? 0 : -1}" data-id="${r.id}" draggable="true" title="${used} of ${r.units}U used (${pct} %) · ${fmtW(info.watts)} · ${fmtKg(info.kg)} · drag to reorder">
      <div class="ri-top"><span class="grow">${esc(r.name)}${heavy ? ' <span class="warn-dot" title="Over its weight limit">⚠</span><span class="sr-only">, over its weight limit</span>' : ''}</span><span class="muted">${used}/${r.units}U</span></div>
      <div class="meter" aria-hidden="true"><i class="${pct >= 90 ? 'full' : ''}" style="width:${pct}%"></i></div></div>`;
  }).join('') : '<div class="empty">No racks yet.</div>');
}
rackListEl.addEventListener('click', e => { const it = e.target.closest('[data-id]'); if (it) select('rack', it.dataset.id); });
/* a list you can walk with the keyboard (the listbox pattern): arrows move and select, Enter or Space opens the
   properties, Home / End jump to the ends. move(option, -1 | 1) handles Alt + arrow when the list can be reordered. */
function listboxKeys(list, pick, move) {
  list.addEventListener('keydown', e => {
    const opt = e.target.closest('[role="option"]');
    if (!opt || e.ctrlKey || e.metaKey) return;
    const opts = [...list.querySelectorAll('[role="option"]')], i = opts.indexOf(opt);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: opts.length - 1 }[e.key];
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); return pick(opt, true); }
    if (to === undefined) return;
    e.preventDefault(); e.stopPropagation();   // not the app's shortcuts (the arrows move devices)
    if (e.altKey) { if (move && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) move(opt, e.key === 'ArrowUp' ? -1 : 1); return; }
    const t = opts[clamp(to, 0, opts.length - 1)];
    if (t && t !== opt) { t.focus(); pick(t, false); }
  });
}
listboxKeys(rackListEl, (opt, open) => { select('rack', opt.dataset.id); if (open) openDetails(); }, (opt, dir) => {
  const id = opt.dataset.id, i = doc.racks.findIndex(r => r.id === id), j = i + dir;
  if (j < 0 || j >= doc.racks.length) return;
  mutate(() => doc.racks.splice(j, 0, doc.racks.splice(i, 1)[0]));
  rackListEl.querySelector(`[data-id="${id}"]`)?.focus();
  toast(`${doc.racks[j].name} is now ${j + 1} of ${doc.racks.length} (${dir < 0 ? 'further left' : 'further right'} in the drawing)`);
});
/* drag racks in the list to change their order (left to right in the elevation) */
let rackDragId = null;
const clearDropMarks = () => rackListEl.querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
rackListEl.addEventListener('dragstart', e => {
  const it = e.target.closest('[data-id]'); if (!it) return;
  rackDragId = it.dataset.id;
  e.dataTransfer.setData('text/x-rack-id', rackDragId);
  e.dataTransfer.effectAllowed = 'move';
  it.classList.add('dragging');
});
rackListEl.addEventListener('dragover', e => {
  const it = e.target.closest('[data-id]');
  if (!rackDragId || !it) return;
  e.preventDefault();
  const r = it.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
  clearDropMarks();
  if (it.dataset.id !== rackDragId) it.classList.add(after ? 'drop-after' : 'drop-before');
});
rackListEl.addEventListener('drop', e => {
  const it = e.target.closest('[data-id]'), id = rackDragId;
  if (!id || !it) return;
  e.preventDefault();
  const after = it.classList.contains('drop-after'), target = it.dataset.id;
  clearDropMarks();
  if (target === id) return;
  const from = doc.racks.findIndex(r => r.id === id);
  mutate(() => {
    const [r] = doc.racks.splice(from, 1);
    doc.racks.splice(doc.racks.findIndex(x => x.id === target) + (after ? 1 : 0), 0, r);
  });
});
rackListEl.addEventListener('dragend', () => {
  rackDragId = null;
  clearDropMarks();
  rackListEl.querySelector('.dragging')?.classList.remove('dragging');
});

function renderCableList() {
  const name = id => esc(findDev(id)?.dev.name ?? '?');
  $('#cableCount').textContent = doc.cables.length || '';
  cableListEl.setAttribute('role', doc.cables.length ? 'listbox' : 'none');   // the totals and the empty note are not choices
  if (!doc.cables.length) {
    patchHTML(cableListEl, '');
    patchHTML(cableSumEl, '<div class="empty">No cables yet. Pick the Cable tool, then click a port and a port on another device.</div>');
    return;
  }
  const totals = {}, lens = cableLengths();
  const tab = (doc.cables.find(c => isSel('cable', c.id)) || doc.cables[0]).id;
  const rows = doc.cables.map(c => {
    const len = lens[c.id] || 0, t = ctype(c.type), std = stdLength(len, t.kind), warn = cableCheck(c);
    const tt = (totals[c.type] ||= { n: 0, len: 0, std: {}, custom: 0 });
    tt.n++; tt.len += len;
    if (std) tt.std[std] = (tt.std[std] || 0) + 1; else tt.custom++;
    return `<div class="item cable-item${isSel('cable', c.id) ? ' sel' : ''}" role="option" aria-selected="${isSel('cable', c.id)}" tabindex="${c.id === tab ? 0 : -1}" data-id="${c.id}"><span class="sw line" style="--c:${cableColor(c)}"></span>`
      + `<span class="grow"><span class="ci-main">${name(c.a)}${fmtPort(c.pa)} → ${name(c.b)}${fmtPort(c.pb)}</span><span class="ci-sub">${esc(cableLabel(c))}</span></span>`
      + `${warn ? `<span class="warn-dot" title="${esc(warn)}">⚠</span>` : ''}<span class="muted" title="Estimated length · stock cord">≈${fmtLong(len)}<br>${std ? fmtStd(std) : 'custom'}</span></div>`;
  }).join('');
  const sum = Object.entries(totals).map(([t, v]) => {
    const parts = Object.entries(v.std).sort((a, b) => a[0] - b[0]).map(([mm, n]) => `${n}× ${fmtStd(+mm)}`);
    if (v.custom) parts.push(`${v.custom}× custom`);
    return `<div class="item"><span class="sw line" style="--c:${ctype(t).color}"></span><span class="grow">${esc(ctype(t).name)} · ${v.n}</span><span class="muted">≈${fmtLong(v.len)}</span></div>`
      + `<div class="bom">${parts.join(' · ')}</div>`;
  }).join('');
  patchHTML(cableListEl, rows);
  patchHTML(cableSumEl, `<h3 class="list-sub">Totals · cords to buy</h3>${sum}`);
}
cableListEl.addEventListener('click', e => { const it = e.target.closest('[data-id]'); if (it) select('cable', it.dataset.id); });
listboxKeys(cableListEl, opt => select('cable', opt.dataset.id));

function renderPowerPanel() {
  const pm = ui.power;
  const meter = (v, max) => { const pct = max ? Math.min(100, v / max * 100) : 0; return `<div class="meter"><i class="${pct > 100 * 0.999 ? 'over' : pct >= 80 ? 'full' : ''}" style="width:${pct}%"></i></div>`; };
  let h = '<div class="sub">Racks</div>';
  h += pm.racks.map(r => `<div class="pw-row" role="button" tabindex="0" data-rack="${r.rack.id}"><div class="ri-top"><span class="grow">${esc(r.rack.name)}</span><span class="muted">${fmtW(r.watts)} · ${btu(r.watts).toLocaleString()} BTU/h</span></div>`
    + `<div class="ri-top small"><span class="grow muted">Weight</span><span class="${r.kg > r.maxKg ? 'bad-text' : 'muted'}">${fmtKg(r.kg)} / ${fmtKg(r.maxKg)}</span></div>${meter(r.kg, r.maxKg)}</div>`).join('');
  if (pm.sources.length) {
    h += '<div class="sub">Power sources</div>';
    h += pm.sources.map(s => `<div class="pw-row" role="button" tabindex="0" data-dev="${s.dev.id}"><div class="ri-top"><span class="grow">${esc(s.dev.name)}${s.dev.feed ? ` <span class="tag">${esc(s.dev.feed)}</span>` : ''}</span>`
      + `<span class="muted">${fmtW(s.normal)}${s.cap ? ' / ' + fmtW(s.cap) : ''}</span></div>${s.cap ? meter(s.worst, s.cap) : ''}`
      + `<div class="ri-top small"><span class="grow muted">${s.used}/${nOutlets(s.dev)} outlets</span><span class="muted">worst case ${fmtW(s.worst)}</span></div></div>`).join('');
  }
  if (pm.warnings.length) h += '<div class="sub">Warnings</div>' + pm.warnings.map(w => `<div class="pw-warn ${w.level}" role="button" tabindex="0" ${w.id ? `data-dev="${w.id}"` : `data-rack="${w.rack}"`}>⚠ ${esc(w.text)}</div>`).join('');
  if (pm.unpowered.length) h += `<div class="sub">Not powered yet · ${pm.unpowered.length}</div><div class="hint">${pm.unpowered.map(id => esc(pm.devs[id].dev.name)).join(', ')}</div>`;
  if (!pm.sources.length && !pm.warnings.length) h += '<p class="hint">Add a PDU, vertical PDU or UPS and connect power cables (rear view) to see loads here.</p>';
  patchHTML(powerEl, h);
  $('#powerCount').textContent = pm.warnings.length ? '⚠ ' + pm.warnings.length : '';
}
powerEl.addEventListener('click', e => {
  const d = e.target.closest('[data-dev]'), r = e.target.closest('[data-rack]');
  if (d) { focusItem({ kind: 'device', id: d.dataset.dev }); } else if (r) select('rack', r.dataset.rack);
});

/* ---------- connection check ---------- */
const checkEl = $('#checkPanel'), checkBtn = $('#checkBtn');
function renderCheckPanel() {
  const c = ui.conn, n = c.problems.length + c.cableIssues.length;
  $('#checkCount').textContent = n ? '⚠ ' + n : '';
  const dot = $('#checkDot');
  dot.hidden = !n;
  dot.classList.toggle('warn', !c.bad && !c.cableIssues.length);
  checkBtn.setAttribute('aria-pressed', ui.check);
  let h = `<div class="chk-sum"><span class="grow">${c.checked} device${c.checked === 1 ? '' : 's'} checked${c.spare ? ` · ${c.spare} spare` : ''}</span>`
    + `<button class="small" data-chk="toggle" style="margin:0">${ui.check ? 'Leave check mode' : 'Check mode'}</button></div>`;
  if (!n) h += `<p class="hint ok-text">✓ Every device has power and data${c.checked ? '' : ' (nothing to check yet)'}</p>`;
  const row = p => {
    const lamps = [p.power !== 'na' && p.power !== 'ok' && [p.power, 'Power: ' + p.pWhy], p.data !== 'na' && p.data !== 'ok' && [p.data, 'Data: ' + p.dWhy]].filter(Boolean);
    return `<div class="chk-row" role="button" tabindex="0" data-dev="${p.id}"><span class="lamp ${p.level === 'bad' ? 'none' : 'partial'}"></span>`
      + `<span class="grow"><span class="ci-main">${esc(p.dev.name)} <span class="muted">· ${esc(p.rack.name)} ${isZeroU(p.dev) ? '0U' : 'U' + p.dev.u}</span></span>`
      + lamps.map(([, t]) => `<span class="ci-sub">${esc(t)}</span>`).join('') + '</span></div>';
  };
  const group = (title, list) => (list.length ? `<div class="sub">${title} · ${list.length}</div>` + list.map(row).join('') : '');
  h += group('Not connected', c.problems.filter(p => p.level === 'bad'));
  h += group('Partly connected', c.problems.filter(p => p.level === 'warn'));
  if (c.cableIssues.length) h += `<div class="sub">Cable problems · ${c.cableIssues.length}</div>` + c.cableIssues.map(({ c: cb, why }) =>
    `<div class="chk-row" role="button" tabindex="0" data-cable="${cb.id}"><span class="lamp partial"></span><span class="grow"><span class="ci-main">${esc(cableLabel(cb))}</span><span class="ci-sub">${esc(why)}</span></span></div>`).join('');
  h += '<p class="hint" style="margin-top:8px">Power starts at a PDU or UPS with “Has building power” switched on. Tick “Spare / not in use” on a device to leave it out.</p>';
  patchHTML(checkEl, h);
}
checkEl.addEventListener('click', e => {
  if (e.target.closest('[data-chk="toggle"]')) return setCheck(!ui.check);
  const d = e.target.closest('[data-dev]'), cb = e.target.closest('[data-cable]');
  if (d) focusItem({ kind: 'device', id: d.dataset.dev });
  else if (cb) focusItem({ kind: 'cable', id: cb.dataset.cable });
});
function setCheck(on) {
  ui.check = on;
  try { localStorage.setItem('rackviz.check', on ? '1' : '0'); } catch (e) { /* ignore */ }
  if (on) $('details.sec[data-key="check"]').open = true;
  renderAll();
  // the list of problems moves to the top of the right panel (see main.checking in the CSS): show it
  if (on && ui.panels.right && !matchMedia('(max-width: 900px)').matches) $('#rightPanel').scrollTop = 0;
  if (on) toast(checkSummary());
}
checkBtn.addEventListener('click', () => setCheck(!ui.check));
try { ui.check = localStorage.getItem('rackviz.check') === '1'; } catch (e) { /* ignore */ }

/* ---------- properties ---------- */
const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur ?? '') ? ' selected' : ''}>${esc(label)}</option>`;
const optsOf = (obj, cur) => Object.entries(obj).map(([k, v]) => opt(k, typeof v === 'string' ? v : v.label, cur)).join('');
function typeOptions(cur) {
  return CATS.map(([cat, label]) => `<optgroup label="${label}">` + Object.entries(TYPES).filter(([, t]) => t.cat === cat).map(([k, t]) => opt(k, t.label, cur)).join('') + '</optgroup>').join('');
}
function cableTypeOptions(cur) {
  const g = kind => doc.settings.cableTypes.filter(t => t.kind === kind).map(t => opt(t.id, t.name, cur)).join('');
  return `<optgroup label="Data">${g('data')}</optgroup><optgroup label="Power">${g('power')}</optgroup>`;
}
function deviceOptions(selected) {
  return doc.racks.map(r => `<optgroup label="${esc(r.name)}">` +
    [...r.devices].sort((a, b) => b.u - a.u).map(d => opt(d.id, `${isZeroU(d) ? '0U' : 'U' + d.u} · ${d.name}`, selected)).join('') + '</optgroup>').join('');
}
function portOptions(devId, sel, cabId, kind) {
  const f = findDev(devId); if (!f) return '';
  const use = portUse()[devId] || {}, d = f.dev;
  let h = '';
  for (const c of kind === 'power' ? ['o', 'i'] : ['p', 'u'])
    for (let i = 1; i <= portCount(d, c); i++) {
      const k = c + i, busy = use[k] && use[k].id !== cabId;
      h += `<option value="${k}"${k === sel ? ' selected' : ''}${busy ? ' disabled' : ''}>${esc(portLabel(d, k))}${busy ? ' · in use' : ''}</option>`;
    }
  return h || '<option value="">No ports of this kind</option>';
}
const allPortKeys = d => ['p', 'u', 'i', 'o'].flatMap(c => Array.from({ length: portCount(d, c) }, (_, i) => c + (i + 1)));
function portTableHTML(dev) {
  const keys = allPortKeys(dev);
  if (!keys.length) return '';
  const used = portUse()[dev.id] || {};
  const rows = keys.map(k => {
    const c = used[k];
    let to = '<span class="muted">—</span>';
    if (c) {
      const [od, ok] = c.a === dev.id && c.pa === k ? [c.b, c.pb] : [c.a, c.pa], o = findDev(od);
      to = `<button type="button" class="cell-link" data-cid="${c.id}" title="Select this cable"><i class="sw line" style="--c:${cableColor(c)}"></i>${o ? esc(o.dev.name) + ' ' + portShort(ok) : '?'}</button>`;
    }
    return `<tr${c ? ` data-cid="${c.id}" class="link"` : ''}><td>${portShort(k)}</td><td class="muted">${esc(connName(dev, k))}</td><td>${to}</td></tr>`;
  }).join('');
  return `<details class="ptable"><summary>Port map · ${Object.keys(used).length} of ${keys.length} in use</summary><table>${rows}</table></details>`;
}
function devicePropsHTML(rack, dev) {
  const u = ui.unit, z = isZeroU(dev), pm = ui.power, warn = devWarn(rack, dev);
  const src = pm.sources.find(s => s.dev.id === dev.id), feeds = pm.feeds[dev.id] || [];
  const pwarn = pm.warnings.filter(w => w.id === dev.id).map(w => w.text);
  const used = Object.keys(portUse()[dev.id] || {}).length, total = allPortKeys(dev).length, cs = ui.conn?.devs[dev.id];
  const placement = z ? `<div class="grid2">
      <label>Side<select data-f="side">${opt('left', 'Left', dev.side)}${opt('right', 'Right', dev.side)}</select></label>
      <label>Faces<select data-f="mount">${opt('rear', 'Rear', dev.mount)}${opt('front', 'Front', dev.mount)}</select></label>
      <label>Length (${u})<input data-f="length" type="number" step="any" min="0" value="${toDisp(zLen(dev))}"></label>
      <label>From the top (${u})<input data-f="offset" type="number" step="any" min="0" value="${toDisp(dev.offset || 0)}"></label>
    </div>` : `<div class="grid2">
      <label>Height (U)<input data-f="h" type="number" min="1" max="${rack.units}" value="${dev.h}"></label>
      <label>Bottom U<input data-f="u" type="number" min="1" max="${rack.units}" value="${dev.u}"></label>
      <label>Width<select data-f="half">${opt('', 'Full width', dev.half || '')}${opt('left', 'Half · left', dev.half)}${opt('right', 'Half · right', dev.half)}</select></label>
      <label>Mounted<select data-f="mount">${opt('front', 'Front', dev.mount)}${opt('rear', 'Rear', dev.mount)}</select></label>
      <label>Depth (${u})<input data-f="depth" type="number" step="any" min="1" value="${toDisp(dev.depth)}"></label>
    </div>`;
  const data = hasData(dev) || hasUp(dev) ? `<h4>Data ports</h4><div class="grid2">
      ${hasData(dev) ? `<label>Ports<input data-f="ports" type="number" min="0" max="96" list="portCounts" value="${nPorts(dev)}"></label>
      <label>Connector<select data-f="portType">${optsOf(DATA_CONN, portConn(dev))}</select></label>` : ''}
      ${hasUp(dev) ? `<label>Uplinks<input data-f="uplinks" type="number" min="0" max="16" value="${nUplinks(dev)}"></label>
      <label>Uplink type<select data-f="uplinkType">${optsOf(UPLINK_TYPES, upType(dev))}</select></label>` : ''}
    </div>` : '';
  const power = hasIn(dev) || hasOut(dev) ? `<h4>Power</h4><div class="grid2">
      ${hasOut(dev) ? `<label>Outlets<input data-f="outlets" type="number" min="0" max="48" value="${nOutlets(dev)}"></label>
      <label>Outlet type<select data-f="outletType">${optsOf(OUTLET_NAME, outletType(dev))}</select></label>
      <label>Capacity (W)<input data-f="capacity" type="number" min="0" step="10" value="${capacity(dev)}"></label>
      <label>Feed<select data-f="feed" title="Label redundant feeds to check that dual power supplies are split">${opt('', 'Not set', dev.feed || '')}${opt('A', 'Feed A', dev.feed)}${opt('B', 'Feed B', dev.feed)}</select></label>
      <label class="check full" title="Plugged into the building's power: the power chain starts here"><input type="checkbox" data-f="mains"${dev.mains ? ' checked' : ''}> Has building power</label>` : ''}
      ${hasIn(dev) ? `<label>Power inlets<input data-f="inlets" type="number" min="0" max="4" value="${nInlets(dev)}"></label>
      <label>Inlet type<select data-f="inletType">${optsOf(INLET_NAME, inletType(dev))}</select></label>` : ''}
      <label>Draw (W)<input data-f="watts" type="number" min="0" step="5" value="${watts(dev)}"></label>
    </div>` : '';
  const stats = [
    ['Occupies', z ? `0U · ${dev.side} side` : `U${dev.u}${dev.h > 1 ? '–' + (dev.u + dev.h - 1) : ''}${isHalf(dev) ? ' · half' : ''}`],
    ['Size', z ? `${fmt(zLen(dev))} long` : `${fmt(dev.h * U_MM)} × ${fmt(dev.depth)} deep`],
    total ? ['Ports in use', `${used} of ${total}`] : null,
    src ? ['Load', `${fmtW(src.normal)}${src.cap ? ' of ' + fmtW(src.cap) : ''} · worst ${fmtW(src.worst)}`] : null,
    watts(dev) ? ['Heat', `${btu(watts(dev))} BTU/h`] : null,
    feeds.length ? ['Fed from', feeds.map(f => `${portShort(f.inlet)} ← ${esc(pm.devs[f.src].dev.name)} ${portShort(f.outlet)}`).join('<br>')] : null,
    cs && cs.power !== 'na' ? ['Power', `<span class="lamp ${cs.power}"></span>${esc(cs.pWhy)}`] : null,
    cs && cs.data !== 'na' ? ['Data', `<span class="lamp ${cs.data}"></span>${esc(cs.dWhy)}`] : null,
  ].filter(Boolean);
  const warns = [warn, ...pwarn].filter(Boolean);
  return `<div class="stack">
    <label>Name<input data-f="name" value="${esc(dev.name)}"></label>
    <div class="grid2">
      <label>Type<select data-f="type">${typeOptions(dev.type)}</select></label>
      <label>Rack<select data-f="rack">${doc.racks.map(x => opt(x.id, x.name, rack.id)).join('')}</select></label>
    </div>
    <div class="color-row"><span>Color</span><input type="color" data-f="color" value="${devColor(dev)}"><button data-act="resetColor"${dev.color ? '' : ' disabled'}>Use category color</button></div>
    <h4>Placement</h4>${placement}
    ${data}${power}
    <h4>Details</h4>
    <div class="grid2">
      <label>Hostname<input data-f="hostname" value="${esc(dev.hostname || '')}"></label>
      <label>IP address<input data-f="ip" value="${esc(dev.ip || '')}"></label>
      <label>Serial number<input data-f="serial" value="${esc(dev.serial || '')}"></label>
      <label>Weight (kg)<input data-f="weight" type="number" step="any" min="0" value="${weight(dev)}"></label>
      <label class="full">Notes<textarea data-f="notes" rows="2">${esc(dev.notes || '')}</textarea></label>
      ${total ? `<label class="check full" title="Left out of the connection check, e.g. a spare kept in the rack"><input type="checkbox" data-f="spare"${dev.spare ? ' checked' : ''}> Spare / not in use</label>` : ''}
    </div>
    <dl class="kv">${stats.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    ${warns.map(w => `<p class="warn">⚠ ${esc(w)}</p>`).join('')}
    <div class="row">${z ? '' : '<button data-act="up" title="Move up to the next free slot">▲</button><button data-act="down" title="Move down to the next free slot">▼</button>'}<button data-act="dup">Duplicate</button><button data-act="template" title="Add it to the equipment list for reuse">Save as template</button><button data-act="del" class="danger">Delete</button></div>
    ${portTableHTML(dev)}
  </div>`;
}
function rackPropsHTML(r) {
  const u = ui.unit, used = usedU(r), usable = r.units * U_MM, info = ui.power.racks.find(x => x.rack === r);
  return `<div class="stack">
    <div class="grid2">
      <label>Name<input data-f="name" value="${esc(r.name)}"></label>
      <label title="Used at the start of cable labels">Label code<input data-f="code" value="${esc(r.code || '')}" placeholder="${esc(rackCode({ ...r, code: '' }))}"></label>
      <label>Height (U)<input data-f="units" type="number" min="1" max="100" value="${r.units}"></label>
      <label>Max load (kg)<input data-f="maxLoad" type="number" min="0" step="10" value="${rackMaxLoad(r)}"></label>
      <label>Width (${u})<input data-f="width" type="number" step="any" value="${toDisp(r.width)}"></label>
      <label>Depth (${u})<input data-f="depth" type="number" step="any" value="${toDisp(r.depth)}"></label>
      <label class="full">Side channel for arranged cables<select data-f="channel">${opt('both', 'Both sides · nearest one', r.channel || 'both')}${opt('left', 'Left side only', r.channel)}${opt('right', 'Right side only', r.channel)}</select></label>
    </div>
    <dl class="kv">
      <dt>Usable height</dt><dd>${fmt(usable, 'cm')} · ${fmt(usable, 'in')}</dd>
      <dt>Outer height</dt><dd>${fmt(rackH(r), 'cm')} · ${fmt(rackH(r), 'in')}</dd>
      <dt>Usable depth</dt><dd>${fmt(usableDepth(r))}</dd>
      <dt>Used</dt><dd>${used}U (${Math.round(used / r.units * 100)} %)</dd>
      <dt>Free</dt><dd>${r.units - used}U · ${fmt((r.units - used) * U_MM)}</dd>
      <dt>Largest free block</dt><dd>${largestFree(r)}U</dd>
      <dt>Devices</dt><dd>${r.devices.length}</dd>
      <dt>Power</dt><dd>${fmtW(info.watts)} · ${btu(info.watts).toLocaleString()} BTU/h</dd>
      <dt>Weight</dt><dd class="${info.kg > info.maxKg ? 'bad-text' : ''}">${fmtKg(info.kg)} of ${fmtKg(info.maxKg)}</dd>
    </dl>
    <div class="row"><button data-act="left" title="Move left">←</button><button data-act="right" title="Move right">→</button><button data-act="dup">Duplicate</button><button data-act="del" class="danger">Delete</button></div>
  </div>`;
}
function cablePropsHTML(c) {
  const t = ctype(c.type), A = findDev(c.a), B = findDev(c.b), kind = portKind(c.pa);
  const len = cableLengths()[c.id] || 0, std = stdLength(len, kind), warn = cableCheck(c), room = runPairs(c).length;
  const run = room ? `<h4>Patch run</h4><div class="row run-row">
      <label>Next<input type="number" data-run min="1" max="${room}" value="${Math.min(room, 11)}"></label>
      <button data-act="run" title="Repeat this cable on the following port pairs">Add cables</button>
      <span class="muted">up to ${room} more</span></div>` : '';
  return `<div class="stack">
    <label>Type<select data-f="type">${cableTypeOptions(c.type)}</select></label>
    <div class="color-row"><span>Color</span><input type="color" data-f="color" value="${cableColor(c)}"><button data-act="resetColor"${c.color ? '' : ' disabled'}>Use type color</button></div>
    <label>Label<input data-f="label" value="${esc(c.label)}" placeholder="${esc(autoLabel(c))}"></label>
    <div class="grid2">
      <label>From<select data-f="a">${deviceOptions(c.a)}</select></label>
      <label>Port<select data-f="pa">${portOptions(c.a, c.pa, c.id, kind)}</select></label>
      <label>To<select data-f="b">${deviceOptions(c.b)}</select></label>
      <label>Port<select data-f="pb">${portOptions(c.b, c.pb, c.id, kind)}</select></label>
    </div>
    ${A && B && A.rack !== B.rack ? `<label>Between racks<select data-f="via">${opt('', `Default (${doc.settings.via === 'bottom' ? 'underfloor' : 'overhead tray'})`, c.via || '')}${opt('top', 'Overhead tray', c.via)}${opt('bottom', 'Underfloor', c.via)}</select></label>` : ''}
    <label>Notes<textarea data-f="notes" rows="2">${esc(c.notes || '')}</textarea></label>
    <dl class="kv"><dt>Estimated length</dt><dd>≈ ${fmtLong(len)} · ${fmt(len, 'in')}</dd><dt>Stock ${t.kind === 'power' ? 'power cord' : 'patch cord'}</dt><dd>${std ? fmtStd(std) : 'custom length'}</dd></dl>
    ${warn ? `<p class="warn">⚠ ${esc(warn)}</p>` : ''}
    ${run}
    <p class="hint">Length follows the drawn route plus 10 % slack. Drag either end in the 2D view to plug it into another port.</p>
    <div class="row"><button data-act="del" class="danger">Delete</button></div>
  </div>`;
}
function multiPropsHTML(ids) {
  const devs = ids.map(findDev).filter(Boolean);
  const hU = devs.reduce((s, f) => s + (isZeroU(f.dev) ? 0 : f.dev.h), 0);
  return `<div class="stack">
    <p class="multi-head"><strong>${devs.length} devices selected</strong></p>
    <dl class="kv"><dt>Rack units</dt><dd>${hU}U</dd><dt>Power</dt><dd>${fmtW(devs.reduce((s, f) => s + watts(f.dev), 0))}</dd><dt>Weight</dt><dd>${fmtKg(devs.reduce((s, f) => s + weight(f.dev), 0))}</dd></dl>
    <div class="color-row"><span>Color</span><input type="color" data-mf="color" value="${devColor(devs[0].dev)}"><button data-mact="resetColor">Use category colors</button></div>
    <label>Move to rack<select data-mf="rack"><option value="">Choose a rack…</option>${doc.racks.map(r => opt(r.id, r.name, '')).join('')}</select></label>
    <div class="row"><button data-mact="up" title="Move them all up">▲</button><button data-mact="down" title="Move them all down">▼</button><button data-mact="dup">Duplicate</button><button data-mact="copy">Copy</button><button data-mact="del" class="danger">Delete all</button></div>
    <ul class="mlist">${devs.map(f => `<li data-id="${f.dev.id}"><button type="button" class="mrow" data-id="${f.dev.id}"><span class="sw k-${T_(f.dev).cat}" ${f.dev.color ? `style="--c:${f.dev.color}"` : ''}></span>${esc(f.dev.name)}<span class="muted">${esc(f.rack.name)} · ${isZeroU(f.dev) ? '0U' : 'U' + f.dev.u}</span></button></li>`).join('')}</ul>
    <p class="hint">Shift-click adds or removes a device · Shift-drag on empty space selects with a box · Ctrl+C, Ctrl+V and Ctrl+D copy, paste and duplicate.</p>
  </div>`;
}
function globalPropsHTML() {
  const s = doc.settings;
  return `<div class="stack">
    <div class="empty-props"><svg class="ic"><use href="#i-cursor"/></svg>
      <p><strong>Nothing selected</strong><br>Click a rack, device or cable to edit it. Shift-click or Shift-drag selects several devices.<br>
      <button class="link tour-link" data-tour-start>New here? Take the tour</button></p></div>
    <h4>Units</h4>
    <label>Lengths in<select data-g="unit">${opt('cm', 'Centimetres (cm)', s.unit)}${opt('in', 'Inches (in)', s.unit)}${opt('mm', 'Millimetres (mm)', s.unit)}</select></label>
    <h4>Layout</h4>
    <label>Space between racks (${ui.unit})<input data-g="gap" type="number" step="any" min="0" value="${toDisp(s.gap)}"></label>
    <h4>Cables between racks</h4>
    <label>Route when cables are arranged<select data-g="via">${opt('top', 'Overhead tray', s.via)}${opt('bottom', 'Underfloor', s.via)}</select></label>
    <h4>Cable labels</h4>
    <label>Pattern<input data-g="labelPattern" value="${esc(s.labelPattern)}" spellcheck="false"></label>
    <p class="hint">Tokens: {rack} {u} {port} {device}. Example: ${esc(doc.cables[0] ? endLabel(doc.cables[0].a, doc.cables[0].pa) : 'A-U41-P1')}</p>
    <label class="check"><input type="checkbox" data-g="showLabels"${s.showLabels ? ' checked' : ''}> Show labels at cable ends</label>
    <p class="hint">Stock cord lengths are suggested in metres, or in feet when units are inches.</p>
  </div>`;
}
function renderProps() {
  const s = ui.sel, multi = ui.multi.size > 1;
  $('#propsTitle').textContent = multi ? 'Selection' : { device: 'Device', rack: 'Rack', cable: 'Cable' }[s?.kind] || 'Properties';
  let h;
  if (multi) h = multiPropsHTML([...ui.multi]);
  else if (s?.kind === 'device' && findDev(s.id)) { const f = findDev(s.id); h = devicePropsHTML(f.rack, f.dev); }
  else if (s?.kind === 'rack' && doc.racks.some(r => r.id === s.id)) h = rackPropsHTML(doc.racks.find(r => r.id === s.id));
  else if (s?.kind === 'cable' && doc.cables.some(c => c.id === s.id)) h = cablePropsHTML(doc.cables.find(c => c.id === s.id));
  else h = globalPropsHTML();
  const key = multi ? 'multi' : s ? s.kind + ':' + s.id : 'none';
  patchHTML(propsEl, `<div class="props-body" data-id="${esc(key)}">${h}</div>`);
}

propsEl.addEventListener('change', e => {
  const el = e.target, raw = el.type === 'checkbox' ? el.checked : el.value, s = ui.sel;
  if (el.dataset.g) {
    const g = el.dataset.g;
    if (g === 'gap') return mutate(() => (doc.settings.gap = Math.max(0, fromDisp(+raw || 0))));
    if (g === 'labelPattern') return mutate(() => (doc.settings.labelPattern = String(raw).trim() || '{rack}-U{u}-{port}'));
    if (g === 'unit') { doc.settings.unit = raw; save(); return renderAll(); }   // a display preference: not an undo step
    return mutate(() => (doc.settings[g] = raw));
  }
  if (el.dataset.mf) return updateMulti(el.dataset.mf, raw);
  const f = el.dataset.f;
  if (!f || !s) return;
  if (s.kind === 'device') updateDevice(s.id, f, raw);
  else if (s.kind === 'rack') updateRack(s.id, f, raw);
  else if (s.kind === 'cable') updateCable(s.id, f, raw);
});
function updateCable(id, f, raw) {
  const c = doc.cables.find(c => c.id === id);
  if (f === 'a' || f === 'b') {
    if (raw === (f === 'a' ? c.b : c.a)) { toast('A cable needs two different devices'); return renderProps(); }
    const d = findDev(raw).dev, cur = c['p' + f];
    const k = firstFree(d, portUse()[raw], portKind(cur) === 'power' ? cur[0] : 'data');
    if (!k) { toast(`“${d.name}” has no free ${portKind(cur) === 'power' ? (cur[0] === 'o' ? 'outlets' : 'power inlets') : 'ports'}`); return renderProps(); }
    return mutate(() => { c[f] = raw; c['p' + f] = k; });
  }
  if (f === 'via') return mutate(() => { if (raw) c.via = raw; else delete c.via; });
  if (f === 'label' || f === 'notes') return mutate(() => (c[f] = String(raw).trim()));
  mutate(() => (c[f] = raw));
  if (f === 'type' && cableCheck(c)) toast('⚠ ' + cableCheck(c));
}
function updateDevice(id, f, raw) {
  const { rack, dev } = findDev(id), next = { ...dev };
  if (f === 'rack') return moveToRack(id, raw);
  const ints = { ports: [0, 96], uplinks: [0, 16], inlets: [0, 4], outlets: [0, 48] };
  if (f === 'name') next.name = raw.trim() || T_(dev).label;
  else if (f === 'type') {
    const o = T_(dev), t = TYPES[raw];
    next.type = raw;
    if (dev.name === o.label) next.name = t.label;
    if (dev.depth === o.d) next.depth = t.d;
    for (const k of ['ports', 'portType', 'uplinks', 'uplinkType', 'inlets', 'inletType', 'outlets', 'outletType', 'watts', 'capacity', 'weight']) delete next[k];
    if (t.zeroU && !o.zeroU) {
      const pos = freeZeroU(rack, { ...next, length: t.len });
      if (!pos) { toast(`No free side space in ${rack.name}`); return renderProps(); }
      Object.assign(next, pos, { h: 0, mount: 'rear' });
    } else if (!t.zeroU && o.zeroU) {
      for (const k of ['side', 'offset', 'length']) delete next[k];
      next.h = t.h; next.mount = 'front';
      next.u = freeSlot(rack, next);
      if (!next.u) { toast(`No free ${t.h}U space in ${rack.name}`); return renderProps(); }
    } else if (dev.h === o.h) next.h = t.h;
  }
  else if (f === 'h' || f === 'u') next[f] = Math.max(1, Math.round(+raw) || 1);
  else if (f in ints) next[f] = clamp(Math.round(+raw) || 0, ...ints[f]);
  else if (['depth', 'length', 'offset'].includes(f)) next[f] = Math.max({ offset: 0, length: ZERO_U_MIN, depth: 5 }[f], fromDisp(+raw || 0));
  else if (['watts', 'capacity', 'weight'].includes(f)) next[f] = Math.max(0, +raw || 0);
  else if (['hostname', 'ip', 'serial', 'notes'].includes(f)) next[f] = String(raw).trim();
  else if (['half', 'feed', 'mains', 'spare'].includes(f)) { if (raw) next[f] = raw; else delete next[f]; }
  else next[f] = raw;   // mount, side, connector types, color
  const g = isZeroU(next) ? null : portGrid(next);
  const lost = Object.keys(portUse()[id] || {}).filter(k => !validPort(next, k));
  const err = conflict(rack, next)
    || (g && !g.fits && `Those ports don't fit on ${next.h}U${isHalf(next) ? ' half width' : ''} (up to ${g.maxData} data ports${nOutlets(next) ? ` / ${g.maxOut} outlets` : ''})`)
    || (isZeroU(next) && !zeroUFits(next) && 'Too many outlets for that length')
    || (lost.length && `${portLabel(dev, lost[0])} has a cable. Remove it first`);
  if (err) { toast(err); return renderProps(); }
  mutate(() => { for (const k of Object.keys(dev)) if (!(k in next)) delete dev[k]; Object.assign(dev, next); });
}
function updateRack(id, f, raw) {
  const r = doc.racks.find(r => r.id === id);
  if (f === 'name') return mutate(() => (r.name = raw.trim() || 'Rack'));
  if (f === 'code') return mutate(() => (r.code = raw.trim()));
  if (f === 'channel') return mutate(() => (r.channel = raw));
  if (f === 'maxLoad') return mutate(() => (r.maxLoad = Math.max(0, +raw || 0)));
  if (f === 'units') {
    const n = clamp(Math.round(+raw) || 1, 1, 100);
    const over = r.devices.find(d => (isZeroU(d) ? (d.offset || 0) + zLen(d) > n * U_MM : d.u + d.h - 1 > n));
    if (over) { toast(`“${over.name}” sits above U${n}. Move it first`); return renderProps(); }
    return mutate(() => (r.units = n));
  }
  if (f === 'width') return mutate(() => (r.width = Math.max(MIN_RACK_W, fromDisp(+raw || 0))));
  if (f === 'depth') return mutate(() => (r.depth = Math.max(2 * RAIL_INSET + 50, fromDisp(+raw || 0))));
}
function updateMulti(f, raw) {
  const ids = [...ui.multi];
  if (f === 'color') return mutate(() => ids.forEach(id => (findDev(id).dev.color = raw)));
  if (f === 'rack' && raw) {
    const to = doc.racks.find(r => r.id === raw);
    let moved = 0, skipped = 0;
    mutate(() => {
      for (const f of ids.map(findDev).sort((a, b) => b.dev.u - a.dev.u)) {
        if (f.rack === to) continue;
        f.rack.devices.splice(f.rack.devices.indexOf(f.dev), 1);
        const pos = isZeroU(f.dev) ? freeZeroU(to, f.dev) : (u => (u ? { u } : null))(nearestFree(to, f.dev, clamp(f.dev.u, 1, to.units)));
        if (!pos) { f.rack.devices.push(f.dev); skipped++; continue; }
        Object.assign(f.dev, pos); to.devices.push(f.dev); moved++;
      }
    });
    toast(`Moved ${moved} to ${to.name}${skipped ? `, ${skipped} didn't fit` : ''}`);
  }
}
propsEl.addEventListener('click', e => {
  const tr = e.target.closest('tr[data-cid]');
  if (tr) return select('cable', tr.dataset.cid);
  const li = e.target.closest('.mlist li[data-id]');
  if (li) return select('device', li.dataset.id);
  const mact = e.target.closest('[data-mact]')?.dataset.mact;
  if (mact) {
    const ids = [...ui.multi];
    if (mact === 'up' || mact === 'down') return shiftDevs(ids, mact === 'up' ? 1 : -1);
    if (mact === 'dup') return duplicateSel();
    if (mact === 'copy') return copySel();
    if (mact === 'del') return deleteSel(true);
    if (mact === 'resetColor') return mutate(() => ids.forEach(id => delete findDev(id).dev.color));
    return;
  }
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
  if (s.kind === 'cable' && act === 'run') {
    const c = doc.cables.find(c => c.id === s.id), n = Math.round(+propsEl.querySelector('[data-run]').value);
    return c && n >= 1 && continueRun(c, n);
  }
  if (s.kind === 'device') {
    if (act === 'up' || act === 'down') return shiftDevs([s.id], act === 'up' ? 1 : -1);
    if (act === 'dup') return duplicateSel();
    if (act === 'template') return saveTemplate(findDev(s.id).dev);
  }
  if (s.kind === 'rack') {
    const i = doc.racks.findIndex(r => r.id === s.id), r = doc.racks[i];
    if (act === 'left' && i > 0) mutate(() => doc.racks.splice(i - 1, 0, doc.racks.splice(i, 1)[0]));
    if (act === 'right' && i < doc.racks.length - 1) mutate(() => doc.racks.splice(i + 1, 0, doc.racks.splice(i, 1)[0]));
    if (act === 'dup') {
      const copy = { ...JSON.parse(JSON.stringify(r)), id: uid(), name: r.name + ' copy', code: '' };
      const ids = new Map();
      copy.devices.forEach(d => { const n = uid(); ids.set(d.id, n); d.id = n; });
      // cables between devices of this rack come along; cables to other racks stay put
      const cables = doc.cables.filter(c => ids.has(c.a) && ids.has(c.b))
        .map(c => ({ ...JSON.parse(JSON.stringify(c)), id: uid(), a: ids.get(c.a), b: ids.get(c.b), label: '' }));
      ui.sel = { kind: 'rack', id: copy.id };
      mutate(() => { doc.racks.splice(i + 1, 0, copy); doc.cables.push(...cables); });
      if (cables.length) toast(`Duplicated ${r.name} with ${cables.length} cable${cables.length > 1 ? 's' : ''} inside it`);
    }
  }
});

/* ---------- add-rack form ---------- */
const rackForm = $('#addRackForm'), presetSel = $('#presetSel'), newRackBtn = $('#newRackBtn');
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
function showRackForm(on) {
  rackForm.hidden = !on;
  newRackBtn.setAttribute('aria-expanded', on);
  newRackBtn.textContent = on ? 'Close' : '+ New rack';
  if (on) rackForm.name.focus();
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
    width: Math.max(MIN_RACK_W, formMM.width),
    depth: Math.max(2 * RAIL_INSET + 50, formMM.depth),
  });
  delete rackForm.name.dataset.touched;
  showRackForm(false);
  ui.sel = { kind: 'rack', id: r.id }; ui.lastRack = r.id;
  mutate(() => doc.racks.push(r));
  if (ui.view === '2d') { fit(); draw2D(); }
});
newRackBtn.addEventListener('click', () => showRackForm(rackForm.hidden));
$('#cancelRack').addEventListener('click', () => showRackForm(false));

/* ---------- equipment list (with saved templates) ---------- */
const paletteEl = $('#palette');
function renderPalette() {
  const tpls = doc.settings.templates;
  const item = (type, label, h, cat, extra = '', style = '') =>
    `<button class="pal" draggable="true" data-type="${type}" ${extra} title="Add ${esc(label)}, or drag it onto a rack">`
    + `<span class="sw k-${cat}"${style}></span><span class="grow">${esc(label)}</span><span class="muted">${h}</span>`
    + `<svg class="ic add"><use href="#i-plus"/></svg></button>`;
  let h = '';
  if (tpls.length) {
    h += '<div class="pal-group"><div class="pal-head">My templates</div>' + tpls.map(t => {
      const tt = TYPES[t.type] || TYPES.custom;
      return `<div class="pal-tpl">${item(t.type + ':' + t.id, t.name, tt.zeroU ? '0U' : (t.fields.h || tt.h) + 'U', tt.cat, `data-tpl="${t.id}"`, t.fields.color ? ` style="--c:${t.fields.color}"` : '')}`
        + `<button class="ib tpl-del" data-del-tpl="${t.id}" title="Remove template" aria-label="Remove template"><svg class="ic"><use href="#i-close"/></svg></button></div>`;
    }).join('') + '</div>';
  }
  h += CATS.map(([cat, label]) => {
    const items = Object.entries(TYPES).filter(([, t]) => t.cat === cat);
    return `<div class="pal-group"><div class="pal-head">${label}</div>` + items.map(([k, t]) => item(k, t.label, t.zeroU ? '0U' : t.h + 'U', cat)).join('') + '</div>';
  }).join('');
  patchHTML(paletteEl, h);
}
paletteEl.addEventListener('click', e => {
  const del = e.target.closest('[data-del-tpl]');
  if (del) return mutate(() => (doc.settings.templates = doc.settings.templates.filter(t => t.id !== del.dataset.delTpl)));
  const b = e.target.closest('[data-type]');
  if (!b) return;
  const tpl = b.dataset.tpl && doc.settings.templates.find(t => t.id === b.dataset.tpl);
  if (tpl) return addDevice(tpl.type, targetRack(), null, { ...tpl.fields, name: tpl.name });
  addDevice(b.dataset.type, targetRack(), null, TYPES[b.dataset.type].zeroU ? {} : { mount: ui.view === '2d' ? ui.face : 'front' });
});
paletteEl.addEventListener('dragstart', e => {
  const b = e.target.closest('[data-type]');
  if (b) { e.dataTransfer.setData('text/x-rack-type', b.dataset.type); e.dataTransfer.effectAllowed = 'copy'; }
});

/* ---------- converter ---------- */
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
  const nU = Math.floor(range / U_MM), uStep = Math.ceil(nU / 10);
  for (let i = 0; i <= nU; i++) {
    const x = X + i * U_MM * sc;
    s += `<line x1="${x}" x2="${x}" y1="${i % uStep ? 22 : 18}" y2="28"/>`;
    if (i % uStep === 0) s += `<text x="${x}" y="13">${i}U</text>`;
  }
  s += `<rect class="bar-fill" x="${X}" y="30" width="${Math.max(0, cvMM * sc)}" height="10"/>`;
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

/* ---------- colors & cable types editor ---------- */
const styleEl = $('#styleEditor'), cableTypeSel = $('#cableType');
function renderStyleEditor() {
  const used = {};
  doc.cables.forEach(c => (used[c.type] = (used[c.type] || 0) + 1));
  const rows = kind => doc.settings.cableTypes.filter(t => t.kind === kind).map(t => `<div class="trow" data-ct="${t.id}">
      <input type="color" data-ct-f="color" value="${t.color}" title="Color" aria-label="${esc(t.name)} color">
      <input data-ct-f="name" value="${esc(t.name)}" title="Name" aria-label="Name of the ${esc(t.name)} cable type">
      <span class="muted" title="Cables of this type">${used[t.id] || 0}</span>
      <button class="icon" data-ct-act="del" title="Remove type" aria-label="Remove the ${esc(t.name)} cable type">×</button></div>`).join('');
  patchHTML(styleEl, '<div class="sub">Data cable types</div>' + rows('data')
    + '<button class="small" data-ct-act="add" data-kind="data">+ Add data cable type</button>'
    + '<div class="sub">Power cable types</div>' + rows('power')
    + '<button class="small" data-ct-act="add" data-kind="power">+ Add power cable type</button>'
    + '<div class="sub">Equipment colors</div>'
    + CATS.map(([k, label]) => `<div class="trow"><input type="color" data-cat="${k}" value="${cssVar('--k-' + k)}" aria-label="${label} equipment color"><span>${label}</span><span class="muted">${Object.values(TYPES).filter(t => t.cat === k).map(t => t.label).join(', ')}</span></div>`).join('')
    + '<button class="small" data-ct-act="resetCats">Reset equipment colors</button>');
  if (!doc.settings.cableTypes.some(t => t.id === ui.cableType)) ui.cableType = doc.settings.cableTypes[0].id;
  patchHTML(cableTypeSel, cableTypeOptions(ui.cableType));
  cableTypeSel.value = ui.cableType;
  cableTypeSel.style.borderLeftColor = ctype(ui.cableType).color;
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
  const btn = e.target.closest('[data-ct-act]'), act = btn?.dataset.ctAct;
  if (!act) return;
  const types = doc.settings.cableTypes;
  if (act === 'add') {
    const kind = btn.dataset.kind, t = { id: uid(), name: kind === 'power' ? 'New power cable' : 'New cable', color: NEW_TYPE_COLORS[types.length % NEW_TYPE_COLORS.length], kind };
    mutate(() => types.push(t));
    styleEl.querySelector(`[data-ct="${t.id}"] [data-ct-f="name"]`)?.select();
  } else if (act === 'del') {
    const id = e.target.closest('[data-ct]').dataset.ct, t = types.find(t => t.id === id);
    const n = doc.cables.filter(c => c.type === id).length;
    if (n) return toast(`${n} cable${n > 1 ? 's use' : ' uses'} “${t.name}”. Change ${n > 1 ? 'them' : 'it'} first`);
    if (types.filter(x => x.kind === t.kind).length === 1) return toast(`Keep at least one ${t.kind} cable type`);
    mutate(() => types.splice(types.indexOf(t), 1));
  } else if (act === 'resetCats') {
    mutate(() => (doc.settings.catColors = {}));
  }
});

/* ---------- search ---------- */
const searchIn = $('#searchIn'), searchRes = $('#searchRes');
let searchHits = [], searchActive = 0;
function searchItems(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const res = [];
  for (const r of doc.racks) {
    if (r.name.toLowerCase().includes(q)) res.push({ kind: 'rack', id: r.id, title: r.name, sub: `${r.units}U rack` });
    for (const d of r.devices) {
      const hay = [d.name, d.hostname, d.ip, d.serial, d.notes, T_(d).label].filter(Boolean).join(' ').toLowerCase();
      if (hay.includes(q)) res.push({ kind: 'device', id: d.id, title: d.name, sub: [r.name, isZeroU(d) ? '0U' : 'U' + d.u, d.hostname, d.ip].filter(Boolean).join(' · ') });
    }
  }
  for (const c of doc.cables) {
    const hay = [cableLabel(c), c.notes, ctype(c.type).name].filter(Boolean).join(' ').toLowerCase();
    if (hay.includes(q)) res.push({ kind: 'cable', id: c.id, title: cableLabel(c), sub: ctype(c.type).name });
  }
  return res;
}
const SEARCH_MAX = 14;
function renderSearch() {
  const all = searchItems(searchIn.value);
  searchHits = all.slice(0, SEARCH_MAX);
  searchActive = clamp(searchActive, 0, Math.max(0, searchHits.length - 1));
  searchRes.hidden = !searchIn.value.trim();
  // a combobox with a list of results: the input keeps the focus, the arrows move the highlighted result
  searchRes.innerHTML = searchHits.length ? searchHits.map((h, i) => `<button class="sr${i === searchActive ? ' on' : ''}" role="option" id="sr${i}" aria-selected="${i === searchActive}" tabindex="-1" data-i="${i}"><span class="tag">${h.kind}</span><span class="grow"><span class="ci-main">${esc(h.title)}</span><span class="ci-sub">${esc(h.sub)}</span></span></button>`).join('')
      + (all.length > SEARCH_MAX ? `<div class="empty" role="presentation">Showing ${SEARCH_MAX} of ${all.length} · keep typing to narrow it down</div>` : '')
    : '<div class="empty" role="presentation">No matches</div>';
  searchIn.setAttribute('aria-expanded', !searchRes.hidden);
  if (searchHits.length) searchIn.setAttribute('aria-activedescendant', 'sr' + searchActive); else searchIn.removeAttribute('aria-activedescendant');
  $('#sr' + searchActive)?.scrollIntoView({ block: 'nearest' });
}
function closeSearch() {
  searchRes.hidden = true;
  searchIn.setAttribute('aria-expanded', 'false');
  searchIn.removeAttribute('aria-activedescendant');
}
/* select something and bring it into view */
function focusItem(item) {
  select(item.kind, item.id);
  if (ui.view !== '2d') return;
  const L = layout();
  let b = null;
  if (item.kind === 'device') {
    const f = findDev(item.id);
    if (f.dev.mount !== ui.face) setFace(f.dev.mount);
    b = devRect(L, f.rack, f.dev);
  } else if (item.kind === 'rack') {
    const R = L.racks[item.id];
    b = { x: R.x, y: R.top, w: R.w, h: R.h };
  } else if (item.kind === 'cable') {
    const c = doc.cables.find(c => c.id === item.id), port = portMap(L), a = port(c.a, c.id, c.pa), e = port(c.b, c.id, c.pb);
    if (a.side !== ui.face && e.side !== ui.face) setFace(a.side);
    b = { x: Math.min(a.x, e.x), y: Math.min(a.y, e.y), w: Math.abs(a.x - e.x), h: Math.abs(a.y - e.y) };
  }
  if (b) { centerOn({ ...b, x: ui.face === 'rear' ? L.w - b.x - b.w : b.x }); draw2D(); }
}
searchIn.addEventListener('input', () => { searchActive = 0; renderSearch(); });
searchIn.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); searchActive += e.key === 'ArrowDown' ? 1 : -1; renderSearch(); }
  else if (e.key === 'Enter' && searchHits[searchActive]) { focusItem(searchHits[searchActive]); closeSearch(); searchIn.blur(); }
  else if (e.key === 'Escape') { searchIn.value = ''; closeSearch(); searchIn.blur(); }
});
searchIn.addEventListener('focus', () => searchIn.value.trim() && renderSearch());
searchRes.addEventListener('mousedown', e => {
  const b = e.target.closest('[data-i]');
  if (!b) return;
  e.preventDefault();
  focusItem(searchHits[+b.dataset.i]);
  closeSearch();
  searchIn.blur();
});
searchIn.addEventListener('blur', () => setTimeout(closeSearch, 120));

/* ================= toolbar ================= */
$('#viewSeg').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.pane) return setPane('net');
  if (ui.pane === 'net') setPane('racks');
  setView(b.dataset.view);
});
$('#splitBtn').addEventListener('click', () => setPane(ui.pane === 'split' ? 'racks' : 'split'));
$('#faceSeg').addEventListener('click', e => { const b = e.target.closest('[data-face]'); if (b) setFace(b.dataset.face); });
$('#modeSeg').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
cableTypeSel.addEventListener('change', () => { ui.cableType = cableTypeSel.value; renderStyleEditor(); hud(); });
$('#routeSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-route]');
  if (b) { doc.settings.route = b.dataset.route; save(); if (!ui.userMoved) fit(); renderAll(); }
});
$('#tidyBtn').addEventListener('click', () => {
  const t0 = performance.now(), res = optimizeRoutes(undefined, doc.routeOrder || {});   // carry on from the last tidy
  if (res.after >= res.before && doc.routeOrder) return toast(`Already tidy: ${res.before} crossing${res.before === 1 ? '' : 's'}`);
  mutate(() => (doc.routeOrder = res.orders));
  toast(`Tidied: ${res.before} → ${res.after} crossing${res.after === 1 ? '' : 's'} (${Math.round(performance.now() - t0)} ms)`);
});
$('#fitBtn').addEventListener('click', () => { if (ui.view === '3d' && T.ready) frame3D(); else { fit(); draw2D(); } });
$('#zoomIn').addEventListener('click', () => zoomBy(1.25));
$('#zoomOut').addEventListener('click', () => zoomBy(0.8));
$('#undoBtn').addEventListener('click', undo);
$('#redoBtn').addEventListener('click', redo);

/* file menu */
const fileBtn = $('#fileBtn'), fileMenu = $('#fileMenu');
function showMenu(on) { fileMenu.hidden = !on; fileBtn.setAttribute('aria-expanded', on); if (on) keepInside(fileMenu); }
fileBtn.addEventListener('click', e => { e.stopPropagation(); showMenu(fileMenu.hidden); });
document.addEventListener('click', e => { if (!fileMenu.hidden && !e.target.closest('.menu-wrap')) showMenu(false); });
fileMenu.addEventListener('click', e => { if (e.target.closest('[data-closes]')) showMenu(false); });
menuKeys(fileBtn, fileMenu, showMenu);
$('#exportBtn').addEventListener('click', () => download(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), 'rack-layout.json'));
$('#drawingBtn').addEventListener('click', openExport);
$('#csvBtn').addEventListener('click', exportCSV);
const importFile = $('#importFile');
$('#importBtn').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const file = importFile.files[0]; importFile.value = '';
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!validDoc(d)) throw new Error('bad file');
    ui.sel = null; ui.multi.clear();
    mutate(() => { doc = normalize(d); ensurePorts(); });
    hideExample();
    fit(); renderAll();
    if (T.ready) frame3D();
  } catch { toast('That file is not a rack layout'); }
});
/* for drastic buttons: the first click changes the label, a second click within 3 seconds goes ahead (true) */
function armTwice(btn, lbl, text) {
  const was = btn.dataset.label ?? lbl.textContent;
  clearTimeout(btn.armTimer);
  const reset = () => { delete btn.dataset.armed; delete btn.dataset.label; btn.classList.remove('armed'); lbl.textContent = was; };
  if (btn.dataset.armed) { reset(); return true; }
  btn.dataset.armed = '1'; btn.dataset.label = was; btn.classList.add('armed'); lbl.textContent = text;
  btn.armTimer = setTimeout(reset, 3000);
  return false;
}
$('#newBtn').addEventListener('click', e => {
  e.stopPropagation();
  const btn = e.currentTarget;
  if (!armTwice(btn, btn.querySelector('span'), 'Click again to clear everything')) return;
  showMenu(false);
  clearLayout();
  fileBtn.focus();
});
/* an empty layout, keeping the settings (units, colours, cable types); one undo step brings the old one back */
function clearLayout() {
  ui.sel = null; ui.multi.clear(); ui.pending = null; ui.measure = null;
  mutate(() => { const s = doc.settings; doc = blankDoc(); doc.settings = s; });
  hideExample();   // after mutate, so the undo step still knows the racks were an example
  fit(); renderAll();
  toast('Started an empty layout. Undo (Ctrl+Z) brings the previous one back');
}
/* an example in place of the current layout, keeping the settings (units, colours, cable types); one undo step brings the old layout back */
function loadExample(id) {
  ui.sel = null; ui.multi.clear(); ui.pending = null; ui.measure = null; ui.net.userMoved = false;
  mutate(() => { doc = buildExample(id, doc.settings); });
  showExample();
  fit(); renderAll();
  if (T.ready) frame3D();
  toast(`Opened the example “${EXAMPLES[id].label}”. Undo (Ctrl+Z) brings the previous layout back`);
}

/* a note over the racks while they are an example: say so, and offer to start empty (until either button is used) */
const exampleNote = $('#exampleNote');
try {
  if (firstVisit) localStorage.setItem('rackviz.example', '1');
  exampleNote.hidden = localStorage.getItem('rackviz.example') !== '1';
} catch (e) { exampleNote.hidden = !firstVisit; }
ui.example = !exampleNote.hidden;
function setExample(on) {
  ui.example = on;
  exampleNote.hidden = !on;
  try { if (on) localStorage.setItem('rackviz.example', '1'); else localStorage.removeItem('rackviz.example'); } catch (e) { /* ignore */ }
}
const showExample = () => setExample(true), hideExample = () => setExample(false);
$('#exampleClear').addEventListener('click', () => { clearLayout(); $('#emptyAdd').focus(); });
$('#exampleKeep').addEventListener('click', () => { hideExample(); rackListEl.querySelector('[tabindex="0"]')?.focus(); });
window.addEventListener('storage', e => { if (e.key === 'rackviz.example' && !e.newValue) { ui.example = false; exampleNote.hidden = true; } });   // dismissed in another tab

/* the examples: in the File menu and on the empty screen. Replacing a layout of your own asks for a second click */
$('#exampleMenu').insertAdjacentHTML('beforeend', Object.entries(EXAMPLES).map(([id, x]) =>
  `<button role="menuitem" data-example="${id}"><svg class="ic"><use href="#i-rack"/></svg><span class="grow"><span class="ci-main">${esc(x.label)}</span><span class="ci-sub">${esc(x.hint)}</span></span></button>`).join(''));
$('#emptyExamples').innerHTML = Object.entries(EXAMPLES).map(([id, x]) => `<button class="link" data-example="${id}">${esc(x.label)}</button>`).join('');
function pickExample(e) {
  const btn = e.target.closest('[data-example]');
  if (!btn) return;
  if (doc.racks.length && !ui.example && !armTwice(btn, btn.querySelector('.ci-main'), 'Click again to replace your layout')) return;
  loadExample(btn.dataset.example);
  if (btn.closest('#fileMenu')) { showMenu(false); fileBtn.focus(); } else rackListEl.querySelector('[tabindex="0"]')?.focus();
}
fileMenu.addEventListener('click', pickExample);
$('#emptyExamples').addEventListener('click', pickExample);

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
helpDlg.addEventListener('click', e => { if (outsideDialog(helpDlg, e) || e.target.closest('[data-close]')) helpDlg.close(); });

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

/* ================= keyboard ================= */
document.addEventListener('keydown', e => {
  if (document.querySelector('dialog[open], #tour:not([hidden])')) return;   // dialogs and the tour handle their own keys
  // rows that act as buttons (power, connections, selection lists) work like buttons: Enter or Space
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"]:not(button)')) { e.preventDefault(); return e.target.click(); }
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
  const key = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && key === 'k') { e.preventDefault(); return searchIn.focus(); }
  // [ and ] by key position too, so they work on layouts where those keys print something else
  const bracket = e.key === '[' || e.code === 'BracketLeft' ? 'left' : e.key === ']' || e.code === 'BracketRight' ? 'right' : null;
  if (bracket && !typing && !mod && !e.altKey) { e.preventDefault(); return setPanel(bracket, !ui.panels[bracket]); }
  if (typing) return;
  if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) { e.preventDefault(); return redo(); }
  if (mod && key === 'z') { e.preventDefault(); return undo(); }
  if (mod && key === 'c') { e.preventDefault(); return copySel(); }
  if (mod && key === 'v') { e.preventDefault(); return pasteClip(); }
  if (mod && key === 'd') { e.preventDefault(); return duplicateSel(); }
  if (e.key === 'Escape' && !fileMenu.hidden) return showMenu(false);
  if (mod || e.altKey) return;
  if (e.key === 'Escape') {
    if (ui.rewire) { cancelRewire(); return renderAll(); }
    ui.pending = null; ui.measure = null; ui.marquee = null; ui.sel = null; ui.multi.clear(); renderAll();
  }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSel(); }
  else if (key === 'v') setMode('select');
  else if (key === 'c') setMode('connect');
  else if (key === 'm') setMode('measure');
  else if (key === 'r' && ui.view === '2d') setFace(ui.face === 'front' ? 'rear' : 'front');
  else if (key === 'f') { if (ui.pane !== 'racks') fitNet(); if (ui.pane !== 'net') $('#fitBtn').click(); }   // side by side: both
  else if (key === 'n') setPane(ui.pane === 'split' ? 'racks' : 'split');
  else if (key === 'k') setCheck(!ui.check);
  else if (e.key === 'Enter' && document.activeElement === document.body) openDetails();
  else if (e.key === '/') { e.preventDefault(); searchIn.focus(); }
  else if (e.key === '+' || e.key === '=') { if (ui.pane === 'net') netCenterZoom(1.25); else zoomBy(1.25); }
  else if (e.key === '-' || e.key === '_') { if (ui.pane === 'net') netCenterZoom(0.8); else zoomBy(0.8); }
  else if (e.key === '?') helpDlg.showModal();
  else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && selectedDevIds().length) {
    e.preventDefault();
    shiftDevs(selectedDevIds(), e.key === 'ArrowUp' ? 1 : -1);
  }
});

/* ================= render ================= */
function renderStage() {
  if (ui.pane !== 'net') { if (ui.view === '2d') draw2D(); else build3D(); }
  if (ui.pane !== 'racks') drawNet();
  hud();
}
function renderAll() {
  const had = document.activeElement, zone = had?.closest?.('#props, #rackList, #cableList');
  const at = zone && zone !== propsEl ? [...zone.querySelectorAll('[role="option"]')].indexOf(had) : -1;
  for (const id of [...ui.multi]) if (!findDev(id)) ui.multi.delete(id);
  if (ui.multi.size === 1) { ui.sel = { kind: 'device', id: [...ui.multi][0] }; ui.multi.clear(); }
  if (ui.sel) {
    const ok = ui.sel.kind === 'device' ? findDev(ui.sel.id)
      : ui.sel.kind === 'rack' ? doc.racks.some(r => r.id === ui.sel.id)
      : doc.cables.some(c => c.id === ui.sel.id);
    if (!ok) ui.sel = null;
  }
  if (ui.pending && !findDev(ui.pending)) ui.pending = null;
  ui.power = powerModel();
  ui.conn = connectionModel(ui.power);
  stage.classList.toggle('checking', !!ui.check);
  netPane.classList.toggle('checking', !!ui.check);
  mainEl.classList.toggle('checking', !!ui.check);
  // check mode: the list of problems comes first in the right panel (moved in the page, so Tab follows it)
  const chkSec = $('details.sec[data-key="check"]'), first = ui.check ? $('.props-sec') : $('details.sec[data-key="style"]');
  if (chkSec.nextElementSibling !== first) first.before(chkSec);
  applyCatColors();
  syncToolbar();
  renderStyleEditor();
  renderPalette();
  renderRackList();
  renderProps();
  renderCableList();
  renderPowerPanel();
  renderCheckPanel();
  renderRackForm();
  drawConvRuler();
  renderLegend();
  $('#empty').hidden = doc.racks.length > 0;
  if (!doc.racks.length && rackForm.hidden === false) showRackForm(false);
  ui.shownSel = selNow();
  $('#undoBtn').disabled = !undoStack.length;
  $('#redoBtn').disabled = !redoStack.length;
  renderStage();
  // the focused control went away with what it showed (a deleted device, another selection): keep the
  // keyboard where it was working instead of dropping it at the top of the page
  if (zone && !had.isConnected && document.activeElement === document.body) {
    const opts = zone === propsEl ? [] : [...zone.querySelectorAll('[role="option"]')];
    const to = zone === propsEl ? $('#propsTitle') : opts[Math.min(Math.max(at, 0), opts.length - 1)];
    if (to && opts.length) for (const o of opts) o.tabIndex = o === to ? 0 : -1;
    to?.focus({ preventScroll: true });
  }
}
function renderLegend() {
  const n = {};
  doc.cables.forEach(c => (n[c.type] = (n[c.type] || 0) + 1));
  const el = $('#legend'), types = doc.settings.cableTypes.filter(t => n[t.id]);
  el.hidden = !types.length;
  el.innerHTML = types.map(t => `<span><i class="sw line${t.kind === 'power' ? ' thick' : ''}" style="--c:${t.color}"></i>${esc(t.name)} <span class="muted">${n[t.id]}</span></span>`).join('');
}

new ResizeObserver(() => {
  if (!ui.userMoved) fit();
  if (ui.view === '2d') draw2D();
}).observe(stage);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll);
/* another tab saved the layout: follow it instead of overwriting it with an older copy on the next edit */
window.addEventListener('storage', e => {
  if (e.key !== STORE_KEY || !e.newValue) return;
  let d;
  try { d = JSON.parse(e.newValue); } catch { return; }
  if (!validDoc(d)) return;
  pushUndo();   // undo goes back to what this tab had
  ui.drag = null; ui.marquee = null; ui.pending = null; cancelRewire();
  doc = normalize(d);
  ensurePorts();
  renderAll();
  toast('Updated with changes made in another tab');
});

ensurePorts();
save();
applyPreset();
renderConverter();
renderAll();
setPane(ui.pane);
