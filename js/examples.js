'use strict';
/* =====================================================================
   Rack Visualizer · example layouts
   Three starting points of growing size: a wall rack in a small office,
   an office building (server room, core and a floor closet) and a data
   centre row with a leaf-spine network. The first visit opens the
   medium one. Loaded right after model.js, which has no example of its own.
   ===================================================================== */

/* A small kit for building a layout in code. Cables take the next free port of the kind asked for:
   a device on its own means a data port, [device, 'u'] an uplink, [device, 'p7'] that exact port.
   power() joins the next free outlet of one device to the next free inlet of another. */
function exampleKit() {
  const d = blankDoc(), taken = new Map();   // device id -> the ports in use
  const take = (dev, key) => {
    const set = taken.get(dev.id) || taken.set(dev.id, new Set()).get(dev.id);
    if (key.length === 1) { let n = 1; while (set.has(key + n)) n++; key += n; }
    set.add(key);
    return key;
  };
  const cable = (type, a, ka, b, kb, o) => d.cables.push({ id: uid(), type, a: a.id, b: b.id, pa: take(a, ka), pb: take(b, kb), label: '', ...o });
  const end = e => (Array.isArray(e) ? e : [e, 'p']);
  return {
    d,
    rack: (name, o) => { const r = makeRack({ name, ...o }); d.racks.push(r); return r; },
    put: (r, type, u, o) => { const v = makeDev(type, { u, ...o }); r.devices.push(v); return v; },
    link: (type, a, b, o) => { const [x, kx] = end(a), [y, ky] = end(b); cable(type, x, kx, y, ky, o); },
    power: (src, dst) => cable(outletType(src), src, 'o', dst, 'i'),
  };
}

/* ---------- small: one wall rack in an office ---------- */
function smallExample() {
  const k = exampleKit();
  const r = k.rack('Wall rack', { code: 'WR', units: 15, depth: 600 });
  const ups = k.put(r, 'ups', 1, { name: 'UPS', mains: true, depth: 450, weight: 12, capacity: 900, hostname: 'ups-01' });
  const nas = k.put(r, 'storage', 3, { name: 'NAS', depth: 450, weight: 8, inlets: 1, uplinks: 0, ports: 2, watts: 60, hostname: 'nas-01', ip: '192.168.1.20' });
  const nvr = k.put(r, 'nvr', 5, { name: 'Camera recorder', hostname: 'nvr-01', ip: '192.168.1.30' });
  const sw = k.put(r, 'switch', 7, { name: 'Office switch', watts: 150, hostname: 'sw-01', ip: '192.168.1.2', notes: 'PoE for phones, access points and cameras' });
  k.put(r, 'manager', 8);
  const patch = k.put(r, 'patch', 9, { name: 'Patch panel' });
  k.put(r, 'manager', 10);
  const fw = k.put(r, 'firewall', 11, { name: 'Firewall', uplinkType: 'sfp+', hostname: 'fw-01', ip: '192.168.1.1' });
  const ont = k.put(r, 'ont', 12, { name: 'Internet modem' });
  const isp = k.put(r, 'fiber', 13, { name: 'ISP fiber', portType: 'sc', ports: 12 });

  k.link('fiber', [isp, 'p'], [ont, 'u']);
  k.link('utp', [ont, 'p'], [fw, 'p']);
  k.link('dac', [fw, 'u'], [sw, 'u']);
  for (let i = 1; i <= 8; i++) k.link('utp', [patch, 'p' + i], [sw, 'p' + i]);   // wall outlets in the offices
  k.link('utp', [nvr, 'u'], sw);
  k.link('utp', nas, sw);
  k.link('utp', nas, sw);
  for (const dev of [ont, fw, sw, nvr, nas]) k.power(ups, dev);
  return k.d;
}

/* ---------- medium: an office building ---------- */
function mediumExample() {
  const k = exampleKit();

  /* the core rack: internet, firewall, core switches, Wi-Fi, phones and the ground floor */
  const core = k.rack('Core rack', { code: 'CR' });
  const cUps = k.put(core, 'ups', 1, { name: 'UPS', mains: true, outletType: 'c19', hostname: 'ups-core' });
  const cPdu = k.put(core, 'vpdu', 0, { name: 'PDU', side: 'right', offset: 120, outlets: 12 });
  const access1 = k.put(core, 'switch', 28, { name: 'Access switch 1', ports: 48, watts: 150, hostname: 'sw-gf', ip: '10.0.0.10' });
  k.put(core, 'manager', 29);
  const patch1 = k.put(core, 'patch', 30, { name: 'Patch panel 1' });
  k.put(core, 'manager', 31);
  const wlc = k.put(core, 'wlc', 32, { name: 'Wi-Fi controller', hostname: 'wlc-01', ip: '10.0.0.20' });
  const riserCore = k.put(core, 'fiber', 33, { name: 'Riser fiber', ports: 12 });
  k.put(core, 'manager', 34);
  const core2 = k.put(core, 'switch', 35, { name: 'Core switch 2', uplinks: 8, hostname: 'core-02', ip: '10.0.0.3' });
  const core1 = k.put(core, 'switch', 36, { name: 'Core switch 1', uplinks: 8, hostname: 'core-01', ip: '10.0.0.2' });
  k.put(core, 'manager', 37);
  const pbx = k.put(core, 'pbx', 38, { name: 'VoIP gateway', hostname: 'pbx-01', ip: '10.0.0.30' });
  const fw = k.put(core, 'firewall', 39, { name: 'Firewall', uplinks: 2, uplinkType: 'sfp+', hostname: 'fw-01', ip: '10.0.0.1' });
  k.put(core, 'manager', 40);
  const ont = k.put(core, 'ont', 41, { name: 'Internet modem' });
  const isp = k.put(core, 'fiber', 42, { name: 'ISP fiber', portType: 'sc', ports: 12 });

  /* the server rack: two switches, hosts and storage on two power feeds */
  const srv = k.rack('Server rack', { code: 'SR' });
  const upsB = k.put(srv, 'ups', 1, { name: 'UPS B', mains: true, outletType: 'c19', feed: 'B', capacity: 3000, hostname: 'ups-b' });
  const upsA = k.put(srv, 'ups', 3, { name: 'UPS A', mains: true, outletType: 'c19', feed: 'A', capacity: 3000, hostname: 'ups-a' });
  const pduA = k.put(srv, 'vpdu', 0, { name: 'PDU A', side: 'left', offset: 120, feed: 'A', outlets: 12 });
  const pduB = k.put(srv, 'vpdu', 0, { name: 'PDU B', side: 'right', offset: 120, feed: 'B', outlets: 12 });
  const nvr = k.put(srv, 'nvr', 24, { name: 'Camera recorder', hostname: 'nvr-01', ip: '10.0.40.5' });
  const san2 = k.put(srv, 'storage', 27, { name: 'SAN 2', watts: 400, hostname: 'san-02', ip: '10.0.30.12' });
  const san1 = k.put(srv, 'storage', 29, { name: 'SAN 1', watts: 400, hostname: 'san-01', ip: '10.0.30.11' });
  k.put(srv, 'manager', 31);
  const hosts = [['Host 1', 38], ['Host 2', 36], ['Host 3', 34], ['Backup server', 32]].map(([name, u], i) =>
    k.put(srv, 'server', u, { name, uplinks: 0, watts: i === 3 ? 250 : 300, hostname: i === 3 ? 'bak-01' : `host-0${i + 1}`, ip: `10.0.30.${21 + i}` }));
  k.put(srv, 'manager', 40);
  const swB = k.put(srv, 'switch', 41, { name: 'Server switch B', hostname: 'sw-srv-b', ip: '10.0.30.3' });
  const swA = k.put(srv, 'switch', 42, { name: 'Server switch A', hostname: 'sw-srv-a', ip: '10.0.30.2' });

  /* the closet on the second floor */
  const f2 = k.rack('Floor 2 closet', { code: 'F2', units: 12, depth: 600 });
  const f2Pdu = k.put(f2, 'pdu', 1, { name: 'PDU', mount: 'rear', mains: true });
  const access2 = k.put(f2, 'switch', 8, { name: 'Access switch 2', watts: 150, hostname: 'sw-f2', ip: '10.0.0.11' });
  k.put(f2, 'manager', 9);
  const patch2 = k.put(f2, 'patch', 10, { name: 'Patch panel 2' });
  k.put(f2, 'manager', 11);
  const riserF2 = k.put(f2, 'fiber', 12, { name: 'Riser fiber', ports: 12 });

  /* data: internet, firewall and the two core switches */
  k.link('fiber', [isp, 'p'], [ont, 'u']);
  k.link('utp', [ont, 'p'], [fw, 'p']);
  k.link('dac', [fw, 'u'], [core1, 'u']);
  k.link('dac', [fw, 'u'], [core2, 'u']);
  k.link('fiber', [core1, 'u'], [swA, 'u']);
  k.link('fiber', [core2, 'u'], [swB, 'u']);
  k.link('fiber', [core1, 'u'], [riserCore, 'p']);
  k.link('fiber', [core2, 'u'], [riserCore, 'p']);
  k.link('dac', [core1, 'u'], [core2, 'u'], { label: 'Core link' });
  k.link('dac', [core1, 'u'], [access1, 'u']);
  k.link('dac', [core2, 'u'], [access1, 'u']);
  k.link('dac', [core1, 'u'], [wlc, 'u']);
  k.link('utp', [pbx, 'u'], [core1, 'p']);
  for (let i = 1; i <= 8; i++) k.link('utp', [patch1, 'p' + i], [access1, 'p' + i]);   // ground floor outlets
  /* the riser to the second floor: two fibers in the wall, then patch cords to the closet switch */
  k.link('fiber', [riserCore, 'p7'], [riserF2, 'p7'], { label: 'Riser A' });
  k.link('fiber', [riserCore, 'p8'], [riserF2, 'p8'], { label: 'Riser B' });
  k.link('fiber', [riserF2, 'p'], [access2, 'u']);
  k.link('fiber', [riserF2, 'p'], [access2, 'u']);
  for (let i = 1; i <= 8; i++) k.link('utp', [patch2, 'p' + i], [access2, 'p' + i]);   // second floor outlets
  /* data: servers and storage, each with a cable to both switches */
  for (const h of hosts) { k.link('utp', [h, 'p'], swA); k.link('utp', [h, 'p'], swB); }
  for (const s of [san1, san2]) { k.link('dac', [s, 'u'], [swA, 'u']); k.link('dac', [s, 'u'], [swB, 'u']); }
  k.link('utp', [nvr, 'u'], swA);

  /* power: the core rack runs from one UPS, the server rack from an A and a B feed */
  k.power(cUps, cPdu);
  for (const dev of [ont, fw, pbx, core1, core2, wlc, access1]) k.power(cPdu, dev);
  k.power(upsA, pduA); k.power(upsB, pduB);
  for (const dev of [...hosts, san1, san2]) { k.power(pduA, dev); k.power(pduB, dev); }
  k.power(pduA, swA); k.power(pduB, swB); k.power(pduA, nvr);
  k.power(f2Pdu, access2);
  return k.d;
}

/* ---------- large: a data centre row, leaf-spine ---------- */
function largeExample() {
  const k = exampleKit();
  const SERVERS = 10, COMPUTE = 4;
  /* every rack has an A and a B vertical PDU on the building feeds */
  const feeds = (r, n) => ['A', 'B'].map(f => k.put(r, 'vpdu', 0, { name: 'PDU ' + f, side: f === 'A' ? 'left' : 'right', offset: 120, feed: f, mains: true, outlets: n, capacity: 7360 }));
  const wide = { width: 800, depth: 1200 };

  /* edge: two internet lines, two border routers, a pair of firewalls */
  const edge = k.rack('Edge', { code: 'ED', ...wide });
  const [edgeA, edgeB] = feeds(edge, 12);
  const ispA = k.put(edge, 'fiber', 42, { name: 'ISP A fiber', ports: 12 });
  const ispB = k.put(edge, 'fiber', 41, { name: 'ISP B fiber', ports: 12 });
  k.put(edge, 'manager', 40);
  const brA = k.put(edge, 'router', 39, { name: 'Border router A', uplinks: 4, hostname: 'br-a', ip: '10.255.0.1' });
  const brB = k.put(edge, 'router', 38, { name: 'Border router B', uplinks: 4, hostname: 'br-b', ip: '10.255.0.2' });
  k.put(edge, 'manager', 37);
  const fwA = k.put(edge, 'firewall', 36, { name: 'Firewall A', uplinks: 4, uplinkType: 'sfp+', hostname: 'fw-a', ip: '10.255.1.1' });
  const fwB = k.put(edge, 'firewall', 35, { name: 'Firewall B', uplinks: 4, uplinkType: 'sfp+', hostname: 'fw-b', ip: '10.255.1.2' });
  k.put(edge, 'manager', 34);

  /* core: the spines */
  const coreRack = k.rack('Core', { code: 'CO', ...wide });
  const [coreA, coreB] = feeds(coreRack, 12);
  const spine1 = k.put(coreRack, 'switch', 41, { name: 'Spine 1', ports: 0, uplinks: 16, uplinkType: 'sfp+', hostname: 'spine-1', ip: '10.255.2.1' });
  const spine2 = k.put(coreRack, 'switch', 40, { name: 'Spine 2', ports: 0, uplinks: 16, uplinkType: 'sfp+', hostname: 'spine-2', ip: '10.255.2.2' });
  k.put(coreRack, 'manager', 39);

  /* a rack of servers or storage under two leaf switches; `make` fills the middle */
  const leafRack = (name, code, n, kind, count, spec) => {
    const r = k.rack(name, { code });
    const [pa, pb] = feeds(r, 24);
    const leaf = (l, u) => k.put(r, 'switch', u, kind === 'storage'
      ? { name: `Leaf ${n}${l}`, ports: 0, uplinks: 8, hostname: `leaf-${n}${l.toLowerCase()}`, ip: `10.${n}.0.${l === 'A' ? 2 : 3}` }
      : { name: `Leaf ${n}${l}`, uplinks: 4, hostname: `leaf-${n}${l.toLowerCase()}`, ip: `10.${n}.0.${l === 'A' ? 2 : 3}` });
    const la = leaf('A', 42), lb = leaf('B', 41);
    k.put(r, 'manager', 40);
    const devs = [];
    for (let i = 0; i < count; i++) {   // 2U each, with a cable manager between the two halves and one below
      const u = 38 - i * 2 - (i >= count / 2 ? 1 : 0), nr = String(i + 1).padStart(2, '0');
      devs.push(k.put(r, kind, u, { name: `${spec.name} ${n}-${i + 1}`, watts: spec.watts, uplinks: spec.uplinks, hostname: `${spec.host}${n}-${nr}`, ip: `10.${n}.1.${10 + i}` }));
    }
    k.put(r, 'manager', 39 - count);
    k.put(r, 'manager', 38 - 2 * count);
    for (const [l, p] of [[la, pa], [lb, pb]]) { k.link('fiber', [l, 'u'], [spine1, 'u']); k.link('fiber', [l, 'u'], [spine2, 'u']); k.power(p, l); }
    for (const dev of devs) {
      if (kind === 'storage') { k.link('dac', [dev, 'u'], [la, 'u']); k.link('dac', [dev, 'u'], [lb, 'u']); }
      else { k.link('utp', [dev, 'p'], la); k.link('utp', [dev, 'p'], lb); }
      k.power(pa, dev); k.power(pb, dev);
    }
    return r;
  };
  for (let n = 1; n <= COMPUTE; n++) leafRack(`Compute ${n}`, 'C' + n, n, 'server', SERVERS, { name: 'Server', watts: 350, uplinks: 0, host: 'srv' });
  leafRack('Storage', 'ST', COMPUTE + 1, 'storage', 6, { name: 'Array', watts: 500, host: 'array' });

  /* internet in, firewalls to both spines */
  k.link('fiber', [ispA, 'p'], [brA, 'u']);
  k.link('fiber', [ispB, 'p'], [brB, 'u']);
  for (const br of [brA, brB]) for (const fw of [fwA, fwB]) k.link('dac', [br, 'u'], [fw, 'u']);
  k.link('utp', [fwA, 'p'], [fwB, 'p'], { label: 'HA link' });
  for (const fw of [fwA, fwB]) { k.link('fiber', [fw, 'u'], [spine1, 'u']); k.link('fiber', [fw, 'u'], [spine2, 'u']); }
  for (const [dev, p] of [[brA, edgeA], [brB, edgeB], [fwA, edgeA], [fwB, edgeB], [spine1, coreA], [spine2, coreB]]) k.power(p, dev);
  return k.d;
}

/* ---------- the list ---------- */
const EXAMPLES = {
  small: { label: 'Small office', hint: 'One wall rack: internet, firewall, switch, NAS', build: smallExample },
  medium: { label: 'Medium office building', hint: 'Three racks: core, servers and a floor closet', build: mediumExample },
  large: { label: 'Large data centre', hint: 'Seven racks: leaf-spine network, A/B power', build: largeExample },
};
const FIRST_EXAMPLE = 'medium';

/* a fresh, checked copy of an example; `settings` carries over someone's units, colours and cable types */
function buildExample(id, settings) {
  const d = EXAMPLES[id].build();
  if (settings) d.settings = settings;
  return normalize(d);
}

/* nothing saved in this browser yet: start with an example (model.js starts with an empty layout) */
if (firstVisit) doc = buildExample(FIRST_EXAMPLE);
