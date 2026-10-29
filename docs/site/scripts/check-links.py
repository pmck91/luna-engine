"""Check local routes, fragments and assets in the built Pages subpath."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit
import posixpath

ROOT = Path(__file__).resolve().parents[1] / "dist"
BASE = "/luna-engine/"


class Page(HTMLParser):
    def __init__(self, path):
        super().__init__()
        self.path, self.ids, self.links = path, set(), []
        self.feed(path.read_text())

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.add(attrs["id"])
        if tag == "a" and "href" in attrs:
            self.links.append(attrs["href"])
        for attr in ("src", "poster"):
            if attr in attrs:
                self.links.append(attrs[attr])
        if tag == "link" and attrs.get("rel") in ("stylesheet", "icon", "preload", "modulepreload"):
            self.links.append(attrs.get("href", ""))
        if "srcset" in attrs:
            self.links.extend(item.strip().split()[0] for item in attrs["srcset"].split(",") if item.strip())


pages = {p: Page(p) for p in ROOT.rglob("*.html")}
if not pages:
    raise SystemExit("No built HTML; run npm run build first")
errors, count = [], 0
for path, page in pages.items():
    relative = path.relative_to(ROOT).as_posix()
    current = BASE + (relative[:-10] if relative.endswith("index.html") else relative)
    for href in page.links:
        url = urlsplit(href)
        if url.scheme or url.netloc:
            continue
        target = posixpath.normpath(posixpath.join(posixpath.dirname(current) + "/", unquote(url.path))) if url.path and not url.path.startswith("/") else unquote(url.path) or current
        count += 1
        if not target.startswith(BASE):
            errors.append(f"{relative}: link escapes Pages base: {href}")
            continue
        file = ROOT / target[len(BASE):]
        if file.is_dir():
            file = file / "index.html"
        if not file.exists():
            errors.append(f"{relative}: missing target: {href}")
        elif url.fragment and file in pages and unquote(url.fragment) not in pages[file].ids:
            errors.append(f"{relative}: missing fragment: {href}")
if errors:
    raise SystemExit("\n".join(errors))
print(f"Checked {count} local links/assets/fragments across {len(pages)} HTML pages")
