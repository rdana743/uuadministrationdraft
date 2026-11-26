"""Cache stylesheet responses for script-free homepage previews."""
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
import gzip
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import urljoin

ROOT = Path(__file__).resolve().parents[1]
URL = re.compile(r"""url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)""", re.I)


class Stylesheets(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.urls = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == "link" and "stylesheet" in values.get("rel", "").split():
            href = values.get("href", "")
            if href.startswith("https://"):
                self.urls.append(href)


def download(url):
    try:
        raw = subprocess.check_output(
            ["curl", "-fsSL", "--retry", "1", "--max-time", "12", "--max-filesize", "3000000", url],
            stderr=subprocess.DEVNULL,
        )
        if raw.startswith(b"\x1f\x8b"):
            raw = gzip.decompress(raw)
        source = raw.decode("utf-8-sig")
    except (subprocess.CalledProcessError, UnicodeError, OSError):
        return None

    def absolute(match):
        value = next(part for part in match.groups() if part is not None).strip()
        if value.startswith(("data:", "#")):
            return match[0]
        return "url(" + json.dumps(urljoin(url, value), ensure_ascii=False) + ")"

    return URL.sub(absolute, source)


def main():
    pages = {}
    for path in sorted((ROOT / "homepages").glob("*.js")):
        key, html, *_ = json.loads(path.read_text().removeprefix("window.receiveUuHomepage(...").removesuffix(");\n"))
        if key != "bhsad":
            pages[key] = Stylesheets(html).urls
    urls = list(dict.fromkeys(url for links in pages.values() for url in links))
    with ThreadPoolExecutor(max_workers=12) as pool:
        cached = dict(zip(urls, pool.map(download, urls)))
    for key, links in pages.items():
        styles = {url: cached[url] for url in links if cached[url] is not None}
        result = json.dumps([key, {"styles": styles}], ensure_ascii=False)
        (ROOT / "styles" / (key + ".js")).write_text("window.receiveUuStyles(..." + result + ");\n")
        print(key, len(styles), "/", len(set(links)))


if __name__ == "__main__":
    main()
