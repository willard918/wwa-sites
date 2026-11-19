"""Publish farm-blog/public to the VPS. Dry run by default: prints what it would do.
  python deploy.py            show the plan
  python deploy.py --upload   build and copy the site to /srv/farm (does NOT change Caddy or DNS)
  python deploy.py --caddy    install deploy/Caddyfile on the server, validate, reload (do this only after DNS points here)
Server details: website/deploy/SERVER.md.  Key: ~/.ssh/wwa_vps
"""
import subprocess, sys
from pathlib import Path

HERE = Path(__file__).parent
BLOG = HERE.parent
KEY = str(Path.home() / ".ssh" / "wwa_vps")
HOST = "root@82.180.162.77"
SSH = ["ssh", "-i", KEY, HOST]


def run(cmd, **kw):
    print("+", " ".join(cmd) if isinstance(cmd, list) else cmd)
    return subprocess.run(cmd, check=True, **kw)


def main():
    go_up, go_caddy = "--upload" in sys.argv, "--caddy" in sys.argv
    if not (go_up or go_caddy):
        print(__doc__)
        print("Plan: build -> tar public/ -> ssh -> /srv/farm (owner caddy-readable); then --caddy reloads Caddy.")
        return
    if go_up:
        run([sys.executable, str(BLOG / "build.py"), "--no-drafts"], cwd=BLOG)
        tar = subprocess.Popen(["tar", "czf", "-", "-C", str(BLOG / "public"), "."], stdout=subprocess.PIPE)
        remote = "mkdir -p /srv/farm && tar xzf - -C /srv/farm && chmod -R a+rX /srv/farm"
        subprocess.run(SSH + [remote], stdin=tar.stdout, check=True)
        tar.wait()
        print("Uploaded to /srv/farm. Not live until DNS + --caddy.")
    if go_caddy:
        run(["scp", "-i", KEY, str(HERE / "Caddyfile"), f"{HOST}:/tmp/Caddyfile.new"])
        run(SSH + ["caddy validate --config /tmp/Caddyfile.new && cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak && cp /tmp/Caddyfile.new /etc/caddy/Caddyfile && systemctl reload caddy"])
        print("Caddy reloaded. Check https://willardwilliams.com")


if __name__ == "__main__":
    main()
