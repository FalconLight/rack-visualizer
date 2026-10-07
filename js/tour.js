'use strict';
/* =====================================================================
   Rack Visualizer · guided tour
   A short walk through the main functions: each step highlights a part
   of the screen and explains it in a card next to it. It starts once on
   the first visit; Help (?) and the empty Properties panel start it again.
   ===================================================================== */

const TOUR_KEY = 'rackviz.tour';
const show2D = () => { if (ui.pane === 'net') setPane('racks'); if (ui.view !== '2d') setView('2d'); };
/* at: the element(s) to highlight (none = a centred card) · side: where the card goes first
   enter / leave: put the screen in the state the step talks about, and back */
const TOUR = [
  { title: 'Welcome to Rack Visualizer',
    text: () => 'Plan how your networking equipment fits in racks: rack units, ports, cables and power, in 2D and 3D. This quick tour points out the main functions. It takes about a minute.'
      + ($('#exampleNote').hidden ? '' : ' The racks behind this card are an example to explore. Start your own whenever you like, with the note above the list of racks.'),
    next: 'Start the tour' },
  { at: () => $('#rackList').closest('section'), side: 'right', enter: () => setPanel('left', true), title: 'Racks',
    text: 'Your racks, and how many units each one uses. Click one to edit its name, size and weight limit. Drag them to change their order, or add one with <b>+ New rack</b>. The tab on the edge of the drawing (<kbd>[</kbd>) hides this panel when you want more room.' },
  { at: () => $('#palette').closest('section'), side: 'right', enter: () => setPanel('left', true), title: 'Equipment',
    text: 'Switches, patch panels, servers, PDUs, UPSs and more. Click an item to add it to the selected rack, or drag it onto a rack. A device you have set up can be saved as a template and appears here too.' },
  { at: () => $('#stage'), side: 'inside', enter: show2D, title: 'The rack elevation',
    text: 'Drag a device to move it, drag empty space to pan, and scroll or pinch to zoom. <kbd>Shift</kbd>-drag selects several devices, and <kbd>F</kbd> fits everything in view. Drag the end of a cable onto another port to move it.' },
  { at: () => $('#viewBar'), side: 'bottom', enter: show2D, title: 'Over the racks',
    text: 'The <b>Front</b> or the <b>Rear</b> of the racks (<kbd>R</kbd>); power inlets are usually at the rear. And how cables are drawn: <b>Curved</b>, or <b>Arranged</b> through the cable managers, the side channels and the trays between racks, where the wand reorders the lanes to remove crossings. With the Cable tool, the type of the next cable is picked here too.' },
  { at: () => $('#viewSeg'), side: 'bottom', enter: show2D, title: 'Views',
    text: 'Switch between the 2D elevation, the 3D view and the <b>Diagram</b> of the connections.' },
  { at: () => [$('#splitBtn'), $('#netPane')], side: 'bottom', title: 'The diagram, side by side',
    enter: () => { tour.pane = ui.pane; if (ui.pane !== 'split') setPane('split'); },
    leave: () => { if (tour?.pane && tour.pane !== ui.pane) setPane(tour.pane); },
    text: 'Every connection as a diagram, with <b>Data</b> for the network and <b>Power</b> for the chain from the building feed down. This button (<kbd>N</kbd>) shows it next to the racks: select a device in one and it is selected and shown in the other. Drag boxes to move them, or use <b>Arrange</b> for a standard layout; the grid, snapping and round or angled links are in its bar, and the fit button (<kbd>F</kbd>) shows the whole diagram.' },
  { at: () => $('#modeSeg'), side: 'bottom', title: 'Tools',
    text: '<b>Select</b> (<kbd>V</kbd>) moves and edits. <b>Cable</b> (<kbd>C</kbd>): click a device or one of its ports, then another device. The first free port that fits and the right cable type are picked for you; zoom in to choose a port yourself. <b>Measure</b> (<kbd>M</kbd>): drag to measure in centimetres, inches and rack units.' },
  { at: () => $('#checkBtn'), side: 'bottom', title: 'Connection check',
    text: 'Small lights on each device show power (top) and data (bottom): green connected, amber partly, red not connected. Check mode (<kbd>K</kbd>) outlines every problem and lists them. Power starts at a PDU or UPS marked <b>Has building power</b>.' },
  { at: () => $('.props-sec'), side: 'left', enter: () => setPanel('right', true), title: 'Properties',
    text: 'Everything about the selected rack, device or cable: size and position, ports, power, hostname, IP address and notes. With nothing selected, the units, the layout settings and the cable label pattern are here. <kbd>]</kbd> hides this panel; double-click anything to open it again.' },
  { at: () => [...document.querySelectorAll('aside.right details.sec')], side: 'left', enter: () => setPanel('right', true), title: 'Cables, power and more',
    text: 'Cables with estimated lengths and the stock cords to buy, the load on each PDU and UPS, connection problems, colours and cable types, and a unit converter. Click a heading to open it.' },
  { at: () => $('.search'), side: 'bottom', title: 'Search',
    text: 'Find devices, hostnames, IP addresses and cable labels, and jump straight to them. Press <kbd>/</kbd> or <kbd>Ctrl</kbd> <kbd>K</kbd>.' },
  { at: () => [$('#fileBtn'), $('#fileMenu')], side: 'left', enter: () => showMenu(true), leave: () => showMenu(false), title: 'Export, save and open',
    text: 'Export drawings to scale as PDF or SVG with layers for CAD, or as PNG. Export the bill of materials as CSV, and save or open layouts as files. The same menu has a small, a medium and a large example to start from. Your work also saves automatically in this browser.' },
  { at: () => $('#helpBtn'), side: 'bottom', title: 'Help and this tour',
    text: 'Shortcuts and tips are here, with a button to take this tour again whenever you like. Happy planning!', next: 'Done' },
];

const tourEl = document.createElement('div');
tourEl.id = 'tour';
tourEl.hidden = true;
tourEl.innerHTML = `<div class="tour-spot"></div>
  <div class="tour-card" role="dialog" aria-modal="true" aria-labelledby="tourTitle" aria-describedby="tourText">
    <div class="tour-head"><span class="tour-step" id="tourStep"></span>
      <button class="ib" data-tour="skip" aria-label="Close the tour" title="Close the tour (Esc)"><svg class="ic"><use href="#i-close"/></svg></button></div>
    <h2 id="tourTitle"></h2>
    <div class="tour-text" id="tourText"></div>
    <div class="tour-dots" aria-hidden="true"></div>
    <div class="tour-foot"><button class="link" data-tour="skip">Skip tour</button><span class="grow"></span>
      <button data-tour="back">Back</button><button class="primary" data-tour="next"></button></div>
  </div>`;
document.body.appendChild(tourEl);
const tourCard = $('.tour-card', tourEl), tourSpot = $('.tour-spot', tourEl);
let tour = null;   // { i: step, focus: what had focus before }

function startTour() {
  if (helpDlg.open) helpDlg.close();
  showMenu(false);
  tour = { i: -1, focus: document.activeElement };
  tourEl.hidden = false;
  showStep(0);
}
function endTour(skipped) {
  if (!tour) return;
  TOUR[tour.i]?.leave?.();
  const focus = tour.focus;
  tour = null;
  tourEl.hidden = true;
  try { localStorage.setItem(TOUR_KEY, 'done'); } catch (e) { /* ignore */ }
  focus?.focus?.();
  if (skipped) toast('Tour closed. Take it again any time from Help (?)');
}
const tourTargets = s => (s.at ? [].concat(s.at()) : []).filter(el => el && el.getClientRects().length && el.offsetWidth + el.offsetHeight > 0);
function showStep(i) {
  if (i < 0 || i >= TOUR.length) return;
  TOUR[tour.i]?.leave?.();
  tour.i = i;
  const s = TOUR[i], last = i === TOUR.length - 1;
  s.enter?.();
  $('#tourStep').textContent = i ? `${i} of ${TOUR.length - 1}` : 'Tour';
  $('#tourTitle').textContent = s.title;
  $('#tourText').innerHTML = typeof s.text === 'function' ? s.text() : s.text;
  $('.tour-dots', tourEl).innerHTML = TOUR.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
  $('[data-tour="back"]', tourEl).hidden = !i;
  $('.tour-foot [data-tour="skip"]', tourEl).hidden = last;
  $('[data-tour="next"]', tourEl).textContent = s.next || 'Next';
  tourTargets(s)[0]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  placeTour();
  $('[data-tour="next"]', tourEl).focus();
}
/* highlight the step's elements and put the card beside them, inside the window */
function placeTour() {
  if (!tour) return;
  const s = TOUR[tour.i], els = tourTargets(s), vw = innerWidth, vh = innerHeight, m = 12, pad = 6, gap = 12;
  const cw = tourCard.offsetWidth, ch = tourCard.offsetHeight;
  const put = (x, y) => { tourCard.style.left = clamp(x, m, vw - cw - m) + 'px'; tourCard.style.top = clamp(y, m, vh - ch - m) + 'px'; };
  tourEl.classList.toggle('center', !els.length);
  if (!els.length) {
    Object.assign(tourSpot.style, { left: vw / 2 + 'px', top: vh / 2 + 'px', width: '0px', height: '0px' });
    return put((vw - cw) / 2, (vh - ch) / 2);
  }
  const rs = els.map(el => el.getBoundingClientRect());
  const r = { left: Math.max(0, Math.min(...rs.map(q => q.left)) - pad), top: Math.max(0, Math.min(...rs.map(q => q.top)) - pad),
    right: Math.min(vw, Math.max(...rs.map(q => q.right)) + pad), bottom: Math.min(vh, Math.max(...rs.map(q => q.bottom)) + pad) };
  Object.assign(tourSpot.style, { left: r.left + 'px', top: r.top + 'px', width: r.right - r.left + 'px', height: r.bottom - r.top + 'px' });
  const midX = (r.left + r.right) / 2 - cw / 2, midY = (r.top + r.bottom) / 2 - ch / 2;
  const sides = {
    bottom: () => r.bottom + gap + ch <= vh - m && [midX, r.bottom + gap],
    top: () => r.top - gap - ch >= m && [midX, r.top - gap - ch],
    right: () => r.right + gap + cw <= vw - m && [r.right + gap, midY],
    left: () => r.left - gap - cw >= m && [r.left - gap - cw, midY],
    inside: () => r.right - r.left > cw + 2 * m && r.bottom - r.top > ch + 2 * m && [r.left + m + 8, r.bottom - ch - m - 8],
  };
  for (const k of [s.side, 'bottom', 'top', 'right', 'left', 'inside']) {
    const at = k && sides[k]();
    if (at) return put(...at);
  }
  put((vw - cw) / 2, vh - ch - m);   // no room anywhere: along the bottom of the window
}

tourEl.addEventListener('click', e => {
  const act = e.target.closest('[data-tour]')?.dataset.tour;
  if (act === 'skip') endTour(true);
  else if (act === 'back') showStep(tour.i - 1);
  else if (act === 'next') tour.i === TOUR.length - 1 ? endTour(false) : showStep(tour.i + 1);
});
/* keys while the tour is open: arrows step, Esc closes, Tab stays in the card; nothing reaches the app */
document.addEventListener('keydown', e => {
  if (!tour) return;
  e.stopPropagation();   // no shortcuts behind the tour
  if (e.key === 'Escape') endTour(true);
  else if (e.key === 'ArrowRight') $('[data-tour="next"]', tourEl).click();
  else if (e.key === 'ArrowLeft') { if (tour.i > 0) showStep(tour.i - 1); }
  else if (e.key === 'Tab') {
    const f = [...tourCard.querySelectorAll('button')].filter(b => !b.hidden);
    const at = f.indexOf(document.activeElement);
    f[(at + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
  } else return;   // Enter / Space press the focused button as usual
  e.preventDefault();
}, true);
let tourRaf = 0;
const replaceTour = () => { if (tour && !tourRaf) tourRaf = requestAnimationFrame(() => { tourRaf = 0; placeTour(); }); };
addEventListener('resize', replaceTour);
addEventListener('scroll', replaceTour, true);
/* "Take the tour" buttons anywhere on the page */
document.addEventListener('click', e => { if (e.target.closest('[data-tour-start]')) startTour(); });

/* first visit */
let tourSeen = false;
try { tourSeen = !!localStorage.getItem(TOUR_KEY); } catch (e) { tourSeen = true; }
if (!tourSeen) setTimeout(startTour, 400);
