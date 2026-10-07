# Rack Visualizer

A minimal tool to plan the space networking equipment takes up in racks.

- **Racks** with custom height (U), width, depth, weight limit and cable channel side
- **Equipment** measured in rack units: switches, routers, firewalls, patch panels, fiber enclosures, ODFs, servers, storage, NVRs, KVMs, UPS, PDUs, vertical 0U PDUs, transfer switches and more; half-width devices; your own templates
- **Ports** with connector types (RJ45, LC, SC, MPO, F, SFP…), uplinks, power inlets and outlets
- **Cables** port to port, data and power (C13–C14, C19–C20, Schuko, NEMA), custom types and colors, compatibility warnings, auto labels and stock cord lengths; repeat a cable over the next ports for patch runs
- **Diagram routing** through cable managers, side channels and overhead or underfloor trays, with a one-click “Tidy” that removes crossings
- **Power budget**: load per PDU / UPS (normal and if a feed fails), A/B feed check, watts and BTU/h per rack, weight per rack
- **Connection check**: small power and data lights on every device, and a check mode (<kbd>K</kbd>) that outlines what isn't connected and lists it. Power is followed along the chain from the PDUs / UPSs marked “Has building power”; devices can be marked as spare
- **Views**: front and rear elevation, and 3D
- **Network diagram** of the connections, laid out top-down (incoming lines, firewall, switches, endpoints), with a Data and a Power layer (the power chain from the building feed down). Show it next to the racks (<kbd>N</kbd>) with a draggable divider; selecting in one view selects and shows it in the other
- **Exports**: PDF and SVG with layers (to scale, for CAD), PNG, and a CSV bill of materials
- Search, port map, port numbers when zoomed in, multi-select, copy / paste, undo / redo, unit converter and measure tool
- Reorder racks by dragging them in the rack list; duplicating a rack copies the cables inside it
- Side panels that fold away for more room (the tabs on the drawing's edges, or <kbd>[</kbd> and <kbd>]</kbd>); double-click any device, rack or cable (in 2D, 3D or the network diagram) to open its properties
- A guided tour of the main functions on the first visit; skip it any time, and take it again from Help (?)
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
| `js/routing.js` | Cable positions, curves, diagram routing, lengths, the Tidy optimiser |
| `js/draw2d.js` | 2D elevation (front / rear) used by the live view and the exports |
| `js/view3d.js` | 3D view |
| `js/netdiagram.js` | The network diagram: graph, layered layout, drawing, pan / zoom / select |
| `js/export.js` | PDF / SVG / PNG drawings and the CSV bill of materials |
| `js/ui.js` | Panels, interaction, search, toolbar and keyboard shortcuts |
| `js/tour.js` | The guided tour: its steps, highlight and cards |

When you change the CSS or JS, raise the `?v=` number in `index.html` so browsers fetch the new files.
