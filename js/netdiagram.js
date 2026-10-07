'use strict';
/* =====================================================================
   Rack Visualizer · network diagram
   The connections drawn as a diagram: every device with ports is a box,
   the cables between two devices one link (with a count when there are
   several). "Data" shows the network, "Power" the power chain from the
   building feed down. Laid out top-down in layers, the way network
   diagrams usually are. Shown on its own or next to the racks; both
   views share the selection.
   ===================================================================== */

const netPane = $('#netPane'), netSvg = $('#netSvg');
const NODE_W = 176, NODE_H = 56, ROW_GAP = 86, COL_GAP = 28, COMP_GAP = 96, LOOSE_GAP = 70;
ui.net = { layer: 'data', cam: { x: 0, y: 0, k: 1 }, fitK: 1, userMoved: false, bounds: null, lastSel: null };
try { ui.net.layer = localStorage.getItem('rackviz.netLayer') === 'power' ? 'power' : 'data'; } catch (e) { /* ignore */ }

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

/* ---------- layout ----------
   per connected group: layers (data: steps from the incoming lines; power: longest chain from the feed),
   order within a layer by the barycentre of the neighbours (fewer crossings), then x near the
   neighbours. Groups side by side, devices with nothing connected in a grid below. */
function netLayout(G) {
  const nodes = [...G.nodes.values()], power = G.layer === 'power';
  const other = (n, l) => G.nodes.get(l.a === n.id ? l.b : l.a);
  const comps = [], seen = new Set();
  for (const n of nodes) {
    if (seen.has(n.id) || !n.links.length) continue;
    const list = [], stack = [n];
    seen.add(n.id);
    while (stack.length) {
      const m = stack.pop(); list.push(m);
      for (const l of m.links) { const o = other(m, l); if (!seen.has(o.id)) { seen.add(o.id); stack.push(o); } }
    }
    comps.push(list);
  }
  comps.sort((p, q) => q.length - p.length);
  const loose = nodes.filter(n => !n.links.length).sort((p, q) => physOrder(p) - physOrder(q));

  let x0 = 0, maxY = 0;
  for (const list of comps) {
    /* layers */
    if (power) {
      for (const n of list) n.layer = n.mains || !n.links.some(l => l.b === n.id) ? 0 : -1;
      for (let i = 0; i < list.length; i++) for (const n of list) for (const l of n.links)
        if (l.a === n.id && n.layer >= 0) { const o = G.nodes.get(l.b); o.layer = Math.min(list.length, Math.max(o.layer, n.layer + 1)); }
      for (const n of list) if (n.layer < 0) n.layer = 0;   // a loop with no way in
    } else {
      const top = Math.min(...list.map(n => netTier(n.dev)));
      const queue = list.filter(n => netTier(n.dev) === top).sort((p, q) => physOrder(p) - physOrder(q));
      for (const n of list) n.layer = -1;
      for (const n of queue) n.layer = 0;
      for (let i = 0; i < queue.length; i++)
        for (const l of queue[i].links) { const o = other(queue[i], l); if (o.layer < 0) { o.layer = queue[i].layer + 1; queue.push(o); } }
    }
    /* order within layers */
    const rows = [];
    for (const n of list.sort((p, q) => physOrder(p) - physOrder(q))) (rows[n.layer] ||= []).push(n);
    for (let i = 0; i < rows.length; i++) rows[i] ||= [];
    const idx = () => rows.forEach(r => r.forEach((n, i) => (n.ord = i)));
    idx();
    const bary = (n, d) => { const v = n.links.map(l => other(n, l)).filter(o => o.layer === n.layer + d).map(o => o.ord); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : n.ord; };
    for (let pass = 0; pass < 6; pass++) {
      const down = pass % 2 === 0;
      for (let k = down ? 1 : rows.length - 2; down ? k < rows.length : k >= 0; k += down ? 1 : -1) {
        rows[k].sort((p, q) => bary(p, down ? -1 : 1) - bary(q, down ? -1 : 1) || p.ord - q.ord);
        rows[k].forEach((n, i) => (n.ord = i));
      }
    }
    /* x near the neighbours, keeping the order and the spacing */
    const step = NODE_W + COL_GAP;
    rows.forEach(r => r.forEach((n, i) => (n.x = i * step)));
    const want = (n, d) => { const v = n.links.map(l => other(n, l)).filter(o => d.includes(o.layer - n.layer)).map(o => o.x); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : n.x; };
    for (let pass = 0; pass < 8; pass++) {
      for (const r of pass % 2 ? [...rows].reverse() : rows) {
        if (!r.length) continue;
        const d = r.map(n => want(n, pass % 2 ? [1] : [-1]));
        const pos = [...d];
        for (let i = 1; i < pos.length; i++) pos[i] = Math.max(pos[i], pos[i - 1] + step);
        const shift = d.reduce((s, x, i) => s + x - pos[i], 0) / d.length;
        r.forEach((n, i) => (n.x = pos[i] + shift));
      }
    }
    const minX = Math.min(...list.map(n => n.x)), maxX = Math.max(...list.map(n => n.x));
    for (const n of list) { n.x += x0 - minX; n.y = n.layer * (NODE_H + ROW_GAP); maxY = Math.max(maxY, n.y + NODE_H); }
    x0 += maxX - minX + NODE_W + COMP_GAP;
  }
  /* nothing connected: a grid below */
  const width = Math.max(x0 - COMP_GAP, 4 * (NODE_W + COL_GAP)), cols = Math.max(1, Math.floor((width + COL_GAP) / (NODE_W + COL_GAP)));
  const looseY = comps.length ? maxY + LOOSE_GAP : 30;
  loose.forEach((n, i) => { n.x = (i % cols) * (NODE_W + COL_GAP); n.y = looseY + Math.floor(i / cols) * (NODE_H + 18); });
  const all = [...comps.flat(), ...loose];
  const bounds = all.length ? { x: Math.min(...all.map(n => n.x)) - 30, y: Math.min(...all.map(n => n.y)) - (loose.length && !comps.length ? 60 : 30),
    w: 0, h: 0 } : { x: 0, y: 0, w: 400, h: 200 };
  if (all.length) { bounds.w = Math.max(...all.map(n => n.x + NODE_W)) + 30 - bounds.x; bounds.h = Math.max(...all.map(n => n.y + NODE_H)) + 30 - bounds.y; }
  return { comps, loose, looseY, bounds };
}
/* rack order, then top to bottom: keeps the diagram close to how the racks read */
function physOrder(n) {
  if (n.mains) return -1;
  return doc.racks.indexOf(n.rack) * 1000 + (n.rack.units - (isZeroU(n.dev) ? 0 : n.dev.u));
}

/* ---------- drawing ---------- */
function netLinkGeometry(G) {
  /* spread the link ends along each box's top and bottom edge, ordered by where the other box is */
  const ends = new Map(), push = (n, edge, l, ox) => (ends.get(n.id + edge) || ends.set(n.id + edge, []).get(n.id + edge)).push({ l, ox });
  const geo = new Map();
  for (const l of G.links.values()) {
    const A = G.nodes.get(l.a), B = G.nodes.get(l.b);
    if (A.layer === B.layer && A.y === B.y) { geo.set(l.id, { same: true, A, B }); continue; }
    const [U, D] = A.y < B.y ? [A, B] : [B, A];
    geo.set(l.id, { U, D, flip: U !== A });
    push(U, 'b', l, D.x); push(D, 't', l, U.x);
  }
  for (const [key, list] of ends) {
    list.sort((p, q) => p.ox - q.ox);
    const span = Math.min(NODE_W * 0.7, (list.length - 1) * 16);
    list.forEach((e, i) => { const g = geo.get(e.l.id), off = list.length > 1 ? -span / 2 + i * span / (list.length - 1) : 0; if (key.endsWith('b')) g.ux = off; else g.dx = off; });
  }
  for (const g of geo.values()) {
    if (g.same) {
      const [L, R] = g.A.x < g.B.x ? [g.A, g.B] : [g.B, g.A];
      if (R.x - L.x <= NODE_W + COL_GAP + 1) { g.d = `M${L.x + NODE_W},${L.y + NODE_H / 2} L${R.x},${R.y + NODE_H / 2}`; g.mid = { x: (L.x + NODE_W + R.x) / 2, y: L.y + NODE_H / 2 }; }
      else { const y = L.y + NODE_H, x1 = L.x + NODE_W / 2, x2 = R.x + NODE_W / 2; g.d = `M${x1},${y} C${x1},${y + 46} ${x2},${y + 46} ${x2},${y}`; g.mid = { x: (x1 + x2) / 2, y: y + 35 }; }
      g.ends = [[L, L.x + NODE_W, L.y + NODE_H / 2], [R, R.x, R.y + NODE_H / 2]];
      continue;
    }
    const x1 = g.U.x + NODE_W / 2 + (g.ux || 0), y1 = g.U.y + NODE_H, x2 = g.D.x + NODE_W / 2 + (g.dx || 0), y2 = g.D.y, dy = Math.max(30, (y2 - y1) / 2);
    g.d = `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
    g.mid = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
    g.ends = [[g.U, x1, y1], [g.D, x2, y2]];
  }
  return geo;
}
function netNodeSVG(n, G) {
  if (n.mains) return `<g class="nn mains" transform="translate(${n.x},${n.y})"><rect class="nn-box" width="${NODE_W}" height="${NODE_H}" rx="10"/>`
    + `<text class="nn-name" x="${NODE_W / 2}" y="25" text-anchor="middle">Building power</text><text class="nn-sub" x="${NODE_W / 2}" y="42" text-anchor="middle">where the power chain starts</text></g>`;
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
  return `<g class="nn k-${T_(d).cat}${sel ? ' sel' : ''}${chk}" data-ndev="${d.id}" transform="translate(${n.x},${n.y})"${d.color ? ` style="--c:${d.color}"` : ''}>`
    + `<rect class="nn-box" width="${NODE_W}" height="${NODE_H}" rx="8"><title>${esc(`${d.name} · ${T_(d).label} · ${loc}`)}</title></rect>`
    + `<rect class="nn-stripe" x="5" y="7" width="4" height="${NODE_H - 14}" rx="2"/>`
    + `<text class="nn-name" x="16" y="20">${esc(clip(d.name, 19))}</text>`
    + `<text class="nn-sub" x="16" y="35">${esc(clip(sub, 26))}</text>`
    + `<text class="nn-loc" x="16" y="49">${esc(clip(loc, 28))}</text>${lights}</g>`;
}
function netLinkSVG(l, g, G, k) {
  if (l.feed) return `<g class="nl feed"><path class="nl-line" d="${g.d}"/></g>`;
  const c0 = l.cables[0].c, t = ctype(c0.type), n = l.cables.length;
  const sel = l.cables.some(x => isSel('cable', x.c.id)), near = isSel('device', l.a) || isSel('device', l.b);
  const ports = end => { const ks = l.cables.map(x => portShort(x[end])); return ks.length > 3 ? `${ks[0]}…${ks[ks.length - 1]}` : ks.join(', '); };
  let s = `<g class="nl${t.kind === 'power' ? ' power' : ''}${sel ? ' sel' : ''}" data-nlink="${esc(l.id)}">`
    + `<path class="nl-hit" d="${g.d}"/><path class="nl-line" style="stroke:${cableColor(c0)}" d="${g.d}"/>`
    + `<title>${esc(l.cables.map(x => `${cableLabel(x.c)} · ${ctype(x.c.type).name}`).join('\n'))}</title>`;
  if (n > 1) s += `<circle class="nl-count" cx="${g.mid.x}" cy="${g.mid.y}" r="9"/><text class="nl-count-t" x="${g.mid.x}" y="${g.mid.y}">${n}</text>`;
  if (k >= 0.8 || sel || near) {   // port names at both ends, once there is room to read them
    for (const [N, x, y] of g.ends) {
      const end = N.id === l.a ? 'pa' : 'pb', below = y === N.y + NODE_H;
      s += `<text class="nl-port" x="${x + 5}" y="${below ? y + 11 : y === N.y ? y - 5 : y - 6}">${esc(ports(end))}</text>`;
    }
  }
  return s + '</g>';
}
function netSVG(G, Lo, k) {
  const geo = netLinkGeometry(G);
  let s = '<g class="nl-all">';
  for (const l of G.links.values()) s += netLinkSVG(l, geo.get(l.id), G, k);
  s += '</g><g class="nn-all">';
  for (const n of G.nodes.values()) s += netNodeSVG(n, G);
  s += '</g>';
  if (Lo.loose.length) s += `<text class="net-group" x="0" y="${Lo.looseY - 14}">${G.layer === 'power' ? 'No power cable' : 'No data connection'} · ${Lo.loose.length}</text>`;
  return s;
}

/* ---------- view ---------- */
const netVisible = () => ui.pane === 'net' || ui.pane === 'split';
function drawNet() {
  if (!netVisible()) return;
  const G = netGraph(ui.net.layer), Lo = netLayout(G);
  ui.net.G = G; ui.net.bounds = Lo.bounds;
  $('#netEmpty').hidden = G.nodes.size > 0;
  $('#netEmpty p').textContent = !doc.racks.length ? 'Add racks and equipment to see how they connect.'
    : ui.net.layer === 'power' ? 'No equipment with power ports yet.' : 'No equipment with data ports yet.';
  if (!ui.net.userMoved) fitNet(false);
  revealNetSel();
  netSvg.innerHTML = `<g id="netCam" transform="translate(${ui.net.cam.x},${ui.net.cam.y}) scale(${ui.net.cam.k})">${netSVG(G, Lo, ui.net.cam.k)}</g>`;
  ui.net.drawnK = ui.net.cam.k;
  for (const b of document.querySelectorAll('#netLayerSeg button')) b.classList.toggle('on', b.dataset.layer === ui.net.layer);
  const used = new Map();
  for (const l of G.links.values()) for (const x of l.cables) used.set(x.c.type, (used.get(x.c.type) || 0) + 1);
  $('#netLegend').hidden = !used.size;
  $('#netLegend').innerHTML = [...used].map(([id, n]) => { const t = ctype(id); return `<span><i class="sw line${t.kind === 'power' ? ' thick' : ''}" style="--c:${t.color}"></i>${esc(t.name)} <span class="muted">${n}</span></span>`; }).join('');
}
function netCamOnly() {   // pan: move the drawing, redraw only when the zoom changed (port labels depend on it)
  const cam = $('#netCam', netSvg);
  if (!cam || ui.net.cam.k !== ui.net.drawnK) return drawNet();
  cam.setAttribute('transform', `translate(${ui.net.cam.x},${ui.net.cam.y}) scale(${ui.net.cam.k})`);
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

/* ---------- interaction: drag to pan, wheel or pinch to zoom, click to select ---------- */
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
  netDrag = { sx: e.clientX, sy: e.clientY, cx: ui.net.cam.x, cy: ui.net.cam.y, target: e.target, moved: false };
});
netSvg.addEventListener('pointermove', e => {
  if (netTouch.has(e.pointerId)) netTouch.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (netPinch && netTouch.size === 2) {
    const [a, b] = [...netTouch.values()], p = netPinch, k2 = clamp(p.cam.k * (Math.hypot(a.x - b.x, a.y - b.y) || 1) / p.d, 0.15, 4);
    ui.net.cam = { k: k2, x: p.mx - (p.mx - p.cam.x) * k2 / p.cam.k, y: p.my - (p.my - p.cam.y) * k2 / p.cam.k };
    ui.net.userMoved = true;
    return netCamOnly();
  }
  if (!netDrag) return;
  if (!netDrag.moved && Math.hypot(e.clientX - netDrag.sx, e.clientY - netDrag.sy) < 4) return;
  netDrag.moved = true;
  netSvg.classList.add('panning');
  ui.net.cam.x = netDrag.cx + e.clientX - netDrag.sx;
  ui.net.cam.y = netDrag.cy + e.clientY - netDrag.sy;
  ui.net.userMoved = true;
  netCamOnly();
});
function netPointerEnd(e) {
  netTouch.delete(e.pointerId);
  if (netPinch) { if (netTouch.size < 2) netPinch = null; netDrag = null; return; }
  const d = netDrag;
  netDrag = null;
  netSvg.classList.remove('panning');
  if (!d || d.moved || e.type === 'pointercancel') return;
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
  if (ui.sel || ui.multi.size) select(null);
}
netSvg.addEventListener('pointerup', netPointerEnd);
netSvg.addEventListener('pointercancel', netPointerEnd);
netSvg.addEventListener('wheel', e => {
  e.preventDefault();
  const r = netSvg.getBoundingClientRect();
  netZoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });
$('#netLayerSeg').addEventListener('click', e => {
  const b = e.target.closest('[data-layer]');
  if (!b || b.dataset.layer === ui.net.layer) return;
  ui.net.layer = b.dataset.layer;
  try { localStorage.setItem('rackviz.netLayer', ui.net.layer); } catch (err) { /* ignore */ }
  ui.net.userMoved = false;
  drawNet();
});
const netCenterZoom = f => { const r = netSvg.getBoundingClientRect(); netZoomAt(r.width / 2, r.height / 2, f); };
$('#netZoomIn').addEventListener('click', () => netCenterZoom(1.25));
$('#netZoomOut').addEventListener('click', () => netCenterZoom(0.8));
$('#netFit').addEventListener('click', () => fitNet());
new ResizeObserver(() => { if (!netVisible()) return; if (!ui.net.userMoved) fitNet(); else drawNet(); }).observe(netPane);
