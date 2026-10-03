'use strict';
/* =====================================================================
   Rack Visualizer · exports
   Drawings: the 2D scene is rendered off-screen with a print theme, read
   back as simple primitives (paths and text) sorted into layers, then
   written as SVG (Inkscape / Illustrator layers), PDF (optional-content
   layers, which AutoCAD's PDFIMPORT and Acrobat understand) or PNG.
   Everything is to scale: 1:N, with world units in millimetres.
   Also: the bill of materials as CSV.
   ===================================================================== */

const PX_MM = 0.25;   // 1 screen pixel of line width becomes 0.25 mm on paper
const LAYER_ORDER = ['Title', 'Floor', 'Ruler', 'Racks', 'Rack units', 'Devices (far side)', 'Devices', 'Data ports', 'Power ports',
  '*cables', 'Labels', 'Cable labels', 'Other'];

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- scene → primitives ---------- */
function scenePrims(face, opts, N) {
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  host.setAttribute('class', 'scene print');
  host.style.cssText = 'position:fixed;left:-30000px;top:0;width:10px;height:10px;overflow:hidden';
  host.innerHTML = sceneSVG({ face, k: 1 / (PX_MM * N), ruler: opts.ruler, cables: opts.cables, labels: opts.labels });
  document.body.appendChild(host);
  try { return collectPrims(host); } finally { host.remove(); }
}
function layerOf(el) {
  const c = el.classList, up = s => el.closest(s);
  if (c.contains('cable-hit') || c.contains('end-handle')) return null;
  if (up('.ruler')) return 'Ruler';
  if (c.contains('floor')) return 'Floor';
  const cab = up('[data-cable]');
  if (cab) return c.contains('clabel') ? 'Cable labels' : cab.dataset.layer || 'Cables';
  if (c.contains('rack-frame') || c.contains('rack-inner')) return 'Racks';
  if (c.contains('u-tick') || c.contains('u-num')) return 'Rack units';
  if (el.tagName === 'text') return 'Labels';
  if (c.contains('pt')) return c.contains('pwr') ? 'Power ports' : 'Data ports';
  const dev = up('.dev');
  if (dev) return dev.classList.contains('far') ? 'Devices (far side)' : 'Devices';
  return 'Other';
}
/* computed colour → [r, g, b] blended onto white by its opacity, or null when invisible */
function paint(v, op) {
  const m = /rgba?\(([^)]+)\)/.exec(v || '');
  if (!m) return null;
  const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
  const al = a * op;
  if (al < 0.02) return null;
  return [r, g, b].map(x => Math.round(x * al + 255 * (1 - al)));
}
function parsePath(d) {
  const toks = d.match(/[MLCQZ]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const out = [];
  let i = 0, cmd = '', cx = 0, cy = 0;
  const nx = () => +toks[i++];
  while (i < toks.length) {
    if (/^[A-Za-z]$/.test(toks[i])) cmd = toks[i++].toUpperCase();
    if (cmd === 'Z') { out.push(['Z']); cmd = ''; continue; }
    if (cmd === 'M' || cmd === 'L') { cx = nx(); cy = nx(); out.push([cmd, cx, cy]); if (cmd === 'M') cmd = 'L'; }
    else if (cmd === 'C') { const a = [nx(), nx(), nx(), nx(), nx(), nx()]; out.push(['C', ...a]); cx = a[4]; cy = a[5]; }
    else if (cmd === 'Q') {
      const qx = nx(), qy = nx(), x = nx(), y = nx();
      out.push(['C', cx + 2 / 3 * (qx - cx), cy + 2 / 3 * (qy - cy), x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), x, y]);
      cx = x; cy = y;
    } else i++;
  }
  return out;
}
function toSegs(el) {
  const n = a => +el.getAttribute(a) || 0;
  switch (el.tagName) {
    case 'rect': {
      const x = n('x'), y = n('y'), w = n('width'), h = n('height');
      return [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']];
    }
    case 'line': return [['M', n('x1'), n('y1')], ['L', n('x2'), n('y2')]];
    case 'circle': {
      const cx = n('cx'), cy = n('cy'), r = n('r'), m = r * 0.5523;
      return [['M', cx + r, cy], ['C', cx + r, cy + m, cx + m, cy + r, cx, cy + r], ['C', cx - m, cy + r, cx - r, cy + m, cx - r, cy],
        ['C', cx - r, cy - m, cx - m, cy - r, cx, cy - r], ['C', cx + m, cy - r, cx + r, cy - m, cx + r, cy], ['Z']];
    }
    default: return parsePath(el.getAttribute('d') || '');
  }
}
function collectPrims(root) {
  const prims = [];
  const opacityOf = el => { let o = 1; for (let e = el; e && e !== root; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  for (const el of root.querySelectorAll('rect, line, path, circle, text')) {
    const layer = layerOf(el); if (!layer) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none') continue;
    const op = opacityOf(el);
    if (op < 0.03) continue;
    const fill = paint(cs.fill, op);
    if (el.tagName === 'text') {
      if (fill && el.textContent.trim()) prims.push({ layer, t: 'text', x: +el.getAttribute('x'), y: +el.getAttribute('y'), text: el.textContent,
        size: parseFloat(cs.fontSize), bold: parseInt(cs.fontWeight, 10) >= 600, anchor: cs.textAnchor, central: cs.dominantBaseline === 'central', fill });
      continue;
    }
    const sw = parseFloat(cs.strokeWidth) || 0, stroke = sw ? paint(cs.stroke, op) : null;
    if (!fill && !stroke) continue;
    const dash = cs.strokeDasharray && cs.strokeDasharray !== 'none' ? cs.strokeDasharray.split(/[ ,]+/).map(parseFloat).filter(v => v > 0) : null;
    prims.push({ layer, t: 'path', segs: toSegs(el), fill, stroke, sw, dash });
  }
  return prims;
}
const measureCtx = document.createElement('canvas').getContext('2d');
function textWidth(text, size, bold) {
  measureCtx.font = `${bold ? 'bold ' : ''}100px Helvetica, Arial, sans-serif`;
  return measureCtx.measureText(text).width / 100 * size;
}
function primBounds(prims) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const p of prims) {
    if (p.t === 'text') {
      const w = textWidth(p.text, p.size, p.bold), x = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x;
      add(x, p.y - p.size); add(x + w, p.y + p.size * 0.4);
    } else for (const s of p.segs) for (let i = 1; i + 1 < s.length; i += 2) add(s[i], s[i + 1]);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
function orderLayers(prims) {
  const rank = l => { const i = LAYER_ORDER.indexOf(l); return i >= 0 ? i : /cables/i.test(l) ? LAYER_ORDER.indexOf('*cables') : LAYER_ORDER.length; };
  return [...new Set(prims.map(p => p.layer))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/* build the drawing: one or two views (front above rear), a title, margins */
function buildDrawing(opts, N) {
  const faces = opts.face === 'both' ? ['front', 'rear'] : [opts.face];
  let prims = [], yOff = 0;
  const size = 3.5 * N;   // title text: 3.5 mm on paper
  for (const face of faces) {
    let p = scenePrims(face, opts, N);
    const bb = primBounds(p), dy = yOff - bb.y + (opts.title ? size * 2.2 : 0);
    p = p.map(q => shiftPrim(q, dy));
    if (opts.title) prims.push({ layer: 'Title', t: 'text', x: bb.x, y: yOff + size, text: `${face === 'front' ? 'FRONT' : 'REAR'} ELEVATION · scale 1:${N}`, size, bold: true, anchor: 'start', fill: [17, 17, 17] });
    prims = prims.concat(p);
    yOff += bb.h + (opts.title ? size * 2.2 : 0) + 25 * N;
  }
  if (opts.title) {
    const bb = primBounds(prims);
    prims.push({ layer: 'Title', t: 'text', x: bb.x, y: bb.y + bb.h + size * 2, text: `Rack Visualizer · ${new Date().toISOString().slice(0, 10)} · dimensions in mm`, size: size * 0.75, bold: false, anchor: 'start', fill: [90, 90, 90] });
  }
  const bb = primBounds(prims), m = 10 * N;   // 10 mm paper margin
  return { prims, bb: { x: bb.x - m, y: bb.y - m, w: bb.w + 2 * m, h: bb.h + 2 * m } };
}
function shiftPrim(p, dy) {
  if (p.t === 'text') return { ...p, y: p.y + dy };
  return { ...p, segs: p.segs.map(s => s.map((v, i) => (i > 0 && i % 2 === 0 ? v + dy : v))) };
}

/* ---------- writers ---------- */
const f3 = v => +(+v).toFixed(3);
function segsToD(segs) {
  return segs.map(s => s[0] === 'Z' ? 'Z' : s[0] + s.slice(1).map(v => f3(v)).join(' ')).join(' ');
}
function primsToSVG(prims, bb, N, bg) {
  const col = c => (c ? `rgb(${c.join(',')})` : 'none');
  const k = PX_MM * N;
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1"`
    + ` width="${f3(bb.w / N)}mm" height="${f3(bb.h / N)}mm" viewBox="${f3(bb.x)} ${f3(bb.y)} ${f3(bb.w)} ${f3(bb.h)}">\n`
    + `<title>Rack Visualizer drawing, scale 1:${N}, units mm</title>\n`;
  if (bg) s += `<rect x="${f3(bb.x)}" y="${f3(bb.y)}" width="${f3(bb.w)}" height="${f3(bb.h)}" fill="#ffffff"/>\n`;
  for (const L of orderLayers(prims)) {
    s += `<g id="${L.toLowerCase().replace(/[^a-z0-9]+/g, '-')}" inkscape:groupmode="layer" inkscape:label="${esc(L)}">\n`;
    for (const p of prims) {
      if (p.layer !== L) continue;
      if (p.t === 'text') {
        const y = p.central ? p.y + p.size * 0.35 : p.y;
        s += `<text x="${f3(p.x)}" y="${f3(y)}" font-family="Helvetica, Arial, sans-serif" font-size="${f3(p.size)}"${p.bold ? ' font-weight="bold"' : ''}`
          + `${p.anchor && p.anchor !== 'start' ? ` text-anchor="${p.anchor}"` : ''} fill="${col(p.fill)}">${esc(p.text)}</text>\n`;
      } else {
        s += `<path d="${segsToD(p.segs)}" fill="${col(p.fill)}"`
          + (p.stroke ? ` stroke="${col(p.stroke)}" stroke-width="${f3(p.sw * k)}" stroke-linecap="round" stroke-linejoin="round"` : '')
          + (p.stroke && p.dash?.length ? ` stroke-dasharray="${p.dash.map(v => f3(v * k)).join(' ')}"` : '') + '/>\n';
      }
    }
    s += '</g>\n';
  }
  return s + '</svg>\n';
}
/* PDF strings in WinAnsi (the standard Helvetica encoding) */
function pdfStr(str) {
  const map = { '·': 183, '…': 133, '–': 150, '—': 151, '×': 215, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '€': 128, '°': 176 };
  const rep = { '↔': '<->', '→': '->', '←': '<-', '↕': '|', '⤢': '/', '⚠': '!' };
  let out = '';
  for (const ch of String(str)) {
    if (rep[ch]) { out += rep[ch]; continue; }
    let c = map[ch] ?? ch.charCodeAt(0);
    if (c > 255) c = 63;
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (c < 32 || c > 126) out += '\\' + c.toString(8).padStart(3, '0');
    else out += ch;
  }
  return '(' + out + ')';
}
function primsToPDF(prims, bb, N) {
  const s = 72 / 25.4 / N, W = bb.w * s, H = bb.h * s, k = PX_MM * N;
  const rgb = c => c.map(v => f3(v / 255)).join(' ');
  const layers = orderLayers(prims);
  let content = `q ${f3(s)} 0 0 ${f3(-s)} ${f3(-bb.x * s)} ${f3(H + bb.y * s)} cm 1 J 1 j\n`;
  layers.forEach((L, li) => {
    content += `/OC /L${li} BDC\n`;
    for (const p of prims) {
      if (p.layer !== L) continue;
      if (p.t === 'text') {
        const w = textWidth(p.text, p.size, p.bold);
        const x = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x;
        const y = p.central ? p.y + p.size * 0.35 : p.y;
        content += `${rgb(p.fill)} rg BT /${p.bold ? 'F2' : 'F1'} ${f3(p.size)} Tf 1 0 0 -1 ${f3(x)} ${f3(y)} Tm ${pdfStr(p.text)} Tj ET\n`;
        continue;
      }
      let o = '';
      if (p.fill) o += `${rgb(p.fill)} rg `;
      if (p.stroke) o += `${rgb(p.stroke)} RG ${f3(p.sw * k)} w ${p.dash?.length ? `[${p.dash.map(v => f3(v * k)).join(' ')}] 0 d` : '[] 0 d'} `;
      for (const sg of p.segs) {
        o += sg[0] === 'M' ? `${f3(sg[1])} ${f3(sg[2])} m ` : sg[0] === 'L' ? `${f3(sg[1])} ${f3(sg[2])} l `
          : sg[0] === 'C' ? `${sg.slice(1).map(f3).join(' ')} c ` : 'h ';
      }
      content += o + (p.fill && p.stroke ? 'B\n' : p.fill ? 'f\n' : 'S\n');
    }
    content += 'EMC\n';
  });
  content += 'Q\n';
  const first = 7, refs = layers.map((_, i) => `${first + i} 0 R`).join(' ');
  const now = new Date(), pad = v => String(v).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const objs = [
    `<< /Type /Catalog /Pages 2 0 R /PageMode /UseOC /OCProperties << /OCGs [${refs}] /D << /Name (Layers) /Order [${refs}] /ON [${refs}] /BaseState /ON >> >> >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f3(W)} ${f3(H)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /Properties << ${layers.map((_, i) => `/L${i} ${first + i} 0 R`).join(' ')} >> >> >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ...layers.map(L => `<< /Type /OCG /Name ${pdfStr(L)} >>`),
    `<< /Title (Rack layout 1:${N}) /Producer (Rack Visualizer) /CreationDate (D:${stamp}) >>`,
  ];
  let out = '%PDF-1.6\n%\xE2\xE3\xCF\xD3\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([Uint8Array.from(out, ch => ch.charCodeAt(0) & 255)], { type: 'application/pdf' });
}
async function svgToPng(svgText, bb, width) {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = Math.round(width * bb.h / bb.w);
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('the image is too large for this browser. Pick a smaller width');
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

/* ---------- export dialog ---------- */
const exportDlg = $('#exportDlg'), exportForm = $('#exportForm');
function openExport() {
  if (!doc.racks.length) return toast('Add a rack first');
  exportForm.face.value = ui.face;
  syncExportForm();
  exportDlg.showModal();
}
function syncExportForm() {
  const png = exportForm.format.value === 'png';
  exportForm.querySelector('[data-for="vector"]').hidden = png;
  exportForm.querySelector('[data-for="png"]').hidden = !png;
}
exportForm.format.addEventListener('change', syncExportForm);
/* the backdrop and the dialog's own padding are the same element: only a click outside the box closes it */
function outsideDialog(dlg, e) {
  if (e.target !== dlg) return false;
  const r = dlg.getBoundingClientRect();
  return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
}
exportDlg.addEventListener('click', e => { if (outsideDialog(exportDlg, e) || e.target.closest('[data-close]')) exportDlg.close(); });
exportForm.addEventListener('submit', async e => {
  e.preventDefault();
  const f = exportForm, fmtSel = f.format.value;
  const opts = { face: f.face.value, ruler: f.ruler.checked, cables: f.cables.checked, labels: f.labels.checked, title: f.titled.checked };
  let N = +f.scale.value;
  exportDlg.close();
  try {
    let { prims, bb } = buildDrawing(opts, N);
    // PDF pages are limited to 200 in (5080 mm): step up the scale until the drawing fits
    while (fmtSel === 'pdf' && Math.max(bb.w, bb.h) / N > 5000 && N < 500) { N *= 2; ({ prims, bb } = buildDrawing(opts, N)); }
    const name = `rack-layout-${opts.face}`;
    if (fmtSel === 'pdf') download(primsToPDF(prims, bb, N), `${name}-1to${N}.pdf`);
    else if (fmtSel === 'svg') download(new Blob([primsToSVG(prims, bb, N, false)], { type: 'image/svg+xml' }), `${name}-1to${N}.svg`);
    else download(await svgToPng(primsToSVG(prims, bb, N, true), bb, +f.png.value), `${name}.png`);
    toast(`Exported ${fmtSel.toUpperCase()}${fmtSel === 'png' ? '' : ` at 1:${N}`}`);
  } catch (err) {
    console.error(err);
    toast('Export failed: ' + err.message);
  }
});

/* ---------- bill of materials (CSV) ---------- */
function exportCSV() {
  const lens = cableLengths(), pm = powerModel(), rows = [];
  const q = v => {
    let s = String(v ?? '');
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;   // text that a spreadsheet would run as a formula
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const m = mm => (mm / 1000).toFixed(2);
  rows.push(['Racks'], ['Rack', 'Height (U)', 'Used (U)', 'Width (mm)', 'Depth (mm)', 'Power (W)', 'Heat (BTU/h)', 'Weight (kg)', 'Max load (kg)']);
  for (const r of pm.racks) rows.push([r.rack.name, r.rack.units, usedU(r.rack), r.rack.width, r.rack.depth, Math.round(r.watts), r.btu, +r.kg.toFixed(1), r.maxKg]);
  rows.push([], ['Devices'], ['Rack', 'Position', 'Height', 'Name', 'Type', 'Mounted', 'Width', 'Depth (mm)', 'Hostname', 'IP', 'Serial', 'Power (W)', 'Weight (kg)', 'Notes']);
  for (const r of doc.racks) {
    for (const d of [...r.devices].sort((a, b) => b.u - a.u)) {
      rows.push([r.name, isZeroU(d) ? `side ${d.side}` : `U${d.u}`, devU(d), d.name, T_(d).label, d.mount, isHalf(d) ? `half ${d.half}` : 'full',
        d.depth, d.hostname || '', d.ip || '', d.serial || '', watts(d), weight(d), d.notes || '']);
    }
  }
  rows.push([], ['Cables'], ['Label', 'Type', 'From rack', 'From device', 'From port', 'To rack', 'To device', 'To port', 'Est. length (m)', 'Stock length', 'Notes']);
  const sum = {};
  for (const c of doc.cables) {
    const A = findDev(c.a), B = findDev(c.b), t = ctype(c.type), len = lens[c.id] || 0, std = stdLength(len, t.kind);
    const stock = std ? fmtStd(std) : 'custom';
    rows.push([cableLabel(c), t.name, A?.rack.name, A?.dev.name, A ? portLabel(A.dev, c.pa) : '', B?.rack.name, B?.dev.name, B ? portLabel(B.dev, c.pb) : '', m(len), stock, c.notes || '']);
    const key = t.name + '|' + stock;
    (sum[key] ||= { type: t.name, stock, n: 0, len: 0 }).n++;
    sum[key].len += len;
  }
  rows.push([], ['Cable summary'], ['Type', 'Stock length', 'Quantity', 'Total length (m)']);
  for (const s of Object.values(sum).sort((a, b) => a.type.localeCompare(b.type) || a.len / a.n - b.len / b.n)) rows.push([s.type, s.stock, s.n, m(s.len)]);
  download(new Blob(['﻿' + rows.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' }), 'rack-bill-of-materials.csv');
  toast('Exported the bill of materials');
}
