"""Weekly campaign and lead report, read straight from the live server.

    python weekly_report.py            # last 7 days  -> website/reports/YYYY-MM-DD.md (also printed)
    python weekly_report.py --days 30

Pulls (read-only, over ssh with the VPS key) /var/lib/wwa/events.jsonl, leads.jsonl, letters.json and the notify folder.
It never sends anything. Contact-form messages are in notify/*-contact-*.txt; they are listed in full so a person can reply.
"""
import argparse
import json
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HOST = "root@82.180.162.77"
KEY = str(Path.home() / ".ssh" / "wwa_vps")


def ssh(cmd, timeout=60):
    r = subprocess.run(["ssh", "-i", KEY, "-o", "BatchMode=yes", HOST, cmd], capture_output=True, text=True, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:200] or "ssh failed")
    return r.stdout


def jsonl(text):
    out = []
    for line in text.splitlines():
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    a = ap.parse_args()
    since = datetime.now(timezone.utc) - timedelta(days=a.days)
    iso = since.strftime("%Y-%m-%dT%H:%M:%SZ")
    events = jsonl(ssh("cat /var/lib/wwa/events.jsonl 2>/dev/null || true"))
    leads = jsonl(ssh("cat /var/lib/wwa/leads.jsonl 2>/dev/null || true"))
    letters = json.loads(ssh("cat /var/lib/wwa/letters.json", timeout=120) or "{}")
    notes = ssh("ls -1 /var/lib/wwa/notify 2>/dev/null | tail -200 || true").split()
    recent_notes = [n for n in notes if n[:8] >= since.strftime("%Y%m%d")]

    ev = [e for e in events if e.get("ts", "") >= iso]
    opens = [e for e in ev if e.get("kind") == "letter_open" and e.get("known")]
    codes = Counter(e["code"] for e in opens)
    first_ever = {}
    for e in events:
        if e.get("kind") == "letter_open" and e.get("known"):
            first_ever.setdefault(e["code"], e.get("ts", ""))
    new_codes = [c for c in codes if first_ever.get(c, "") >= iso]
    lines = [f"# Campaign report, {datetime.now().strftime('%Y-%m-%d')} (last {a.days} days)", ""]
    batches = Counter(v.get("batch") for v in letters.values())
    lines.append(f"Letters on file: {len(letters)} ({', '.join(f'{b}: {n}' for b, n in batches.most_common())}). **Only the batch that was actually mailed counts for response rates; mailing dates are not recorded here, so ask the owner which batch went out.**")
    lines.append("")
    lines.append(f"- Letter page opens: {len(opens)} from {len(codes)} different letters ({len(new_codes)} scanned for the first time)")
    lines.append(f"- Lead emails left on the site: {sum(1 for x in leads if x.get('ts', '') >= iso)}")
    lines.append(f"- Contact-form messages / lead alerts in the notify folder this week: {len(recent_notes)}")
    lines.append(f"- Unsubscribes: {sum(1 for e in ev if e.get('kind') == 'unsubscribe')}; send problems: {sum(1 for e in ev if e.get('kind') in ('send_failed', 'send_blocked'))}")
    lines.append("")
    if codes:
        lines.append("## Letters opened (warmest first)")
        for c, n in codes.most_common(25):
            v = letters.get(c, {})
            lines.append(f"- {c}: {v.get('address', '?')}, {v.get('city', '')} - {(v.get('best') or {}).get('model', 'no unit')}, opened {n}x ({v.get('batch')})")
        lines.append("")
    if recent_notes:
        lines.append("## Messages and alerts to answer")
        for n in recent_notes[-20:]:
            try:
                body = ssh(f"cat /var/lib/wwa/notify/{n}", timeout=30)
            except RuntimeError as e:
                body = f"(could not read: {e})"
            lines.append(f"### {n}")
            lines.append(body.strip()[:1500])
            lines.append("")
    lines.append("## Notes")
    lines.append("- Visits that never scanned or left an email are not counted (no analytics installed yet).")
    out = ROOT / "reports"
    out.mkdir(exist_ok=True)
    f = out / (datetime.now().strftime("%Y-%m-%d") + ".md")
    f.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    print("\nwrote", f)


if __name__ == "__main__":
    sys.exit(main())
