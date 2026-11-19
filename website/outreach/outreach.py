"""Outreach backend (stdlib only): the "keep this design" tease email, click tracking, and letter-code lookup for the splash page.

Nothing is sent unless SMTP is configured (WWA_SMTP_HOST, WWA_SMTP_PORT, WWA_SMTP_USER, WWA_SMTP_PASS). Every email is ALWAYS written to
data/outbox/<stamp>-<token>.eml (a complete RFC 822 message with the render inline) plus a .html preview, so it can be reviewed or sent by hand.

Environment:
  WWA_BASE_URL   public address of the site, used in email links (default http://127.0.0.1:8787)
  WWA_FROM       From header
  WWA_POSTAL     street / PO box line for the footer (CAN-SPAM needs a valid postal address): real sending is REFUSED until this is set
  WWA_NOTIFY     where new-lead alerts go (default: the From address); sent only when SMTP is configured, always written to data/notify/
"""
import base64
import hashlib
import html
import json
import os
import re
import secrets
import smtplib
import ssl
import time
import urllib.parse
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ["WWA_DATA"]) if os.environ.get("WWA_DATA") else ROOT / "data"   # point WWA_DATA at a persistent volume when deployed
OUTBOX = DATA / "outbox"
LEADS = DATA / "leads.jsonl"
EVENTS = DATA / "events.jsonl"
LETTERS = DATA / "letters.json"
SUPPRESS = DATA / "suppress.txt"   # one lowercase email per line: never email these again
SALT = "wwa-outreach"  # only used to hash IPs so repeat visitors can be counted without storing addresses

EMAIL_RE = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")
CODE_RE = re.compile(r"^[A-HJ-NP-Z2-9]{6}$")  # letter codes: no 0/O/1/I
SOURCES = {"library", "configurator", "splash", "lotcheck"}


def base_url():
    return os.environ.get("WWA_BASE_URL", "http://127.0.0.1:8787").rstrip("/")


def sender():
    return os.environ.get("WWA_FROM", "Willard Williams Architect <willardw@willardwilliamsarchitect.com>")


def postal():
    return os.environ.get("WWA_POSTAL", "Willard Williams Architect, Phoenix, OR 97535")


def postal_set():
    return bool(os.environ.get("WWA_POSTAL"))


def is_suppressed(email):
    try:
        return email.strip().lower() in {x.strip().lower() for x in SUPPRESS.read_text(encoding="utf-8").splitlines() if x.strip()}
    except OSError:
        return False


def suppress(email):
    DATA.mkdir(exist_ok=True)
    if not is_suppressed(email):
        with open(SUPPRESS, "a", encoding="utf-8") as f:
            f.write(email.strip().lower() + "\n")


def unsubscribe(token, ip=""):
    """/u/<token>: put the lead's email on the suppression list. -> True if the token was known."""
    if not re.match(r"^[A-Za-z0-9_-]{6,16}$", token or ""):
        return False
    lead = next((x for x in reversed(_read_jsonl(LEADS)) if x.get("token") == token), None)
    if not lead:
        return False
    suppress(lead["email"])
    log_event("unsubscribe", ip, token=token)
    return True


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _append(path, obj):
    DATA.mkdir(exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def _ip_hash(ip):
    return hashlib.sha256((SALT + str(ip)).encode()).hexdigest()[:12]


def _read_jsonl(path):
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return out


def log_event(kind, ip="", **kw):
    _append(EVENTS, dict(ts=_now(), kind=kind, ip=_ip_hash(ip), **kw))


# ----------------------------------------------------------------------------- email
E = html.escape


def pretty_addr(a):
    """Census returns '1013 AZURE WAY, PHOENIX, OR, 97535': make it '1013 Azure Way, Phoenix, OR 97535'."""
    parts = [x.strip() for x in str(a).split(",")]
    parts = [x.upper() if re.fullmatch(r"[A-Za-z]{2}", x) else x.title() for x in parts]
    if len(parts) >= 4 and re.fullmatch(r"[A-Z]{2}", parts[-2]) and re.match(r"^\d{5}", parts[-1]):
        parts = parts[:-2] + [parts[-2] + " " + parts[-1]]
    return ", ".join(parts)


def lot_summary(res):
    """A short, safe summary of a lotcheck() result for the email."""
    if not res or not res.get("ok"):
        return None
    f, v, p = res.get("fit"), res.get("verdict") or {}, res.get("parcel")
    return {"address": pretty_addr(res["match"]["address"]), "headline": v.get("headline", ""), "status": v.get("status", ""),
            "lot_sf": p.get("area_sf") if p else None,
            "fits": [{"model": r["model"], "size": r["size_ft"], "fits": r["fits"], "margin": r["margin_ft"]} for r in (f["results"] if f else [])]}


def _fit_lines(lot):
    rows = []
    for r in lot["fits"]:
        rows.append((f"{r['model']}, {r['size'][0]} x {r['size'][1]} ft", f"fits, about {r['margin']} ft to spare" if r["fits"] else "does not fit"))
    return rows


def render_email(unit, lot, token, cid):
    """-> (subject, html, text). `unit`: {id, name, sf, beds, stories, kind, source}."""
    name, base = unit["name"], base_url()
    go = f"{base}/e/{token}"
    stor = "storey" if unit.get("stories") == 1 else "storeys"
    sub = f"{unit.get('kind', '')} · {unit.get('sf', '')} sq ft · {unit.get('stories', 1)} {stor}".strip(" ·")
    subject = f"{name}, at dusk"
    pre = "Saved for you: the design, how it sits on a lot, and what happens next."
    if lot:
        rows = _fit_lines(lot)
        lot_html = (f'<p style="margin:0 0 6px;font:11px/1.4 Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#8f897b">On your lot</p>'
                    f'<p style="margin:0 0 14px;font:300 24px/1.2 Georgia,serif;color:#f1ece1">{E(lot["address"])}</p>'
                    f'<p style="margin:0 0 14px;color:#cfc8b8">{E(lot["headline"])}</p>'
                    + "".join(f'<table role="presentation" width="100%" style="border-top:1px solid #26231d"><tr><td style="padding:9px 0;color:#cfc8b8">{E(a)}</td>'
                              f'<td align="right" style="padding:9px 0;color:{"#a5d0ae" if "fits," in b else "#8f897b"}">{E(b)}</td></tr></table>' for a, b in rows)
                    + '<p style="margin:12px 0 0;font-size:12px;color:#7a7467">A first look from public parcel data with assumed setbacks. It is not a zoning determination; we confirm with your city or county.</p>')
        lot_text = f"ON YOUR LOT: {lot['address']}\n{lot['headline']}\n" + "\n".join(f"  {a}: {b}" for a, b in rows) + "\n(Assumed setbacks, not a zoning determination.)\n\n"
    else:
        lot_html = (f'<p style="margin:0 0 6px;font:11px/1.4 Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#8f897b">Will it fit?</p>'
                    f'<p style="margin:0;color:#cfc8b8">Reply with your property address, or <a href="{E(base)}/" style="color:#f1ece1">check it on the site</a>. '
                    f'We look at the parcel, the state rules and the setbacks, and tell you which sizes fit.</p>')
        lot_text = f"WILL IT FIT? Reply with your property address, or check it at {base}/\n\n"
    steps = [("We check your lot by hand", "Parcel, zoning, setbacks, utilities. No charge, no obligation."),
             ("You choose a design", "Start from this one or any other in the library. Roof, finish and layout are yours."),
             ("It is built in a factory, then set on site", "Wall panels are made indoors to the drawings. Your site gets the foundation, utilities and the set.")]
    steps_html = "".join(f'<tr><td valign="top" style="padding:0 14px 14px 0;font:300 26px/1 Georgia,serif;color:#c8553a">{i + 1}</td>'
                         f'<td style="padding:0 0 14px"><b style="font-weight:500;color:#f1ece1">{E(a)}</b><br><span style="color:#a9a291">{E(b)}</span></td></tr>' for i, (a, b) in enumerate(steps))
    when = "".join(f'<a href="{go}?when={k}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 14px;border:1px solid #4a463c;color:#f1ece1;text-decoration:none;font-size:13px">{E(t)}</a>'
                   for k, t in [("now", "Within a year"), ("later", "In a year or two"), ("looking", "Just looking")])
    credit = f'<p style="margin:0 0 20px;font-size:12px;color:#7a7467">Redrawn from the published plans: {E(unit.get("source", ""))}. A reference design, not a Pacific Living Solutions model.</p>' if unit.get("source") else ""
    hero = (f'<tr><td><a href="{go}"><img src="cid:{cid}" width="600" alt="{E(name)} at dusk" style="display:block;width:100%;height:auto;border:0"></a></td></tr>' if cid else "")
    h = f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{E(subject)}</title></head>
<body style="margin:0;background:#0b0a08"><span style="display:none;max-height:0;overflow:hidden;opacity:0">{E(pre)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0a08"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;font:300 16px/1.6 Arial,Helvetica,sans-serif;color:#cfc8b8">
<tr><td style="padding:0 0 18px;font:400 11px/1 Arial,sans-serif;letter-spacing:.22em;text-transform:uppercase;color:#f1ece1">Willard Williams Architect</td></tr>
{hero}
<tr><td style="padding:30px 0 6px"><h1 style="margin:0;font:300 40px/1.05 Georgia,serif;color:#f1ece1;letter-spacing:-.01em">{E(name)}</h1>
<p style="margin:8px 0 0;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#8f897b">{E(sub)}</p></td></tr>
<tr><td style="padding:18px 0 6px"><p style="margin:0 0 14px">You were looking at this one, so we kept it for you. Come back to it any time: you can walk around it, read the plan, and change the light from dusk to day.</p>{credit}</td></tr>
<tr><td style="padding:0 0 26px"><a href="{go}" style="display:inline-block;background:#f1ece1;color:#0b0a08;padding:15px 26px;font:500 12px/1 Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;text-decoration:none">Look at it again</a></td></tr>
<tr><td style="padding:24px 0;border-top:1px solid #26231d">{lot_html}</td></tr>
<tr><td style="padding:24px 0 8px;border-top:1px solid #26231d"><p style="margin:0 0 16px;font:11px/1.4 Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#8f897b">What happens next</p>
<table role="presentation" cellpadding="0" cellspacing="0">{steps_html}</table></td></tr>
<tr><td style="padding:14px 0 18px;border-top:1px solid #26231d"><p style="margin:0 0 10px;font:11px/1.4 Arial,sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#8f897b">When are you thinking of building?</p>{when}
<p style="margin:6px 0 0;font-size:13px;color:#7a7467">One tap tells us how much to say and when. Or just reply to this email: it comes to a person.</p></td></tr>
<tr><td style="padding:22px 0 0;border-top:1px solid #26231d;font-size:12px;line-height:1.6;color:#6f6a5e">You are getting this one email because you asked us to send this design. We will not add you to a list.
<a href="{base}/u/{token}" style="color:#8f897b">Unsubscribe</a> or reply "stop". <a href="{base}/privacy" style="color:#8f897b">Privacy</a>. {E(postal())}. Construction: Trillium Design Build Company, Oregon CCB #257175. Estimates and fit results are planning figures, not quotes or zoning determinations.</td></tr>
</table></td></tr></table></body></html>"""
    t = (f"{name}\n{sub}\n\nYou were looking at this one, so we kept it for you.\nLook at it again: {go}\n\n" + lot_text +
         "WHAT HAPPENS NEXT\n" + "\n".join(f"{i + 1}. {a}: {b}" for i, (a, b) in enumerate(steps)) +
         f"\n\nWhen are you thinking of building? Within a year: {go}?when=now | In a year or two: {go}?when=later | Just looking: {go}?when=looking\n"
         f"Or reply to this email: it comes to a person.\n\n--\nYou are getting this one email because you asked us to send this design. Unsubscribe: {base}/u/{token} (or reply \"stop\"). Privacy: {base}/privacy\n{postal()}\nConstruction: Trillium Design Build Company, Oregon CCB #257175\n")
    return subject, h, t


def _send_smtp(msg):
    host = os.environ.get("WWA_SMTP_HOST")
    if not host:
        return False
    port = int(os.environ.get("WWA_SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=30) as s:
        s.starttls(context=ssl.create_default_context())
        if os.environ.get("WWA_SMTP_USER"):
            s.login(os.environ["WWA_SMTP_USER"], os.environ.get("WWA_SMTP_PASS", ""))
        s.send_message(msg)
    return True


def handle_tease(p, ip, lotcheck_fn):
    """Validate the POST body, log the lead, write the email to the outbox, send it when SMTP is configured. -> (status, json)."""
    if not isinstance(p, dict):
        return 400, {"ok": False, "error": "Bad request."}
    if p.get("website"):  # honeypot: a human never fills this
        return 200, {"ok": True, "sent": False}
    email = str(p.get("email", "")).strip()
    if not EMAIL_RE.match(email) or len(email) > 254:
        return 400, {"ok": False, "error": "That email address doesn't look right."}
    if p.get("consent") is not True:
        return 400, {"ok": False, "error": "Please tick the box so we know you want the email."}
    u = p.get("unit") or {}
    unit = {"id": str(u.get("id", ""))[:40], "name": str(u.get("name", ""))[:80], "sf": u.get("sf"), "beds": u.get("beds"), "stories": u.get("stories") or 1,
            "kind": str(u.get("kind", ""))[:40], "source": str(u.get("source", ""))[:160]}
    if not unit["id"] or not unit["name"]:
        return 400, {"ok": False, "error": "Choose a design first."}
    if not isinstance(unit["sf"], (int, float)):
        unit["sf"] = ""
    if is_suppressed(email):   # they asked us to stop: say nothing, do nothing
        return 200, {"ok": True, "sent": False}
    src = p.get("source") if p.get("source") in SOURCES else "library"
    token = secrets.token_urlsafe(8)
    recent = [x for x in _read_jsonl(LEADS)[-300:] if x.get("email") == email.lower() and x.get("unit_id") == unit["id"] and time.time() - x.get("t", 0) < 600]
    if recent:  # double click or a retry: don't write twice
        return 200, {"ok": True, "sent": recent[-1].get("sent", False)}
    lot = None
    addr = str(p.get("address", "")).strip()[:200]
    if addr:
        try:
            lot = lot_summary(lotcheck_fn(addr))
        except Exception:
            lot = None
    img = None
    m = re.match(r"^data:image/jpeg;base64,([A-Za-z0-9+/=]+)$", str(p.get("image", "")))
    if m and len(m.group(1)) < 2_500_000:
        try:
            b = base64.b64decode(m.group(1))
            img = b if b[:2] == b"\xff\xd8" else None
        except ValueError:
            img = None
    cid = make_msgid(domain="wwa.local")[1:-1] if img else None
    subject, h, t = render_email(unit, lot, token, cid)
    msg = EmailMessage()
    msg["Subject"], msg["From"], msg["To"], msg["Date"], msg["Message-ID"] = subject, sender(), email, formatdate(localtime=False), make_msgid()
    msg["Reply-To"] = sender()
    msg["List-Unsubscribe"] = f"<{base_url()}/u/{token}>, <mailto:{sender().split('<')[-1].rstrip('>')}?subject=stop>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    msg.set_content(t)
    msg.add_alternative(h, subtype="html")
    if img:
        msg.get_payload()[1].add_related(img, "image", "jpeg", cid="<" + cid + ">", filename="dusk.jpg")
    OUTBOX.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    (OUTBOX / f"{stamp}-{token}.eml").write_bytes(bytes(msg))
    prev = h.replace(f"cid:{cid}", f"{stamp}-{token}.jpg") if img else h
    (OUTBOX / f"{stamp}-{token}.html").write_text(prev, encoding="utf-8")
    if img:
        (OUTBOX / f"{stamp}-{token}.jpg").write_bytes(img)
    sent = False
    if os.environ.get("WWA_SMTP_HOST") and not postal_set():
        log_event("send_blocked", ip, token=token, why="WWA_POSTAL not set")   # a commercial email needs a real postal address in the footer
    else:
        try:
            sent = _send_smtp(msg)
        except Exception as e:
            log_event("send_failed", ip, token=token, err=str(e)[:100])
    _append(LEADS, {"ts": _now(), "t": time.time(), "token": token, "email": email.lower(), "source": src, "unit_id": unit["id"], "unit": unit["name"],
                    "address": addr or None, "lot": lot["headline"] if lot else None, "sent": sent, "ip": _ip_hash(ip), "extra": p.get("extra") if isinstance(p.get("extra"), dict) else None})
    notify_owner(token, email, unit, addr, lot, src, p.get("extra"))
    return 200, {"ok": True, "sent": sent}


def notify_owner(token, email, unit, addr, lot, src, extra):
    """Tell the studio a lead arrived: always a text file in data/notify, and an email when SMTP is configured."""
    code = (extra or {}).get("code") if isinstance(extra, dict) else None
    body = (f"New lead from the site\n\nEmail: {email}\nDesign: {unit['name']} ({unit['id']})\nSource: {src}" + (f"\nLetter code: {code}" if code else "") +
            (f"\nAddress: {addr}\nLot check: {lot['headline']}" if lot else (f"\nAddress: {addr}" if addr else "")) +
            f"\nToken: {token}\n\nThe email they were sent is in data/outbox. They have not been added to any list.\n")
    d = DATA / "notify"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{token}.txt").write_text(body, encoding="utf-8")
    if os.environ.get("WWA_SMTP_HOST"):
        try:
            m = EmailMessage()
            m["Subject"], m["From"], m["To"] = f"New lead: {unit['name']}" + (f", {addr}" if addr else ""), sender(), os.environ.get("WWA_NOTIFY", sender())
            m.set_content(body)
            _send_smtp(m)
        except Exception as e:
            log_event("notify_failed", "", token=token, err=str(e)[:100])


def track(token, params, ip):
    """/e/<token>[?when=now|later|looking] -> where to send the reader. Logs the click."""
    if not re.match(r"^[A-Za-z0-9_-]{6,16}$", token or ""):
        return base_url() + "/"
    lead = next((x for x in reversed(_read_jsonl(LEADS)) if x.get("token") == token), None)
    when = (params.get("when") or [""])[0]
    log_event("email_click", ip, token=token, when=when if when in ("now", "later", "looking") else None)
    if not lead:
        return base_url() + "/"
    uid = lead["unit_id"]
    return base_url() + ("/#configure" if uid.startswith("PL ") else "/#u=" + urllib.parse.quote(uid))


# ----------------------------------------------------------------------------- letters
def load_letters():
    try:
        return json.loads(LETTERS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def letter_public(code):
    """What the splash page may show for a code: the site address and the stored lot result. No owner data exists in the store."""
    if not CODE_RE.match(code or ""):
        return None
    r = load_letters().get(code)
    if not r:
        return None
    return {"code": code, "address": r["address"], "city": r.get("city"), "state": r.get("state"), "zip": r.get("zip"), "lot": r.get("lot"),
            "best": r.get("best"), "verdict": r.get("verdict"), "sf": r.get("lot_sf"), "area": r.get("area")}
