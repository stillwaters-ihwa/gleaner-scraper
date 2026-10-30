# Gleaner's Scrapling engine. Gleaner's helper starts it on demand; it listens on this computer only
# (127.0.0.1) and answers only requests that carry the token it printed when it started.
#
# What it does, with Scrapling (https://github.com/D4Vinci/Scrapling):
#   /crawl/*     crawl a whole site with Scrapling's Spider: same site only, robots.txt obeyed,
#                a polite delay between requests, a page limit and a depth limit. A stopped crawl
#                is paused (Scrapling's checkpoint) and can be continued later.
#   /adaptive/*  remember where a list sits on a page, and find it again after the site's layout
#                changes (Scrapling's adaptive selectors)
#
# Honest by design: no TLS impersonation, no generated headers or fake referer, no stealth browser,
# no CAPTCHA or Cloudflare solving, no retrying of blocked requests. Pages are requested with the
# user's own browser's User-Agent.
import argparse
import json
import re
import secrets
import sys
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SERVER_VERSION = 1

import scrapling  # noqa: E402
from scrapling.parser import Selector  # noqa: E402


def _decode(page) -> str:
    """The page's HTML as text."""
    for attr in ("html_content", "text"):
        v = getattr(page, attr, None)
        if isinstance(v, str) and v:
            return v
    body = getattr(page, "body", b"")
    if isinstance(body, bytes):
        return body.decode(getattr(page, "encoding", None) or "utf-8", errors="replace")
    return str(body or "")


# ---------- crawling a site ----------

TITLE_WS = re.compile(r"\s+")


def _clean(s) -> str:
    return TITLE_WS.sub(" ", str(s or "")).strip()


class Crawl:
    def __init__(self, cid: str, opts: dict):
        self.id = cid
        self.opts = opts
        self.items: list = []
        self.lock = threading.Lock()
        self.done = False
        self.stopped = False
        self.error = ""
        self.started = time.time()
        self.robots_skipped = 0
        self.spider = None
        self.thread = threading.Thread(target=self._run, daemon=True)

    def _run(self):
        try:
            from scrapling.spiders import Spider, Response

            crawl = self
            o = self.opts
            start = o["start_url"]
            host = urllib.parse.urlsplit(start).hostname or ""
            domain = host[4:] if host.startswith("www.") else host
            # Scrapling matches the site with its port, when there is one
            port = urllib.parse.urlsplit(start).port
            netloc = f"{domain}:{port}" if port else domain
            max_pages = max(1, int(o.get("max_pages", 200)))
            max_depth = max(0, int(o.get("max_depth", 3)))
            skip = re.compile(r"\.(jpe?g|png|gif|webp|svg|ico|pdf|zip|rar|7z|mp4|mp3|webm|mov|avi|css|js|woff2?|ttf|xml|rss|json)(\?|$)", re.I)
            depth_of = {start: 0}
            queued = {start}

            class SiteSpider(Spider):
                name = "gleaner-site"
                start_urls = [start]
                allowed_domains = {netloc}
                robots_txt_obey = bool(o.get("obey_robots", True))
                concurrent_requests = max(1, min(8, int(o.get("concurrency", 4))))
                concurrent_requests_per_domain = max(1, min(8, int(o.get("concurrency", 4))))
                download_delay = max(0.0, float(o.get("delay", 0.5)))
                max_blocked_retries = 0  # a site that pushes back is not retried

                def configure_sessions(self, manager):
                    from scrapling.fetchers import FetcherSession

                    ua = str(o.get("ua", ""))
                    manager.add("default", FetcherSession(impersonate=None, stealthy_headers=False, headers={"User-Agent": ua} if ua else None, retries=1, timeout=30))

                async def parse(self, response: Response):
                    url = str(response.url)
                    d = depth_of.get(url, depth_of.get(str(getattr(getattr(response, "request", None), "url", url)), 0))
                    title = _clean(response.css("title::text").get(""))
                    desc = _clean(response.css('meta[name="description"]::attr(content)').get(""))
                    h1 = _clean(response.css("h1::text").get(""))
                    canonical = response.css('link[rel="canonical"]::attr(href)').get("") or ""
                    lang = response.css("html::attr(lang)").get("") or ""
                    hrefs = [h for h in response.css("a::attr(href)").getall() if h and not h.startswith(("#", "mailto:", "tel:", "javascript:"))]
                    absolute = [urllib.parse.urljoin(url, h).split("#")[0] for h in hrefs]
                    internal = [u for u in absolute if (urllib.parse.urlsplit(u).hostname or "").endswith(domain)]
                    words = len(_clean(" ".join(response.css("body ::text").getall())).split())
                    with crawl.lock:
                        crawl.items.append({
                            "url": url, "status": str(getattr(response, "status", "")), "depth": str(d), "title": title,
                            "description": desc, "h1": h1, "canonical": canonical, "lang": lang, "words": str(words),
                            "links_internal": str(len(set(internal))), "links_external": str(len(set(absolute)) - len(set(internal))),
                        })
                    if crawl.stopped or d >= max_depth:
                        return
                    for u in dict.fromkeys(internal):
                        # Pages robots.txt keeps out don't count toward the limit
                        stats = getattr(self, "stats", None)
                        kept_out = int(getattr(stats, "robots_disallowed_count", 0) or 0)
                        if len(queued) - kept_out >= max_pages or crawl.stopped:
                            break
                        if u in queued or skip.search(u):
                            continue
                        queued.add(u)
                        depth_of[u] = d + 1
                        yield response.follow(u, callback=self.parse)

            # One checkpoint folder per site: stopping pauses there, and the next crawl can continue
            crawldir = Path(Handler.data_dir) / "crawls" / re.sub(r"[^a-z0-9.-]", "_", domain.lower())
            if not o.get("resume"):
                import shutil

                shutil.rmtree(crawldir, ignore_errors=True)
            crawldir.mkdir(parents=True, exist_ok=True)
            self.spider = SiteSpider(crawldir=str(crawldir))
            result = self.spider.start()
            stats = getattr(result, "stats", None)
            self.robots_skipped = int(getattr(stats, "robots_disallowed_count", 0) or 0) if stats else 0
        except Exception as e:
            self.error = f"{type(e).__name__}: {e}"
            traceback.print_exc(file=sys.stderr)
        finally:
            self.done = True

    def status(self, cursor: int) -> dict:
        with self.lock:
            new = self.items[cursor:]
            total = len(self.items)
        return {"id": self.id, "pages": total, "items": new, "cursor": total, "done": self.done, "stopped": self.stopped, "error": self.error, "seconds": round(time.time() - self.started, 1), "robots_skipped": self.robots_skipped}


crawls: dict = {}


# ---------- adaptive selectors ----------

def adaptive_selector(html: str, url: str, key: str, db: str) -> Selector:
    return Selector(html, url=url, adaptive=True, storage_args={"storage_file": db, "url": key})


def item_selector(found) -> str:
    """One selector for every relocated item: their shared parent, then their tag and shared classes."""
    els = list(found)
    if not els:
        return ""
    parents = {id(getattr(e, "parent", None)) for e in els}
    parent = getattr(els[0], "parent", None)
    if len(parents) != 1 or parent is None:
        return els[0].generate_css_selector
    tag = els[0].tag
    if any(e.tag != tag for e in els):
        return ""
    classes = [set(str(e.attrib.get("class", "")).split()) for e in els]
    common = sorted(set.intersection(*classes)) if classes else []
    return f"{parent.generate_css_selector} > {tag}" + "".join("." + c for c in common[:2] if c.replace("-", "").replace("_", "").isalnum())


def describe(el) -> dict:
    def safe(name):
        try:
            v = getattr(el, name)
            return v() if callable(v) else v
        except Exception:
            return ""

    return {"css": safe("generate_css_selector"), "full_css": safe("generate_full_css_selector"), "tag": getattr(el, "tag", ""), "text": _clean(getattr(el, "text", ""))[:120]}


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    token = ""
    db = ""
    data_dir = ""

    def log_message(self, *a):  # quiet
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type, x-gleaner-token")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send(self, code: int, obj) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _authorized(self) -> bool:
        if not secrets.compare_digest(self.headers.get("x-gleaner-token", ""), self.token):
            self._send(403, {"error": "forbidden"})
            return False
        return True

    def do_GET(self):
        if not self._authorized():
            return
        u = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        if u.path == "/hello":
            return self._send(200, {"server": SERVER_VERSION, "scrapling": getattr(scrapling, "__version__", "?"), "python": sys.version.split()[0]})
        if u.path == "/crawl/status":
            c = crawls.get(q.get("id", ""))
            return self._send(200, c.status(int(q.get("cursor", 0)))) if c else self._send(404, {"error": "no such crawl"})
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self._authorized():
            return
        try:
            n = int(self.headers.get("content-length", 0) or 0)
            args = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._send(400, {"error": "bad request"})
        path = urllib.parse.urlsplit(self.path).path
        try:
            if path == "/crawl/start":
                if not str(args.get("start_url", "")).startswith(("http://", "https://")):
                    return self._send(400, {"error": "not a web address"})
                cid = secrets.token_hex(6)
                c = Crawl(cid, args)
                crawls[cid] = c
                c.thread.start()
                return self._send(200, {"id": cid})
            if path == "/crawl/stop":
                c = crawls.get(str(args.get("id", "")))
                if c:
                    c.stopped = True
                    if c.spider is not None:
                        c.spider.pause()
                return self._send(200, {"ok": bool(c)})
            if path in ("/adaptive/save", "/adaptive/relocate"):
                sel = adaptive_selector(str(args["html"]), str(args.get("url", "")), str(args["key"]), self.db)
                ident = str(args.get("identifier") or args["selector"])
                if path == "/adaptive/save":
                    found = sel.css(str(args["selector"]), identifier=ident, auto_save=True)
                    return self._send(200, {"saved": len(found)})
                found = sel.css(str(args["selector"]), identifier=ident, adaptive=True, percentage=int(args.get("percentage", 40)))
                return self._send(200, {"found": [describe(el) for el in list(found)[:50]], "count": len(found), "item_selector": item_selector(found)})
            self._send(404, {"error": "not found"})
        except Exception as e:
            traceback.print_exc(file=sys.stderr)
            self._send(500, {"error": f"{type(e).__name__}: {e}"})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    a = ap.parse_args()
    data = Path(a.data_dir)
    data.mkdir(parents=True, exist_ok=True)
    Handler.token = secrets.token_urlsafe(24)
    Handler.db = str(data / "adaptive.db")
    Handler.data_dir = str(data)
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    # The helper reads this line to learn where to connect
    print(json.dumps({"port": server.server_address[1], "token": Handler.token, "server": SERVER_VERSION, "scrapling": getattr(scrapling, "__version__", "?")}), flush=True)
    # Stop when the helper goes away (its pipe to us closes)
    threading.Thread(target=lambda: (sys.stdin.read(), server.shutdown()), daemon=True).start()
    server.serve_forever()


if __name__ == "__main__":
    main()
