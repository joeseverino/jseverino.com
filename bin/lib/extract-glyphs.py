#!/usr/bin/env python3
"""Extract Inter glyph outlines as SVG path data for the brand mark.

Reads the shipped Inter variable woff2, instantiates it at a fixed weight, and
emits SVG path data + metrics for the requested characters to
bin/lib/inter-glyphs.json. Re-run this only when the glyph string or font
weight changes; the node generators consume the JSON, so they stay pure-node.

Usage: python3 bin/lib/extract-glyphs.py "JS" 800
"""
import json
import sys
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

root = Path(__file__).resolve().parents[2]
font_path = root / "public/assets/fonts/inter/inter-variable-latin.woff2"
out_path = Path(__file__).resolve().parent / "inter-glyphs.json"

chars = sys.argv[1] if len(sys.argv) > 1 else "JS"
weight = float(sys.argv[2]) if len(sys.argv) > 2 else 800.0

font = TTFont(str(font_path))
if "fvar" in font:
    instantiateVariableFont(font, {"wght": weight}, inplace=True)

glyph_set = font.getGlyphSet()
cmap = font.getBestCmap()
upem = font["head"].unitsPerEm

glyphs = {}
for ch in dict.fromkeys(chars):
    name = cmap[ord(ch)]
    g = glyph_set[name]
    pen = SVGPathPen(glyph_set)
    g.draw(pen)
    bp = BoundsPen(glyph_set)
    g.draw(bp)
    xmin, ymin, xmax, ymax = bp.bounds
    glyphs[ch] = {
        "path": pen.getCommands(),
        "advance": g.width,
        "bounds": {"xMin": xmin, "yMin": ymin, "xMax": xmax, "yMax": ymax},
    }

out_path.write_text(json.dumps({"unitsPerEm": upem, "weight": weight, "glyphs": glyphs}, indent=2))
print(f"wrote {out_path.relative_to(root)} — upem={upem} weight={int(weight)} chars={''.join(glyphs)}")
for ch, d in glyphs.items():
    print(f"  {ch}: advance={d['advance']} path_len={len(d['path'])}")
