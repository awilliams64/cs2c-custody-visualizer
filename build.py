#!/usr/bin/env python3
"""Build index.html from the page template and the coastline data.

The template (src/visualizer.tpl.html) holds the page body: styles, markup and script.
The coastline data (src/world-outlines.txt, from Natural Earth 50m via world-atlas) is
injected at the __WORLD__ placeholder so the page stays a single self-contained file.

Usage: python3 build.py
"""
from pathlib import Path

ROOT = Path(__file__).parent
HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="Globe shell: interactive globe and interface base for new visualizers. Unclassified.">
<style>
  :root{color-scheme:light}
  body{margin:0;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
  img{max-width:100%}
  [hidden]{display:none!important}
</style>
</head>
<body>
"""
TAIL = "\n</body>\n</html>\n"

def main():
    tpl = (ROOT / "src" / "visualizer.tpl.html").read_text(encoding="utf-8")
    world = (ROOT / "src" / "world-outlines.txt").read_text(encoding="utf-8").strip()
    assert "__WORLD__" in tpl, "template is missing the __WORLD__ placeholder"
    out = HEAD + tpl.replace("__WORLD__", world) + TAIL
    (ROOT / "index.html").write_text(out, encoding="utf-8")
    print(f"wrote index.html ({len(out)/1024:.0f} KB)")

if __name__ == "__main__":
    main()
