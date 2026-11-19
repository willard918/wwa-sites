"""What the campaign is doing: python report.py
Reads data/leads.jsonl, data/events.jsonl, data/letters.json. Prints a summary and writes data/leads.csv."""
import csv
import json
import sys
from collections import Counter
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"


def rows(name):
    f = DATA / name
    if not f.exists():
        return []
    out = []
    for line in f.read_text(encoding="utf-8").splitlines():
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out


def main():
    leads, events = rows("leads.jsonl"), rows("events.jsonl")
    leads = [x for x in leads if not x["email"].endswith("@example.com")]   # test submissions use the reserved example.com
    try:
        letters = json.loads((DATA / "letters.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        letters = {}
    opened = {e.get("code") for e in events if e.get("kind") == "letter_open" and e.get("known")}
    clicks = [e for e in events if e.get("kind") == "email_click"]
    whens = Counter(e.get("when") for e in clicks if e.get("when"))
    from_letter = [x for x in leads if isinstance(x.get("extra"), dict) and x["extra"].get("code")]
    print(f"Letters in the batch: {len(letters)}")
    print(f"  opened the splash page (distinct codes): {len(opened)}" + (f"  ({100 * len(opened) / len(letters):.1f}%)" if letters else ""))
    print(f"  left an email from a letter: {len(from_letter)}")
    print(f"Leads: {len(leads)} (emails sent: {sum(1 for x in leads if x.get('sent'))}, held in outbox: {sum(1 for x in leads if not x.get('sent'))})")
    print(f"Email clicks: {len(clicks)}; timeline answers: {dict(whens) or 'none'}")
    print(f"Unsubscribes: {sum(1 for e in events if e.get('kind') == 'unsubscribe')}; send problems: {sum(1 for e in events if e.get('kind') in ('send_failed', 'send_blocked'))}")
    if leads:
        with open(DATA / "leads.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["time", "email", "design", "address", "lot_check", "source", "letter_code", "sent"])
            for x in leads:
                w.writerow([x["ts"], x["email"], x["unit"], x.get("address") or "", x.get("lot") or "", x["source"], (x.get("extra") or {}).get("code", ""), x["sent"]])
        print("wrote", DATA / "leads.csv")


if __name__ == "__main__":
    sys.exit(main())
