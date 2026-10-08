# Constellation Trainer

Interactive star chart and constellation quiz (Explore / Name it / Find it), styled after the
Open University sky charts. Drag to rotate, scroll or pinch to zoom; RA 0h and Dec 0° are marked.

- `dist/index.html` — standalone page, no dependencies (open it or host it anywhere)
- `dist/plugin.html` — Eduskript plugin, data inlined
- `dist/plugin-cdn.html` — Eduskript plugin, data loaded from jsDelivr (`dist/sky-data.js`)

Plugin attributes: `mode="explore|name|find"`, `level="1|2|3"`, `projection="map|sphere"`, `height="560"`.

Build: `python build.py` (reads `src/plugin.html` and `data/`).

## Data

Stars (Yale Bright Star Catalogue, to mag 6), constellation lines, IAU boundaries and Milky Way
outlines from [d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn,
BSD 3-Clause licence (see `data/LICENSE-d3-celestial`).
