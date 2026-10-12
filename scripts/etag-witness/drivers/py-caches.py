"""Python HTTP-cache drivers for the /etag witness family. Speaks the driver protocol (see README.md).

usage: $ETAG_VENV/bin/python -I py-caches.py <client-id>

client ids: hishel | requests-cache | requests-cache-cc | cachecontrol | aiohttp-client-cache | aiohttp-client-cache-cc
Each fetch goes through ONE cache instance created at process start; its store is a file in the
working directory (hishel: SQLite file, requests-cache: SQLite file, CacheControl: FileCache directory,
aiohttp-client-cache: SQLite file). No retries, no redirects (allow_redirects / follow_redirects off,
so a driver never follows a different URL).

The -cc ids differ from the plain ones by exactly one option: cache_control=True, which the two
requests-cache family libraries default to False (their defaults ignore the response's Cache-Control
and keep every stored response for ever).
"""
import hashlib
import json
import os
import re
import sys
import time

# No proxy variables reach the libraries (requests, httpx and aiohttp read them): the family measures the cache, not an environment's proxy.
for _k in list(os.environ):
    if _k.lower() in ("http_proxy", "https_proxy", "all_proxy", "no_proxy"):
        del os.environ[_k]
os.environ["NO_PROXY"] = "*"

RUNTIME = "python %d.%d.%d" % sys.version_info[:3]
EMPTY = hashlib.sha256(b"").hexdigest()


def scrub(text):
    text = re.sub(r"https?://(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?", "https://badhttp.dev", str(text))
    text = re.sub(r"(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?", "<host>", text)
    text = re.sub(r"(?:/Users|/Volumes|/private|/var|/tmp|/home)/[^\s'\")\]]+", "<path>", text)
    text = re.sub(r"(<host>['\")\]]*)[,: ]+\d{2,5}\b", r"\1", text)
    text = re.sub(r"\bports?\s*[=:]?\s*\d{2,5}\b", "port", text, flags=re.I)
    return " ".join(text.split())[:200]


def die(message):
    sys.stderr.write("driver: " + scrub(message) + "\n")
    sys.exit(2)


def out(line):
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def version_of(dist):
    from importlib.metadata import version
    return version(dist)


class Client:
    library = ""
    version = ""
    configuration = ""

    def fetch(self, url):  # -> (status, body bytes, library_says)
        raise NotImplementedError

    def close(self):
        pass


class Hishel(Client):
    library = "hishel (httpx)"
    configuration = ("hishel.httpx.SyncCacheClient(storage=SyncSqliteStorage(database_path=a file in the working directory)), default policy, follow_redirects off; "
                     "the driver waits 1100 ms before every fetch after the first")
    fetches = 0

    def __init__(self):
        import httpx
        from hishel import SyncSqliteStorage
        from hishel.httpx import SyncCacheClient
        self.version = "%s (httpx %s)" % (version_of("hishel"), version_of("httpx"))
        self.client = SyncCacheClient(storage=SyncSqliteStorage(database_path="hishel_cache.db"), follow_redirects=False)

    def fetch(self, url):
        # hishel orders stored candidates by the response's Date, which has one-second resolution; without the wait two
        # responses stored in the same second are indistinguishable to it.
        if self.fetches:
            time.sleep(1.1)
        self.fetches += 1
        r = self.client.get(url)
        body = r.content
        says = {k.replace("hishel_", ""): r.extensions.get(k) for k in ("hishel_from_cache", "hishel_revalidated", "hishel_stored") if k in r.extensions}
        return r.status_code, body, says or None

    def close(self):
        self.client.close()


class RequestsCache(Client):
    library = "requests-cache"

    def __init__(self, cache_control):
        import requests_cache
        self.version = "%s (requests %s)" % (version_of("requests-cache"), version_of("requests"))
        kw = {"cache_control": True} if cache_control else {}
        self.session = requests_cache.CachedSession("rc_cache", backend="sqlite", **kw)
        self.configuration = ("requests_cache.CachedSession('<file in the working directory>', backend='sqlite'"
                              + (", cache_control=True" if cache_control else "") + "), other options default, allow_redirects off")

    def fetch(self, url):
        r = self.session.get(url, allow_redirects=False)
        return r.status_code, r.content, {"from_cache": bool(r.from_cache), "is_expired": bool(getattr(r, "is_expired", False))}

    def close(self):
        self.session.close()


class CacheControl(Client):
    library = "CacheControl (requests)"
    configuration = "cachecontrol.CacheControl(requests.Session(), cache=FileCache(<directory in the working directory>)), cache_etags default (True), allow_redirects off"

    def __init__(self):
        import requests
        from cachecontrol import CacheControl as wrap
        from cachecontrol.caches.file_cache import FileCache
        self.version = "%s (requests %s)" % (version_of("CacheControl"), version_of("requests"))
        self.session = wrap(requests.Session(), cache=FileCache(".web_cache"))

    def fetch(self, url):
        r = self.session.get(url, allow_redirects=False)
        return r.status_code, r.content, {"from_cache": bool(getattr(r, "from_cache", False))}

    def close(self):
        self.session.close()


class AiohttpClientCache(Client):
    library = "aiohttp-client-cache"

    def __init__(self, cache_control):
        import asyncio
        from aiohttp_client_cache import CachedSession, SQLiteBackend
        self.asyncio = asyncio
        self.loop = asyncio.new_event_loop()
        self.version = "%s (aiohttp %s)" % (version_of("aiohttp-client-cache"), version_of("aiohttp"))
        kw = {"cache_control": True} if cache_control else {}

        async def make():  # aiohttp wants a running loop when the session is created
            return CachedSession(cache=SQLiteBackend("aiohttp_cache", **kw))
        self.session = self.loop.run_until_complete(make())
        self.configuration = ("aiohttp_client_cache.CachedSession(cache=SQLiteBackend('<file in the working directory>'"
                              + (", cache_control=True" if cache_control else "") + ")), other options default, allow_redirects off")

    def fetch(self, url):
        async def go():
            async with self.session.get(url, allow_redirects=False) as r:
                body = await r.read()
                return r.status, body, {"from_cache": bool(getattr(r, "from_cache", False)), "is_expired": bool(getattr(r, "is_expired", False))}
        return self.loop.run_until_complete(go())

    def close(self):
        try:
            self.loop.run_until_complete(self.session.close())
        finally:
            self.loop.close()


MAKERS = {
    "hishel": lambda: Hishel(),
    "requests-cache": lambda: RequestsCache(False),
    "requests-cache-cc": lambda: RequestsCache(True),
    "cachecontrol": lambda: CacheControl(),
    "aiohttp-client-cache": lambda: AiohttpClientCache(False),
    "aiohttp-client-cache-cc": lambda: AiohttpClientCache(True),
}


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in MAKERS:
        die("usage: py-caches.py <%s>" % "|".join(MAKERS))
    try:
        client = MAKERS[sys.argv[1]]()
    except Exception as e:  # a missing module or a failed setup: the driver could not run
        die("setup %s: %s: %s" % (sys.argv[1], type(e).__name__, e))
    out("HELLO " + json.dumps({"library": client.library, "version": client.version, "runtime": RUNTIME,
                               "http": "1.1", "configuration": client.configuration}, separators=(",", ":")))
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.rstrip("\r\n")
        if line == "QUIT":
            break
        if not line.startswith("FETCH "):
            continue
        res = {"ok": False, "status": None, "bytes": 0, "sha256": EMPTY, "error": None, "library_says": None, "exit": None}
        try:
            status, body, says = client.fetch(line[6:].strip())
            res.update(ok=True, status=status, bytes=len(body), sha256=hashlib.sha256(body).hexdigest(), library_says=says)
        except BaseException as e:  # the library raised: report it, never retry
            res["error"] = {"name": type(e).__name__, "message": scrub(e)}
        out("RESULT " + json.dumps(res, separators=(",", ":")))
    try:
        client.close()
    except Exception:
        pass
    sys.exit(0)


main()
