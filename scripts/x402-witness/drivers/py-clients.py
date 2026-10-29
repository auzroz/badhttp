# Python x402 payment-client drivers for the /402 witness family. Speaks the driver protocol (see README.md):
#
#   X402_WITNESS_PAYER_KEY=0x... $X402_VENV/bin/python -I py-clients.py <client-id>
#
# client ids: x402-httpx | x402-requests  (the roster, not this file, says which are captured)
# Each cell starts a fresh process, builds ONE payment-wrapped client with the throwaway Base Sepolia payer (a local eth_account
# private key, registered for eip155:84532 only through the library's register_exact_evm_client helper) and makes ONE GET per FETCH
# line. No redirects, no retries of our own, no spending limit set by us. The key is read from the environment, removed from it,
# and never printed.
import asyncio
import hashlib
import json
import os
import re
import sys
from importlib import metadata

for _k in list(os.environ):
    if re.fullmatch(r"(?i)(https?_proxy|all_proxy|no_proxy)", _k):
        del os.environ[_k]
os.environ["NO_PROXY"] = "*"

KEY = os.environ.pop("X402_WITNESS_PAYER_KEY", "")
NETWORK = "eip155:84532"
RUNTIME = "python " + sys.version.split()[0]
_KEY_FORMS = [k for k in (KEY, KEY.lower(), KEY[2:] if KEY.startswith("0x") else "") if k]
_HEX64 = re.compile(r"0x[0-9a-fA-F]{64,}")


def scrub(text, limit=300):
    t = "" if text is None else str(text)
    for k in _KEY_FORMS:
        t = t.replace(k, "<key>")
    t = _HEX64.sub("<hex>", t)
    t = re.sub(r"https?://(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?", "https://badhttp.dev", t)
    t = re.sub(r"(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?", "<host>", t)
    t = re.sub(r"(?:/Users|/Volumes|/private|/var|/tmp|/home)/[^\s'\")\]]+", "<path>", t)
    t = re.sub(r"(<host>['\")\]]*)[,: ]+\d{2,5}\b", r"\1", t)
    t = re.sub(r"\bports?\s*[=:]?\s*\d{2,5}\b", "port", t, flags=re.I)
    return re.sub(r"\s+", " ", t).strip()[:limit]


def die(message):
    sys.stderr.write("driver: " + scrub(message) + "\n")
    sys.exit(2)


def ver(name):
    try:
        return metadata.version(name)
    except Exception:
        die("module %s not found in the venv" % name)


def jsonable(obj, depth=0):
    if obj is None or isinstance(obj, (bool, int, float)):
        return obj
    if isinstance(obj, str):
        return obj
    if depth > 4:
        return scrub(repr(obj), 120)
    if isinstance(obj, (list, tuple)):
        return [jsonable(x, depth + 1) for x in obj[:8]]
    if isinstance(obj, dict):
        return {str(k): jsonable(v, depth + 1) for k, v in list(obj.items())[:16]}
    for attr in ("model_dump",):
        fn = getattr(obj, attr, None)
        if callable(fn):
            try:
                return jsonable(fn(mode="json", by_alias=False), depth + 1)
            except Exception:
                pass
    if hasattr(obj, "__dict__"):
        return jsonable(vars(obj), depth + 1)
    return scrub(repr(obj), 120)


def says_filter(says):
    """JSON-safe, scrubbed, at most 2 KB. A transaction hash is the one 0x-hex token a line may carry."""

    def walk(v, key=""):
        if isinstance(v, str):
            return v if key == "transaction" and re.fullmatch(r"0x[0-9a-fA-F]{64}", v) else scrub(v, 160)
        if isinstance(v, list):
            return [walk(x, key) for x in v]
        if isinstance(v, dict):
            return {k: walk(x, k) for k, x in v.items()}
        return v

    out = walk(jsonable(says))
    if len(json.dumps(out)) > 2048:
        return {"truncated": True}
    return out


def selected_of(ctx):
    r = getattr(ctx, "selected_requirements", None)
    if r is None:
        return None
    amount = getattr(r, "amount", None)
    if amount is None:
        amount = getattr(r, "max_amount_required", None)
    return {
        "scheme": getattr(r, "scheme", None),
        "network": getattr(r, "network", None),
        "amount": None if amount is None else str(amount),
        "payTo": getattr(r, "pay_to", None),
    }


def make_signer():
    if not re.fullmatch(r"0x[0-9a-fA-F]{64}", KEY):
        die("X402_WITNESS_PAYER_KEY is not a 0x-prefixed 64-hex key")
    from eth_account import Account
    from x402.mechanisms.evm.signers import EthAccountSigner

    return EthAccountSigner(Account.from_key(KEY))


def receipt_of(http_client, headers):
    h = headers.get("payment-response") or headers.get("x-payment-response")
    if not h:
        return {}
    try:
        return {"receipt": jsonable(http_client.get_payment_settle_response(lambda n: headers.get(n)))}
    except Exception as e:
        return {"receipt_decode_error": type(e).__name__}


def build_hooks(client, says):
    def after(ctx):
        says["payment_created"] = True
        says["selected"] = selected_of(ctx)

    def failure(ctx):
        err = getattr(ctx, "error", None)
        says["creation_failed"] = {"name": type(err).__name__, "message": scrub(err)}
        return None

    return after, failure


class HttpxClient:
    library = "x402 (python) httpx client"
    generation = "both"

    def __init__(self):
        from x402 import x402Client
        from x402.mechanisms.evm.exact.register import register_exact_evm_client

        self.says = {}
        self.client = x402Client()
        register_exact_evm_client(self.client, make_signer(), networks=NETWORK)
        after, failure = build_hooks(self.client, self.says)
        self.client.on_after_payment_creation(after)
        self.client.on_payment_creation_failure(failure)
        self.version = "%s (httpx %s, eth-account %s)" % (ver("x402"), ver("httpx"), ver("eth-account"))
        self.configuration = "Base Sepolia (eip155:84532) registered with register_exact_evm_client; signer: a local private key (eth_account); library defaults"

    def fetch_one(self, url):
        from x402.http import x402HTTPClient
        from x402.http.clients.httpx import x402HttpxClient

        async def go():
            async with x402HttpxClient(self.client) as h:
                r = await h.get(url)
                body = r.content
                says = dict(self.says)
                says.update(receipt_of(x402HTTPClient(self.client), r.headers))
                return r.status_code, body, says

        return asyncio.run(go())


class RequestsClient:
    library = "x402 (python) requests client"
    generation = "both"

    def __init__(self):
        from x402 import x402ClientSync
        from x402.mechanisms.evm.exact.register import register_exact_evm_client

        self.says = {}
        self.client = x402ClientSync()
        register_exact_evm_client(self.client, make_signer(), networks=NETWORK)
        after, failure = build_hooks(self.client, self.says)
        self.client.on_after_payment_creation(after)
        self.client.on_payment_creation_failure(failure)
        self.version = "%s (requests %s, eth-account %s)" % (ver("x402"), ver("requests"), ver("eth-account"))
        self.configuration = "Base Sepolia (eip155:84532) registered with register_exact_evm_client; signer: a local private key (eth_account); library defaults"

    def fetch_one(self, url):
        from x402.http import x402HTTPClientSync
        from x402.http.clients.requests import x402_requests

        s = x402_requests(self.client)
        r = s.get(url, allow_redirects=False)
        says = dict(self.says)
        says.update(receipt_of(x402HTTPClientSync(self.client), r.headers))
        return r.status_code, r.content, says


CLIENTS = {"x402-httpx": HttpxClient, "x402-requests": RequestsClient}


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in CLIENTS:
        die("usage: py-clients.py <%s>" % "|".join(CLIENTS))
    try:
        client = CLIENTS[sys.argv[1]]()
    except SystemExit:
        raise
    except BaseException as e:  # noqa: BLE001
        die("setup %s: %s: %s" % (sys.argv[1], type(e).__name__, e))
    out = sys.stdout
    out.write("HELLO " + json.dumps({"library": client.library, "version": client.version, "runtime": RUNTIME, "http": "1.1", "generation": client.generation, "configuration": client.configuration}) + "\n")
    out.flush()
    for line in sys.stdin:
        line = line.rstrip("\r\n")
        if line.startswith("FETCH "):
            res = {"ok": False, "status": None, "bytes": 0, "sha256": hashlib.sha256(b"").hexdigest(), "error": None, "library_says": None, "exit": None}
            client.says.clear()
            try:
                status, body, says = client.fetch_one(line[6:].strip())
                res.update(ok=True, status=status, bytes=len(body), sha256=hashlib.sha256(body).hexdigest(), library_says=says_filter(says))
            except Exception as e:  # noqa: BLE001
                says = dict(client.says)
                cause = e.__cause__ or e.__context__
                if cause is not None:
                    says["cause"] = "%s: %s" % (type(cause).__name__, scrub(cause, 120))
                res["error"] = {"name": type(e).__name__, "message": scrub(e)}
                res["library_says"] = says_filter(says) if says else None
            out.write("RESULT " + json.dumps(res) + "\n")
            out.flush()
        elif line.strip() == "QUIT":
            out.flush()
            sys.exit(0)


main()
