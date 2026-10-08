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

## Sky Stories (standalone page)

**Publishing a story for visitors:** export it with ⤓, put the `.skystory` file into `stories/`
(prefix `01-`, `02-` … for the course order), run `python build.py` (writes `stories/index.json`),
commit and push. The online page lists published stories in the default *Sky Stories* mode; recording
tools are only shown in the local file or with `?author` in the URL.

📖 Stories → ● Record: talk while you click constellations and move the sky; everything is replayed
in sync. Stories are stored locally in the browser (IndexedDB); ⤓ exports a `.skystory` file
(JSON + audio), Import reads it back. CC creates subtitles with Whisper (runs in the browser,
model downloaded once). ✎ in the player shifts/deletes cues and fixes subtitle text.

**Pictures and sounds (✎ editor):** 🎨 on a cue generates pictures for its constellations, by default
with Gemini via [OpenRouter](https://openrouter.ai) (key asked once, kept in the browser; ~10 s, ~$0.07
each) or with a local [ComfyUI](https://github.com/comfyanonymous/ComfyUI) (FLUX dev GGUF; start it with
`python main.py --enable-cors-header '*'`); you pick one and place it with 📌 (drag = move, wheel =
size, Shift = turn); it stays fixed to the stars and fades in/out with the constellations.
🔊 adds a local sound file at the playhead. Both are exported in the `.skystory` file.
