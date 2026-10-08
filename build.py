#!/usr/bin/env python3
"""Build dist/plugin.html (Eduskript fragment) and dist/index.html (standalone) from src/ + data/.
Sky data: d3-celestial by Olaf Frohn (BSD-3-Clause), https://github.com/ofrohn/d3-celestial"""
import json, math, pathlib

ROOT = pathlib.Path(__file__).parent
D = ROOT / "data"
MAXMAG = 6.0
MW_STEP = 3          # keep every n-th Milky Way vertex
MW_LEVELS = 4
VERSION = "v1.0.0"   # git tag the CDN plugin loads its data from

def load(f): return json.load(open(D / f))
def ra(x): return round(x % 360, 2)
def r2(x): return round(x, 2)

def flat(coords, prec=2):
    out = []
    for lon, lat in coords:
        out += [round(lon % 360, prec), round(lat, prec)]
    return out

stars, idx = [], {}
for f in load("stars.6.json")["features"]:
    m = f["properties"]["mag"]
    if m > MAXMAG: continue
    lon, lat = f["geometry"]["coordinates"]
    stars += [ra(lon), r2(lat), round(m, 1)]
    idx[str(f["id"])] = (ra(lon), r2(lat), m)

names = []
for k, v in load("starnames.json").items():
    if v["name"] and k in idx and idx[k][2] < 1.6:
        names.append([v["name"], idx[k][0], idx[k][1], idx[k][2]])

cons = {}
for f in load("constellations.json")["features"]:
    p = f["properties"]; lon, lat = f["geometry"]["coordinates"]
    cons[f["id"]] = [p["name"], p["gen"], int(p["rank"]), ra(lon), r2(lat)]

lines = {}
for f in load("constellations.lines.json")["features"]:
    lines[f["id"]] = [flat(l) for l in f["geometry"]["coordinates"]]

bounds = {}
for f in load("constellations.bounds.json")["features"]:
    for ring in f["geometry"]["coordinates"]:
        bounds.setdefault(f["id"], []).append(flat(ring))

nb = {}
for f in load("constellations.borders.json")["features"]:
    a, b = f["ids"].split(",")
    nb.setdefault(a, set()).add(b); nb.setdefault(b, set()).add(a)
nb = {k: sorted(v - {k}) for k, v in nb.items()}

messier = []
for f in load("messier.json")["features"]:
    lon, lat = f["geometry"]["coordinates"]
    messier.append([f["id"], ra(lon), r2(lat)])

mw = []
for f in load("mw.json")["features"][:MW_LEVELS]:
    rings = []
    for poly in f["geometry"]["coordinates"]:
        for ring in poly:
            pts = ring[::MW_STEP]
            if len(pts) >= 4: rings.append(flat(pts, 1))
    mw.append(rings)

data = dict(s=stars, sn=names, c=cons, l=lines, b=bounds, nb=nb, m=messier, mw=mw)
js = json.dumps(data, separators=(",", ":"))
src = (ROOT / "src" / "plugin.html").read_text()
frag = src.replace("/*@DATA@*/null", js)
# CDN variant for Eduskript (plugin HTML capped at 512 KB): data loaded from jsDelivr
CDN = "https://cdn.jsdelivr.net/gh/marcchehab/sky-quiz@" + VERSION + "/dist/sky-data.js"
(ROOT / "dist" / "sky-data.js").write_text("window.SKY_DATA=" + js + ";\n")
cdn = src.replace("<script>\n(function () {", '<script src="' + CDN + '"></script>\n<script>\n(function () {', 1)
cdn = cdn.replace("/*@DATA@*/null", "window.SKY_DATA")
assert CDN in cdn and "window.SKY_DATA" in cdn
(ROOT / "dist" / "plugin-cdn.html").write_text(cdn)
(ROOT / "dist" / "plugin.html").write_text(frag)
page = ("<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<title>Constellation Trainer</title></head>\n<body class=\"standalone\">\n"
        + frag + "\n</body></html>\n")
(ROOT / "dist" / "index.html").write_text(page)
print(f"cdn plugin {len(cdn)/1024:.0f} KB, stars {len(stars)//3}, names {len(names)}, data {len(js)/1024:.0f} KB, plugin {len(frag)/1024:.0f} KB")
