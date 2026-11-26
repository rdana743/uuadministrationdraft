"""Package the editor, homepage snapshots and styles in one local HTML file."""
import argparse
import base64
import gzip
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def embed(element_id, value, previous=None):
    compressed = gzip.compress(value.encode("utf-8"), mtime=0)
    encoded = base64.b64encode(compressed).decode("ascii")
    migration = f' data-previous="{previous}"' if previous is not None else ''
    return f'<script type="application/octet-stream" id="{element_id}"{migration}>{encoded}</script>'


def entry(path, function):
    source = path.read_text(encoding="utf-8")
    return json.loads(source.removeprefix("window." + function + "(...").removesuffix(");\n"))


def build():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "home-editor.css").read_text(encoding="utf-8")
    editor = (ROOT / "home-editor.js").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="home-editor.css?v=original3">', "<style>" + css + "</style>")
    assets = []
    for path in sorted((ROOT / "homepages").glob("*.js")):
        key, snapshot, *previous = entry(path, "receiveUuHomepage")
        assets.append(embed("uu-snapshot-" + key, snapshot, *previous))
        style_path = ROOT / "styles" / path.name
        if key == "bhsad":
            style = json.loads(style_path.read_text(encoding="utf-8").removeprefix("window.uuBritanka = ").removesuffix(";\n"))
        else:
            style_key, style = entry(style_path, "receiveUuStyles")
            if style_key != key:
                raise ValueError(f"Stylesheet package mismatch: {style_path}")
        assets.append(embed("uu-styles-" + key, json.dumps(style, ensure_ascii=False)))
    target = '<script src="home-editor.js?v=original3"></script>'
    if target not in html or len(assets) != 20:
        raise ValueError("The editor entry point or a homepage package is missing.")
    return html.replace(target, "".join(assets) + "<script>" + editor + "</script>")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.parse_args().output.write_text(build(), encoding="utf-8")
