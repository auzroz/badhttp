"""huggingface_hub resume driver for the /range witness family.

usage: python -I hf.py URL OUTFILE

Resumes OUTFILE (an existing partial, or nothing) the way huggingface_hub's own
download code does: the file is opened for append and huggingface_hub.file_download.http_get
is handed the open file and resume_size = the bytes already on disk. http_get sends
Range: bytes=<size>- (nothing when the size is 0), restarts the file on a 200, derives the
expected size from Content-Range (else Content-Length) and raises OSError after writing
when the byte count differs.

Exit 0: http_get returned. 1: http_get raised. 2: the driver could not run.
The LAST stdout line is `RESULT {json}`; the orchestrator reads only that and the exit code.
"""
import json
import os
import re
import sys

LIBRARY = "huggingface_hub"
RUNTIME = "python %d.%d.%d" % sys.version_info[:3]
state = {"version": "unknown", "http": "1.1"}


def scrub(text):
    text = re.sub(r"https?://(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?", "https://badhttp.dev", str(text))
    text = re.sub(r"(?:127\.0\.0\.1|0\.0\.0\.0|localhost|\[::1\])(?::\d+)?", "<host>", text)
    text = re.sub(r"(?:/Users|/Volumes|/private|/var|/tmp|/home)/[^\s'\")\]]+", "<path>", text)
    return " ".join(text.split())[:200]


def finish(ok, kind, name, message, code):
    print("RESULT " + json.dumps({
        "ok": ok, "kind": kind, "name": name, "message": scrub(message) if message else "",
        "library": LIBRARY, "version": state["version"], "runtime": RUNTIME, "http": state["http"],
    }, separators=(",", ":")), flush=True)
    sys.exit(code)


def main():
    if len(sys.argv) != 3:
        finish(False, "raised", "DriverError", "usage: hf.py URL OUTFILE", 2)
    url, path = sys.argv[1], sys.argv[2]
    try:
        import importlib.metadata
        import httpx2
        from huggingface_hub import utils as hf_utils
        from huggingface_hub.file_download import http_get
        from huggingface_hub.utils import _http as hf_http
        state["version"] = importlib.metadata.version("huggingface_hub")
    except Exception as e:  # missing module: the driver could not run
        finish(False, "raised", type(e).__name__, str(e), 2)

    hf_utils.disable_progress_bars()
    seen = []

    def note_response(response):
        seen.append(response.http_version)

    def client_factory():
        # The library's default client (hf_request_event_hook, follow_redirects, no timeout),
        # with HTTP/1.1 stated outright instead of left to httpx2's default.
        return httpx2.Client(
            event_hooks={"request": [hf_http.hf_request_event_hook], "response": [note_response]},
            follow_redirects=True, timeout=None, http1=True, http2=False,
        )

    hf_utils.set_client_factory(client_factory)

    size = os.path.getsize(path) if os.path.exists(path) else 0
    # displayed_filename only labels the progress bar and the consistency-check message; the
    # library would otherwise print the URL, whose origin is the harness's loopback recorder.
    label = re.sub(r"^https?://[^/]+", "", url)
    try:
        with open(path, "ab") as f:
            http_get(url, f, resume_size=size, displayed_filename=label, _nb_retries=0)
    except BaseException as e:
        if seen:
            state["http"] = seen[-1].replace("HTTP/", "")
        finish(False, "raised", type(e).__name__, str(e), 1)
    if seen:
        state["http"] = seen[-1].replace("HTTP/", "")
    finish(True, "return", None, "", 0)


main()
