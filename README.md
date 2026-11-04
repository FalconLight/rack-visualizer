# Rack Visualizer

A minimal tool to plan the space networking equipment takes up in racks.

- **Racks** with custom height (U), width, depth, weight limit and cable channel side
- **Equipment** measured in rack units: switches, routers, firewalls, patch panels, fiber enclosures, ODFs, servers, storage, NVRs, KVMs, UPS, PDUs, vertical 0U PDUs, transfer switches and more; half-width devices; your own templates
- **Ports** with connector types (RJ45, LC, SC, MPO, F, SFP…), uplinks, power inlets and outlets
- **Cables** port to port, data and power (C13–C14, C19–C20, Schuko, NEMA), custom types and colors, compatibility warnings, auto labels (shown when you point at a cable) and stock cord lengths; repeat a cable over the next ports for patch runs. Clicking a device instead of a port uses its first free port that fits, so cables can be drawn without zooming in
- **Arranged cables** (or curved ones) through cable managers, side channels and overhead or underfloor trays, with a one-click “Tidy” that removes crossings; front / rear and the cable style are in a bar over the racks
- **Power budget**: load per PDU / UPS (normal and if a feed fails), A/B feed check, watts and BTU/h per rack, weight per rack
- **Connection check**: small power and data lights on every device, and a check mode (<kbd>K</kbd>) that outlines what isn't connected and lists it. Power is followed along the chain from the PDUs / UPSs marked “Has building power”; devices can be marked as spare
- **Views**: front and rear elevation, and 3D
- **Diagram** of the connections, laid out top-down (incoming lines, firewall, switches, endpoints), with a Data and a Power layer (the power chain from the building feed down). Show it next to the racks (<kbd>N</kbd>) with a draggable divider; selecting in one view selects and shows it in the other. Drag boxes to arrange it yourself (with an optional grid and snapping), or pick a standard layout: top-down tree, left to right, star or by rack; round or angled links. Angled links cascade into their own lanes, ordered to cross as little as possible, and the arranged layouts leave room for them. <kbd>F</kbd> or the fit button shows the whole diagram (both views when side by side)
- **Exports**: PDF and SVG with layers (to scale, for CAD), PNG, and a CSV bill of materials; the data and power diagrams can be added below the racks, each on its own layer
- Search, port map, port numbers when zoomed in, multi-select, copy / paste, undo / redo, unit converter and measure tool
- Reorder racks by dragging them in the rack list; duplicating a rack copies the cables inside it
- Side panels that fold away for more room (the tabs on the drawing's edges, or <kbd>[</kbd> and <kbd>]</kbd>); double-click any device, rack or cable (in 2D, 3D or the diagram) to open its properties
- A guided tour of the main functions on the first visit; skip it any time, and take it again from Help (?). The first visit opens an example layout, with a note to start an empty one
- **Examples** to start from, in the File menu (and on the empty screen): a small office (one wall rack), a medium office building (core and server racks plus a floor closet, with A/B power) and a large data centre row (leaf-spine network, redundant internet, 231 cables). Each is fully cabled and passes the connection check; loading one keeps your units, colors and cable types, and Undo brings your layout back
- Either side panel, the rack drawing and the diagram can each pop out into its own window for a second screen (the small arrow button on it); they stay live, and closing that window puts it back
- Works from the keyboard: the rack and cable lists take the arrow keys (<kbd>Alt</kbd> + arrows reorder racks), menus open on the first item, and the panels keep your place while you edit; toggles and lists are announced to screen readers
- Autosaves in the browser (and follows changes made in another tab); save / open layouts as JSON. Opened files are checked, so a layout from someone else can't inject anything into the page

## Run locally

It's a static site, so just open `index.html`. Or serve the folder:

```bash
python -m http.server 5178
```

The 3D view loads three.js from a CDN, so it needs an internet connection.

## Code

| File | What it does |
|---|---|
| `js/model.js` | Device catalogue, document, rack geometry, ports, power analysis, labels |
| `js/examples.js` | The small, medium and large example layouts, built with a tiny cabling kit |
| `js/routing.js` | Cable positions, curves, diagram routing, lengths, the Tidy optimiser |
| `js/draw2d.js` | 2D elevation (front / rear) used by the live view and the exports |
| `js/view3d.js` | 3D view |
| `js/netdiagram.js` | The network diagram: graph, layered layout, drawing, pan / zoom / select |
| `js/export.js` | PDF / SVG / PNG drawings and the CSV bill of materials |
| `js/ui.js` | Panels, interaction, search, toolbar and keyboard shortcuts |
| `js/tour.js` | The guided tour: its steps, highlight and cards |
| `index.html` | The page: toolbar, panels, dialogs, icons, and the order the scripts load in |
| `style.css` | All the styles: light and dark tokens, then one section per part of the page |

## How it works

There is no build step and no modules: the scripts are plain files that share globals, loaded in the order of the `<script>` tags in `index.html` (that order matters: `examples.js` right after `model.js`, `netdiagram.js` before `ui.js`, `tour.js` last). Every file starts with a comment saying what it is for, and the functions have a one-line comment each.

**State.** Two globals hold everything. `doc` is the saved layout (racks, devices, cables, settings); `ui` is what is going on right now (selection, view, camera, gestures in progress) and is never saved. Every edit goes through `mutate(fn)` in `model.js`, which remembers the layout for undo, runs the change, saves it and calls `renderAll()`. `renderAll()` recomputes the power analysis and the connection check, then redraws every panel and the drawing from `doc`, so there is no other copy of the data to keep in step.

**Drawing.** All geometry is in millimetres, in front-view coordinates (the rear view mirrors x). `sceneSVG()` in `draw2d.js` builds the 2D drawing as SVG text and feeds both the live view and the exports (`export.js` reads the rendered scene back as lines, paths and text, sorts them into layers and writes SVG, PDF or PNG). The live view has two layers: the scene (rebuilt when something in it changes or the zoom changes) and the overlays (hover line, labels of the cable under the pointer, drag ghosts, measure, selection box), which are cheap enough to redraw on every pointer move. Port numbers are drawn after the cables so they stay on top. Cable positions, the arranged routing between cable managers, channels and trays, and the Tidy optimiser are in `routing.js`; the 3D view in `view3d.js`; the connection diagram in `netdiagram.js`.

**Panels.** The side panels are rebuilt as HTML after every change. They go through `patchHTML()` (in `ui.js`), never `innerHTML`, so the field you are typing in keeps the focus. Toggle buttons use `setOn` / `markOn` so the look and `aria-pressed` stay together.

### The saved layout (JSON)

File → Save layout writes `doc` as it is; File → Open layout and the browser's own copy go through `normalize()` and `sanitize()` in `model.js`, so every id, colour and choice is a plain, known value and a layout from someone else cannot inject anything into the page.

```text
{
  racks:    [{ id, name, code, units, width, depth, channel, maxLoad?,
               devices: [{ id, type, name, u, h, depth, mount, half?, ports?, portType?, uplinks?, uplinkType?,
                           inlets?, inletType?, outlets?, outletType?, watts?, capacity?, weight?, color?, feed?,
                           mains?, spare?, hostname?, ip?, serial?, notes?,
                           side, offset, length  /* vertical (0U) PDUs only */ }] }],
  cables:   [{ id, type, a, b, pa, pb, label, notes?, color?, via? }],   // a / b: device ids, pa / pb: port keys
  settings: { unit, gap, route, via, labelPattern, showLabels, catColors, cableTypes, templates, net },
  routeOrder?, netPos?                                                   // the Tidy result, moved diagram boxes
}
```

Lengths are millimetres. A port key is a class and a number: `p3` data port, `u2` uplink, `i1` power inlet, `o4` power outlet. A device field that is left out comes from the catalogue (`TYPES` in `model.js`).

### What is kept in the browser

Everything is in `localStorage`, nothing is sent anywhere. `rackviz.v1` is the layout; the others are preferences: `rackviz.theme`, `rackviz.panels`, `rackviz.pane`, `rackviz.splitAt`, `rackviz.netLayer`, `rackviz.check`, `rackviz.open.<section>` (folded sections), `rackviz.tour` and `rackviz.example` (first-visit state).

## Changing the code

- When you change the CSS or JS, raise the `?v=` number in `index.html` so browsers fetch the new files.
- Escape every user-supplied string with `esc()` before it goes into HTML, and let imported layouts pass through `sanitize()`.
- Display preferences that must survive undo (units, cable style, diagram look) are listed in `VIEW_PREFS`.
- Light and dark colours are tokens on `:root` in `style.css` (the dark set is written twice, for the system setting and for the manual switch: keep them equal). Small status text uses `--bad-text`, `--warn-text` and `--ok-text`.
- There are no automated tests. After a change, load the three examples (File → Start from an example) and check that the connection check, the power panel and the cable list show no problems, then try the export.
