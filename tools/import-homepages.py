"""Create inert homepage snapshots. Requires beautifulsoup4 and html5lib."""
import concurrent.futures
import json
import pathlib
import re
import subprocess
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup, Comment

SITES = dict(
    uu="u.university", bhsad="britishdesign.ru", mfs="moscowfilmschool.ru",
    march="march.ru", msca="msca.ru", music="moscowmusicschool.ru",
    scream="scream.school", soe="educationschool.ru", uteens="uteens.ru",
    college="mctechnicum.ru",
)
OUTPUT = pathlib.Path(__file__).resolve().parents[1] / "homepages.js"
ASSET_HOSTS = re.compile(r"(?:^|\.)(?:tildacdn\.(?:com|net|ru|pub)|tilda\.ws|googleapis\.com|gstatic\.com)$")
POLICY = (
    "default-src 'none'; style-src https: 'unsafe-inline'; img-src https: data:; "
    "font-src https: data:; media-src https:; form-action 'none'; base-uri https:"
)
ATTRIBUTES = set("""
    id class style title lang dir role href target rel src alt width height loading
    srcset sizes poster controls muted loop playsinline autoplay type name placeholder
    required checked selected disabled readonly multiple for tabindex colspan rowspan
    minlength maxlength min max step accept pattern value
    content property media viewbox d fill stroke stroke-width xmlns x y cx cy r
    rx ry x1 y1 x2 y2 points transform preserveaspectratio clip-path fill-rule
    stroke-linecap stroke-linejoin opacity gradientunits offset stop-color xlink:href
""".split())


def safe_url(value, base):
    if value.startswith("#"):
        return value
    resolved = urljoin(base, value)
    return resolved if urlsplit(resolved).scheme in {"https", "mailto", "tel"} else ""


def clean(site, html):
    base = f"https://{site}/"
    soup = BeautifulSoup(html, "html5lib")
    for tag in soup.select("script, iframe, object, embed, noscript, base, template, meta[http-equiv]"):
        if tag.attrs is not None:
            tag.decompose()
    for comment in soup.find_all(string=lambda item: isinstance(item, Comment)):
        comment.extract()
    if not soup.head or not soup.body:
        raise ValueError(f"{site}: missing document structure")
    for tag in soup.find_all(True):
        if tag.attrs is None:
            continue
        if tag.name == "link" and "stylesheet" not in tag.get("rel", []):
            tag.decompose()
            continue
        if tag.name == "input" and tag.get("type", "").lower() == "hidden":
            tag.decompose()
            continue
        if tag.name == "img":
            lazy = tag.get("data-original") or tag.get("data-src")
            if lazy:
                tag["src"] = lazy
        if tag.name != "img" and tag.get("data-original") and "t-bgimg" in tag.get("class", []):
            background = safe_url(tag["data-original"], base)
            if urlsplit(background).scheme == "https":
                tag["style"] = (tag.get("style", "") + ";background-image:url(" + json.dumps(background) + ")")
        for attr in list(tag.attrs):
            if attr not in ATTRIBUTES and not attr.startswith(("aria-", "data-field-", "data-artboard-")):
                del tag[attr]
        for attr in ("href", "src", "poster", "xlink:href"):
            if attr in tag.attrs:
                value = safe_url(tag[attr], base)
                host = urlsplit(value).hostname or ""
                if attr in {"src", "poster"} and host and not (
                    host == site or host.endswith("." + site) or ASSET_HOSTS.search(host)
                    or host.removeprefix("www.") in SITES.values()
                ):
                    value = ""
                if value:
                    tag[attr] = value
                else:
                    del tag[attr]
        if tag.name in {"img", "source"}:
            tag.attrs.pop("srcset", None)
    soup.head.insert(0, soup.new_tag("base", href=base))
    meta = soup.new_tag("meta", content=POLICY)
    meta["http-equiv"] = "Content-Security-Policy"
    soup.head.insert(0, meta)
    soup.head.insert(1, soup.new_tag("meta", attrs={"name": "referrer", "content": "no-referrer"}))
    return "<!doctype html>\n" + str(soup.html)


def download(item):
    key, site = item
    raw = subprocess.check_output([
        "curl", "-fsSL", "--max-time", "30", "--max-filesize", "8000000",
        "-A", "Mozilla/5.0", f"https://{site}/",
    ])
    return key, clean(site, raw.decode("utf-8-sig", errors="replace"))


def write_snapshots(snapshots):
    OUTPUT.write_text(
        "window.UU_HOMEPAGES = " + json.dumps(dict(snapshots), ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        write_snapshots(executor.map(download, SITES.items()))
