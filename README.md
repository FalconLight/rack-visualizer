# Rack Visualizer

A minimal tool to plan the space networking equipment takes up in racks.

- **Racks** with custom height (U), width, depth, weight limit and cable channel side
- **Equipment** measured in rack units: switches, routers, firewalls, patch panels, fiber enclosures, ODFs, servers, storage, NVRs, KVMs, UPS, PDUs, vertical 0U PDUs, transfer switches and more; half-width devices; your own templates
- **Ports** with connector types (RJ45, LC, SC, MPO, F, SFP…), uplinks, power inlets and outlets
- **Cables** port to port, data and power (C13–C14, C19–C20, Schuko, NEMA), custom types and colors, compatibility warnings, auto labels and stock cord lengths
- **Diagram routing** through cable managers, side channels and overhead or underfloor trays, with a one-click “Tidy” that removes crossings
- **Power budget**: load per PDU / UPS (normal and if a feed fails), A/B feed check, watts and BTU/h per rack, weight per rack
- **Views**: front and rear elevation, and 3D
- **Exports**: PDF and SVG with layers (to scale, for CAD), PNG, and a CSV bill of materials
- Search, port map, multi-select, copy / paste, undo / redo, unit converter and measure tool
- Autosaves in the browser; save / open layouts as JSON

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
| `js/export.js` | PDF / SVG / PNG drawings and the CSV bill of materials |
| `js/ui.js` | Panels, interaction, search, toolbar and keyboard shortcuts |

When you change the CSS or JS, raise the `?v=` number in `index.html` so browsers fetch the new files.
