'use strict';
/* =====================================================================
   Rack Visualizer · 2D elevation
   sceneSVG() draws the racks as seen from the front or the rear. The
   model works in front-view coordinates; the rear view mirrors x so the
   rack you see on the left is the one on your left.
   The same scene feeds the live view and the PNG / SVG / PDF exports.
   ===================================================================== */

const svg = $('#svg'), stage = $('#stage'), hudEl = $('#hud'), toastEl = $('#toast');

function viewMap(L, face) {
  const rear = face === 'rear';
  return { X: x => (rear ? L.w - x : x), VR: (x, w) => (rear ? L.w - x - w : x) };
}

function rulerSVG(L, k) {
  const u = ui.unit, x = -120, H = L.h;
  const minor = u === 'in' ? IN_MM : 10, perMid = u === 'in' ? 6 : 5, perMajor = u === 'in' ? 12 : 10;
  const showMinor = minor * k > 3, showMid = minor * perMid * k > 4;
  const n = Math.ceil(H / minor);
  let s = `<g class="ruler"><line x1="${x}" x2="${x}" y1="${H}" y2="${H - n * minor}"/>`;
  for (let i = 0; i <= n; i++) {
    const major = i % perMajor === 0, mid = i % perMid === 0;
    if (!major && !(mid && showMid) && !showMinor) continue;
    const len = (major ? 14 : mid ? 9 : 5) / k, y = H - i * minor;
    s += `<line x1="${x - len}" x2="${x}" y1="${y}" y2="${y}"/>`;
    if (major && (minor * perMajor * k > 22 || i % (perMajor * 5) === 0)) {
      const v = u === 'in' ? `${i} in` : u === 'cm' ? `${i} cm` : `${i * 10}`;
      s += `<text x="${x - 18 / k}" y="${y}" style="font-size:${11 / k}px">${v}</text>`;
    }
  }
  return s + '</g>';
}

/* o: { face, k (screen px per mm), live (selection + overlays), ruler, cables, labels } */
function sceneSVG(o) {
  const L = layout(), port = portMap(L), used = portUse(), k = o.k, face = o.face, live = !!o.live;
  const { X, VR } = viewMap(L, face);
  let s = `<line class="floor" x1="-300" x2="${L.w + 300}" y1="${L.h}" y2="${L.h}"/>`;
  if (o.ruler !== false) s += rulerSVG(L, k);

  for (const r of doc.racks) {
    const R = L.racks[r.id], px = VR(R.px, PANEL_W);
    s += `<g class="rack${live && isSel('rack', r.id) ? ' sel' : ''}" data-rack="${r.id}">`;
    s += `<rect class="rack-frame" x="${VR(R.x, r.width)}" y="${R.top}" width="${r.width}" height="${R.h}"/>`;
    s += `<rect class="rack-inner" x="${px - 14}" y="${R.railTop}" width="${PANEL_W + 28}" height="${r.units * U_MM}"/>`;
    const every = U_MM * k < 9 ? 5 : 1;
    for (let n = 1; n <= r.units; n++) {
      const y = R.railBottom - n * U_MM;
      s += `<line class="u-tick" x1="${px - 14}" x2="${px}" y1="${y}" y2="${y}"/><line class="u-tick" x1="${px + PANEL_W}" x2="${px + PANEL_W + 14}" y1="${y}" y2="${y}"/>`;
      if (n % every === 0 || n === 1) s += `<text class="u-num" x="${px - 20}" y="${y + U_MM / 2}">${n}</text>`;
    }
    s += `<text class="rack-name" x="${X(R.x + r.width / 2)}" y="${R.top - 28}">${esc(r.name)}</text>`;
    s += `<text class="rack-meta" x="${X(R.x + r.width / 2)}" y="${R.bottom + 34}">${r.units}U · ${usedU(r)}U used · ${fmt(r.width)} × ${fmt(r.depth)}</text>`;
    s += '</g>';
  }

  /* equipment mounted on the far side first, so the near side draws on top */
  const devs = [], numsTop = [];   // port numbers of the near side are drawn last, over the cables
  for (const r of doc.racks) for (const d of r.devices) devs.push({ r, d, near: d.mount === face });
  devs.sort((p, q) => p.near - q.near);
  for (const { r, d, near } of devs) {
    const b = devRect(L, r, d), t = T_(d), vx = VR(b.x, b.w);
    const pl = portLayout(L, r, d).filter(p => p.side === face);
    const sel = live && (isSel('device', d.id) || ui.multi.has(d.id));
    const cs = live && ui.conn?.devs[d.id];
    const chk = live && ui.check && cs && 'chk-' + (cs.level || (cs.power === 'na' && cs.data === 'na' ? 'na' : 'ok'));
    const drg = live && ui.drag?.moved && ui.drag.ids.includes(d.id);
    const dim = chk === 'chk-ok' || chk === 'chk-na';   // check mode fades the devices that are fine
    const cls = ['dev', 'k-' + t.cat, near ? 'near' : 'far', b.vertical && 'zerou', sel && 'sel',
      live && ui.pending === d.id && 'pending', devWarn(r, d) && 'bad', chk,
      drg && 'dragging'].filter(Boolean).join(' ');
    const tip = `${d.name} · ${devU(d)}${near ? '' : ` · mounted at the ${d.mount}, you see its back`}`;
    s += `<g class="${cls}" data-dev="${d.id}"${d.color ? ` style="--c:${d.color}"` : ''}>`;
    if (b.vertical) {
      s += `<rect class="dev-body" x="${vx}" y="${b.y}" width="${b.w}" height="${b.h}" rx="3"><title>${esc(tip)}</title></rect>`;
      s += `<rect class="dev-stripe" x="${vx + 3}" y="${b.y + 3}" width="${b.w - 6}" height="7"/>`;
      s += `<text class="dev-tag" x="${vx + b.w / 2}" y="${b.y - 8}">${esc(clip(d.name, 9))}</text>`;
    } else {
      const room = pl.length ? Math.min(...pl.map(p => VR(p.x, p.w))) - vx - 20 : b.w - 60;
      s += `<rect class="dev-body" x="${vx}" y="${b.y + 1}" width="${b.w}" height="${b.h - 2}" rx="2"><title>${esc(tip)}</title></rect>`;
      s += `<rect class="dev-stripe" x="${vx + 1}" y="${b.y + 2}" width="9" height="${b.h - 4}"/>`;
      s += `<text class="dev-label" x="${vx + 16}" y="${b.y + b.h / 2}">${esc(clip(d.name, Math.max(3, Math.floor(room / 5.6))))}</text>`;
      if (!pl.length) s += `<text class="dev-meta" x="${vx + b.w - 12}" y="${b.y + b.h / 2}">${d.h}U${near ? '' : ' · back'}</text>`;
    }
    const nums = live && PORT * k >= 15;   // close enough to read port numbers
    for (const p of pl) {
      const c = used[d.id]?.[p.key], rt = live && ui.rewire?.target;
      const drop = rt && rt.dev === d.id && rt.key === p.key ? (rt.err ? ' drop-bad' : ' drop-ok') : '';
      const col = c && !drop ? cableColor(c) : '';
      s += `<rect class="pt${p.up ? ' up' : ''}${p.power ? ' pwr' : ''}${c ? ' used' : ''}${drop}"${col ? ` style="fill:${col};stroke:${col}"` : ''}`
        + ` data-port="${p.key}" x="${VR(p.x, p.w)}" y="${p.y}" width="${p.w}" height="${p.h}"${p.power ? ' rx="3.5"' : ''}>`
        + `<title>${esc(portLabel(d, p.key))}${c ? ' · in use' + (live ? ', drag to move the cable' : '') : ''}</title></rect>`;
      if (nums) {   // the halo is the port's own colour, so a cable passing under the number doesn't cut through it
        const halo = drop ? (rt.err ? 'var(--bad)' : 'var(--accent)') : col;
        const num = `<text class="pt-num${c ? ' used' : ''}${drg ? ' dragging' : ''}${dim ? ' dim' : ''}"${halo ? ` style="--halo:${halo}"` : ''} x="${VR(p.x, p.w) + p.w / 2}" y="${p.y + p.h / 2}">${p.key.slice(1)}</text>`;
        if (near) numsTop.push(num); else s += num;
      }
    }
    if (cs) s += ledsSVG(b, vx, cs, k);
    s += '</g>';
  }

  if (o.cables !== false) s += cablesSVG(L, port, o, X, VR);
  return s + numsTop.join('');
}

/* status lights: small dots on the device's colour stripe, power above data (side by side on a vertical PDU).
   Kept tiny; check mode makes them a little larger and never smaller than ~2.5 screen pixels. */
const LED_TEXT = { ok: 'connected', partial: 'partly connected', none: 'not connected', spare: 'spare' };
function ledsSVG(b, vx, cs, k) {
  const leds = [['Power', cs.power, cs.pWhy], ['Data', cs.data, cs.dWhy]].filter(l => l[1] !== 'na');
  if (!leds.length) return '';
  const r = ui.check ? clamp(2.5 / k, 3, 4.2) : 2.3;
  return leds.map(([what, st, why], i) => {
    const off = leds.length > 1 ? (i ? 1 : -1) * Math.max(r + 1.5, 6.5) : 0;
    const [cx, cy] = b.vertical ? [vx + b.w / 2 + off * 0.8, b.y + 6.5] : [vx + 5.5, b.y + b.h / 2 + off];
    return `<circle class="led led-${st}" cx="${cx}" cy="${cy}" r="${r}"><title>${what}: ${LED_TEXT[st]} · ${esc(why)}</title></circle>`;
  }).join('');
}

function cablesSVG(L, port, o, X, VR) {
  const face = o.face, live = !!o.live, k = o.k;
  const routes = doc.settings.route === 'ortho' ? diagramRoutes(L, port, face).routes : null;
  const V = p => ({ x: X(p.x), y: p.y });
  let s = '', handles = '';
  for (const c of doc.cables) {
    const a = port(c.a, c.id, c.pa), b = port(c.b, c.id, c.pb);
    if (!a || !b || (a.side !== face && b.side !== face)) continue;
    const col = cableColor(c), t = ctype(c.type), A = V(a), B = V(b);
    const moving = live && ui.rewire?.moved && ui.rewire.cid === c.id;
    const d = routes?.[c.id] ? roundedPath(routes[c.id].map(V), 10) : bezPath(cableCurve(A, B));
    const partial = a.side !== face || b.side !== face;
    const layer = (t.kind === 'power' ? 'Power cables - ' : 'Cables - ') + t.name;
    s += `<g data-cable="${c.id}" data-layer="${esc(layer)}">`;
    if (live) s += `<path class="cable-hit" d="${d}"/>`;
    s += `<path class="cable${t.kind === 'power' ? ' power' : ''}${partial ? ' back' : ''}${live && isSel('cable', c.id) ? ' sel' : ''}${moving ? ' ghosted' : ''}${cableCheck(c) ? ' warn' : ''}" style="stroke:${col}" d="${d}"><title>${esc(cableLabel(c))}</title></path>`;
    // the plug dot; left out when port numbers show, as the port itself is already in the cable's colour
    if (!(live && PORT * k >= 15)) for (const [P, Q] of [[a, A], [b, B]]) if (P.side === face) s += `<circle class="port" style="fill:${col}" cx="${Q.x}" cy="${Q.y}" r="6"/>`;
    // vertical, reading upwards from just above the plug, so labels on neighbouring ports (14 px apart) don't overlap
    if (o.labels) for (const [P, Q, other] of [[a, A, b], [b, B, a]])
      if (P.side === face) s += `<text class="clabel" transform="translate(${Q.x + 2.4},${Q.y - 9}) rotate(-90)">${esc(c.label || endLabel(other.dev.id, other.key))}</text>`;
    s += '</g>';
    if (!moving && live && isSel('cable', c.id) && ui.mode === 'select') {   // (the moving end is drawn in the overlays)
      for (const [e, P, Q] of [['a', a, A], ['b', b, B]]) if (P.side === face)
        handles += `<circle class="end-handle" data-end="${e}" data-cid="${c.id}" cx="${Q.x}" cy="${Q.y}" r="${7 / k}"><title>Drag to move this end to another port</title></circle>`;
    }
  }
  return s + handles;
}

function overlaysSVG(L, k, face, X, VR) {
  let s = '';
  const c = ui.rewire?.moved && doc.cables.find(c => c.id === ui.rewire.cid);
  if (c) {   // the cable end being moved follows the pointer, or snaps to the port under it
    const port = portMap(L), a = port(c.a, c.id, c.pa), b = port(c.b, c.id, c.pb);
    if (a && b && (a.side === face || b.side === face)) {
      const A = { x: X(a.x), y: a.y }, B = { x: X(b.x), y: b.y }, end = ui.rewire.end;
      const tg = ui.rewire.target, f = tg && !tg.err && findDev(tg.dev);
      const tp = f && portLayout(L, f.rack, f.dev).find(q => q.key === tg.key);
      const m = tp ? { x: VR(tp.x, tp.w) + tp.w / 2, y: tp.y + tp.h / 2 } : ui.hover || (end === 'a' ? A : B);
      s += `<path class="cable preview" style="stroke:${cableColor(c)}" d="${bezPath(end === 'a' ? cableCurve(m, B) : cableCurve(A, m))}"/>`;
    }
  }
  if (ui.pending && ui.hover) {
    const f = findDev(ui.pending);
    if (f) {
      const pp = portLayout(L, f.rack, f.dev).find(p => p.key === ui.pendingPort);
      const b = devRect(L, f.rack, f.dev);
      const ox = pp ? VR(pp.x, pp.w) + pp.w / 2 : VR(b.x, b.w) + b.w / 2, oy = pp ? pp.y + pp.h / 2 : b.y + b.h / 2;
      s += `<line class="pending-line" x1="${ox}" y1="${oy}" x2="${ui.hover.x}" y2="${ui.hover.y}"/>`;
    }
  }
  if (ui.drag?.moved && ui.drag.targets) {
    for (const t of ui.drag.targets) {
      const r = doc.racks.find(r => r.id === t.rackId), f = findDev(t.id);
      if (!r || !f) continue;
      const b = devRect(L, r, { ...f.dev, ...t.patch });
      s += `<rect class="ghost${ui.drag.err ? ' bad' : ''}" x="${VR(b.x, b.w)}" y="${b.y}" width="${b.w}" height="${b.h}"/>`;
    }
    const t = ui.drag.targets[0], f = findDev(t?.id), r = doc.racks.find(r => r.id === t?.rackId);
    if (f && r && !isZeroU(f.dev)) {
      const b = devRect(L, r, { ...f.dev, ...t.patch }), u = t.patch.u;
      s += `<text class="ghost-lbl" x="${VR(b.x, b.w) + b.w + 22}" y="${b.y + b.h / 2}" style="font-size:${12 / k}px;dominant-baseline:central">U${u}${f.dev.h > 1 ? '–' + (u + f.dev.h - 1) : ''}</text>`;
    }
  }
  if (ui.mode === 'select' && ui.hover && !ui.drag && !ui.pan && !ui.rewire && !ui.marquee)
    s += `<line class="hover-line" x1="-120" x2="${L.w + 120}" y1="${ui.hover.y}" y2="${ui.hover.y}"/>`;
  s += hoverLabelsSVG(L, k, face, X);
  if (ui.marquee) {
    const { a, b } = ui.marquee;
    s += `<rect class="marquee" x="${Math.min(a.x, b.x)}" y="${Math.min(a.y, b.y)}" width="${Math.abs(b.x - a.x)}" height="${Math.abs(b.y - a.y)}"/>`;
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
  return s;
}

/* The cable under the pointer is named next to the pointer; the selected cable gets a label at each end.
   Both are drawn on top of everything, at a readable size at any zoom. Showing every label at once piles them
   up where ports are close together, so that is a setting (and what exports use). */
function hoverLabelsSVG(L, k, face, X) {
  if (doc.settings.showLabels) return '';
  const fs = Math.max(6.5, 12 / k), port = portMap(L);
  let s = '';
  for (const c of doc.cables) {
    if (!isSel('cable', c.id)) continue;
    const a = port(c.a, c.id, c.pa), b = port(c.b, c.id, c.pb);
    if (!a || !b) continue;
    for (const [P, other] of [[a, b], [b, a]]) if (P.side === face)
      s += `<text class="clabel hot" style="font-size:${fs}px" transform="translate(${X(P.x) + fs * 0.37},${P.y - 9}) rotate(-90)">${esc(c.label || endLabel(other.dev.id, other.key))}</text>`;
  }
  const idle = ui.mode === 'select' && !ui.drag && !ui.pan && !ui.rewire && !ui.marquee;
  const hc = idle && ui.hover && ui.hoverCable && doc.cables.find(c => c.id === ui.hoverCable);
  if (hc) {   // to the right of the pointer, or to the left when it would run off the drawing
    const txt = cableLabel(hc), pf = 12 / k, dx = pf * 1.1, sx = ui.hover.x * k + ui.cam.x;   // 12 screen px at any zoom
    const flip = sx + 12 * (1.1 + txt.length * 0.6) > svg.clientWidth - 8;
    s += `<text class="clabel hot" style="font-size:${pf}px" x="${ui.hover.x + (flip ? -dx : dx)}" y="${ui.hover.y - pf * 0.8}"${flip ? ' text-anchor="end"' : ''}>${esc(txt)}</text>`;
  }
  return s;
}

/* ---------- live view ---------- */
/* Two layers: the scene (racks, devices, cables), rebuilt when something in it changes or the zoom
   changes, and the overlays (hover line, measure, box, pending cable), cheap enough for every pointer move. */
let drawnK = 0;
const camTransform = () => `translate(${ui.cam.x},${ui.cam.y}) scale(${ui.cam.k})`;
function overlayMarkup() {
  const L = layout(), { X, VR } = viewMap(L, ui.face);
  return overlaysSVG(L, ui.cam.k, ui.face, X, VR);
}
function draw2D() {
  if (ui.view !== '2d') return;
  if (!doc.racks.length) { svg.innerHTML = ''; drawnK = 0; return; }
  const k = ui.cam.k;
  svg.innerHTML = `<g id="camG" transform="${camTransform()}"><g>`
    + sceneSVG({ face: ui.face, k, live: true, labels: doc.settings.showLabels })
    + `</g><g id="overlayG">${overlayMarkup()}</g></g>`;
  drawnK = k;
  $('#zoomLbl').textContent = Math.round(k / (ui.fitK || k) * 100) + '%';
}
/* pan and overlays only; falls back to a full redraw when the zoom changed */
function drawLight() {
  const cam = $('#camG', svg);
  if (ui.view !== '2d' || !cam || ui.cam.k !== drawnK) return draw2D();
  cam.setAttribute('transform', camTransform());
  $('#overlayG', svg).innerHTML = overlayMarkup();
}
/* screen point → view coordinates (mirrored in the rear view) */
function toWorld(e) {
  const r = svg.getBoundingClientRect();
  return { x: (e.clientX - r.left - ui.cam.x) / ui.cam.k, y: (e.clientY - r.top - ui.cam.y) / ui.cam.k };
}
/* view x ↔ front-view x (the mirror is its own inverse) */
const frontX = (L, x) => (ui.face === 'rear' ? L.w - x : x);

function fit() {
  const L = layout(), r = svg.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const ortho = doc.settings.route === 'ortho';
  // only cables between racks use the overhead / underfloor trays
  const between = ortho ? doc.cables.filter(c => { const A = findDev(c.a), B = findDev(c.b); return A && B && A.rack !== B.rack; }) : [];
  const under = between.filter(c => (c.via || doc.settings.via) === 'bottom').length, over = between.length - under;
  // margins for the ruler labels, the bar and legend over the drawing and the zoom controls are in screen
  // pixels, so they depend on the scale: iterate a few times to settle it
  const top = Math.min(...Object.values(L.racks).map(R => R.top), L.h) - (ortho ? 110 + over * LANE : 90);
  const bottom = L.h + (under ? 60 + under * LANE : 30);
  const x1 = Math.max(L.w, 600) + 60;
  const st = $('.stage-top'), padTop = st.offsetHeight ? st.offsetTop + st.offsetHeight : 0;
  let k = 0.2, x0 = -260, y0 = top, y1 = bottom;
  for (let i = 0; i < 3; i++) {
    x0 = -130 - 70 / k;
    y0 = top - padTop / k;
    y1 = bottom + 44 / k;
    k = Math.min(r.width / (x1 - x0), r.height / (y1 - y0)) * 0.96;
  }
  ui.cam = { k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k };
  ui.fitK = k;
  ui.userMoved = false;
}
new ResizeObserver(() => { if (!ui.userMoved && ui.view === '2d' && doc.racks.length) { fit(); draw2D(); } }).observe($('.stage-top'));
/* bring a view-coordinate rectangle into the middle of the screen */
function centerOn(b) {
  const r = svg.getBoundingClientRect();
  if (!r.width) return;
  const k = Math.max(ui.cam.k, (ui.fitK || ui.cam.k) * 2);
  ui.cam = { k, x: r.width / 2 - (b.x + b.w / 2) * k, y: r.height / 2 - (b.y + b.h / 2) * k };
  ui.userMoved = true;
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

function checkSummary() {
  const c = ui.conn;
  if (!c) return '';
  const parts = [c.bad && `${c.bad} not connected`, c.warn && `${c.warn} partly connected`,
    c.cableIssues.length && `${c.cableIssues.length} cable problem${c.cableIssues.length > 1 ? 's' : ''}`].filter(Boolean);
  return parts.length ? `Check: ${parts.join(' · ')}` : `Check: all ${c.checked} devices connected`;
}
function hud() {
  let t = '';
  if (ui.view === '3d') {
    t = ui.mode === 'connect' ? 'Cables are drawn port to port in the 2D view'
      : 'Drag to orbit · right-drag to pan · scroll to zoom · grid = 50 cm · move devices in 2D';
  } else if (ui.mode === 'connect') {
    const pd = ui.pending && findDev(ui.pending)?.dev, small = PORT * ui.cam.k < 9;   // ports too small to aim at
    t = pd ? `${pd.name} ${portName(pd, ui.pendingPort)} → click another device or one of its ports · Esc to cancel`
      : small ? `Click a device to start a cable from its first free port, or zoom in to pick a port · ${ui.face} view`
      : `Click a port to start a cable · ${ui.face} view`;
    const hp = ui.hoverPort && findDev(ui.hoverPort.dev)?.dev, hd = !hp && ui.hoverDev && ui.hoverDev !== ui.pending && findDev(ui.hoverDev)?.dev;
    if (hp) t += `   ·   ${hp.name} ${portLabel(hp, ui.hoverPort.key)} · ${portUse()[hp.id]?.[ui.hoverPort.key] ? 'in use' : 'free'}`;
    else if (hd) { const k = autoPort(hd.id); t += `   ·   ${hd.name}: ${k ? `click for ${portName(hd, k)}` : 'no free port that fits'}`; }
  } else if (ui.mode === 'measure') {
    if (ui.measure) {
      const { a, b } = ui.measure, dy = Math.abs(b.y - a.y), dx = Math.abs(b.x - a.x);
      t = `↕ ${fmt(dy, 'cm')} · ${fmt(dy, 'in')} · ${fmtU(dy)}   ↔ ${fmt(dx, 'cm')} · ${fmt(dx, 'in')}   ⤢ ${fmt(Math.hypot(dx, dy))}`;
    } else t = 'Drag anywhere to measure';
  } else if (ui.rewire?.moved) {
    const rt = ui.rewire.target, td = rt && findDev(rt.dev)?.dev;
    t = !rt ? 'Drop the cable end on a free port · Esc to cancel'
      : rt.err || `→ ${td.name} ${portName(td, rt.key)} · release to move the cable here`;
  } else if (ui.drag?.moved && ui.drag.targets?.length) {
    const tg = ui.drag.targets[0], r = doc.racks.find(r => r.id === tg.rackId);
    t = ui.drag.err || (ui.drag.ids.length > 1 ? `Moving ${ui.drag.ids.length} devices` : `→ ${r.name}${tg.patch.u ? ' · U' + tg.patch.u : ' · ' + tg.patch.side}`);
  } else if (ui.marquee) {
    t = 'Release to select the devices inside the box';
  } else if (ui.hover) {
    const L = layout(), h = L.h - ui.hover.y, r = rackAtX(L, frontX(L, ui.hover.x));
    t = `${fmt(Math.max(0, h))} from floor`;
    if (r) {
      const R = L.racks[r.id], n = Math.floor((R.railBottom - ui.hover.y) / U_MM) + 1;
      if (n >= 1 && n <= r.units) {
        const d = r.devices.find(d => !isZeroU(d) && n >= d.u && n <= d.u + d.h - 1 && d.mount === ui.face)
          || r.devices.find(d => !isZeroU(d) && n >= d.u && n <= d.u + d.h - 1);
        t = `${r.name} · U${n}${d ? ' · ' + d.name : ' · free'} · ${t}`;
        const cs = ui.check && d && ui.conn?.devs[d.id];
        if (cs) t = `${r.name} · U${n} · ${d.name}${cs.power !== 'na' ? ` · Power: ${cs.pWhy}` : ''}${cs.data !== 'na' ? ` · Data: ${cs.dWhy}` : ''}`;
      }
    }
    t = `${ui.face === 'rear' ? 'Rear' : 'Front'} view · ${t}`;
  }
  if (ui.check && !t) t = checkSummary() + ' · K to leave check mode';
  hudEl.textContent = t;
}

/* light: only the camera or the overlays changed (see drawLight) */
let rafPending = false, rafFull = false;
function schedule(light = false) {
  if (!light) rafFull = true;
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    const full = rafFull;
    rafPending = false; rafFull = false;
    if (full) draw2D(); else drawLight();
    hud();
  });
}
