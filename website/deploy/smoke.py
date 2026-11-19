"""After deploying: python deploy/smoke.py https://pacificnestadu.com [LETTER_CODE]
Checks the pages, the API and the headers a visitor depends on. Sends no email (the tease endpoint is not called)."""
import json
import sys
import urllib.request

base = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8787").rstrip("/")
code = sys.argv[2] if len(sys.argv) > 2 else None
bad = 0


def get(path):
    try:
        with urllib.request.urlopen(urllib.request.Request(base + path, headers={"User-Agent": "wwa-smoke"}), timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace"), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), e.headers
    except urllib.error.URLError as e:
        if "CERTIFICATE_VERIFY_FAILED" not in str(e):
            raise
        # Python's bundled CA list can lag behind (seen on Windows); curl uses the system store and still verifies the certificate.
        import subprocess
        p = subprocess.run(["curl", "-sS", "--max-time", "60", "-w", "\n%{http_code}", base + path], capture_output=True)
        body, _, code = p.stdout.rpartition(b"\n")
        return int(code or 0), body.decode("utf-8", "replace"), {}


def check(name, ok, extra=""):
    global bad
    print(("ok   " if ok else "FAIL ") + name + (" " + extra if extra else ""))
    bad += 0 if ok else 1


s, b, h = get("/api/health"); check("health", s == 200 and '"ok": true' in b)
s, b, h = get("/"); check("home page", s == 200 and "Precision, at home" in b, f"{len(b) // 1024} KB")
check("library hidden", 'id="library"' not in b)
s, b, h = get("/privacy"); check("privacy page", s == 200 and "Privacy" in b)
s, b, h = get("/l/"); check("generic splash", s == 200 and "window.LETTER=null" in b)
if code:
    s, b, h = get("/api/letter/" + code); d = json.loads(b) if s == 200 else {}
    check("letter code", s == 200 and d.get("address"), d.get("address", ""))
    s, b, h = get("/l/" + code); check("letter splash", s == 200 and "window.LETTER={" in b)
s, b, h = get("/api/letter/ZZZZZZ"); check("unknown code is 404", s == 404)
s, b, h = get("/api/lotcheck?address=" + urllib.request.quote("290 Joy Dr, Talent, OR 97540")); d = json.loads(b) if s == 200 else {}
check("live lot check", s == 200 and d.get("ok") and d.get("fit"), (d.get("verdict") or {}).get("headline", ""))
s, b, h = get("/index.html.bak"); check("no stray files", s == 404)
print("\n" + ("all good" if not bad else f"{bad} problem(s)"))
sys.exit(1 if bad else 0)
