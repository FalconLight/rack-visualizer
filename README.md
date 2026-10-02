# Rack Visualizer

A minimal tool to plan the space networking equipment takes up in racks.

- Multiple racks with custom height (U), width and depth
- Equipment measured in rack units: switches, patch panels, fiber enclosures, servers, UPS, PDUs…
- Switch ports and uplinks (RJ45, SFP, SFP+, SFP28, QSFP+, QSFP28)
- Port-to-port cables with custom cable types and colors
- Curved or diagram (right-angle) cable routing
- 2D elevation and 3D view
- U / cm / in / mm converter with ruler, and a measure tool
- Autosaves in the browser; export / import as JSON

## Run locally

It's a static site, so just open `index.html`. Or serve the folder:

```bash
python -m http.server 5178
```

The 3D view loads three.js from a CDN, so it needs an internet connection.
