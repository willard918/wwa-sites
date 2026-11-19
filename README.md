# WWA sites

Private repo for the Willard Williams Architect / Pacific Living Solutions site and the farm blog.

- `website/` prefab-ADU site (configurator, lot check, outreach letters). `python build.py` writes `index.html`; `python lotcheck/server.py` serves it on :8787. Deploy notes: `website/deploy/SERVER.md`, launch steps: `website/deploy/LAUNCH.md`. Stdlib Python 3.10+; letters need `pip install segno pymupdf` and Edge.
- `farm-blog/` static blog for willardwilliams.com. `python build.py`; see its README.

## Not in this repo (on purpose)
- `website/data/` (letters list with addresses, leads, outbox) and `website/migration/` (mirror of the old sites). They live on the T7 drive and on the VPS in `/var/lib/wwa`.
- The VPS login key `~/.ssh/wwa_vps`. Copy it to the laptop yourself; never commit it.

## Laptop setup
1. Clone, then `cd website && python build.py`.
2. For deploys copy the SSH key to `~/.ssh/wwa_vps` (see SERVER.md for the update command).
3. Archicad / Rhino / Grasshopper work stays in the main AI Toolkit folder on the T7 drive.
