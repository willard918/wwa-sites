"""Static blog builder. stdlib only.  python build.py  ->  public/

Posts: posts/*.md with a front-matter block (title, date, category, summary,
optional image).  In the body, `{{youtube ID}}` on its own line embeds a video.
Files whose name starts with `draft-` after the date are skipped with --no-drafts.
"""
import html, json, re, shutil, sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).parent
OUT = ROOT / "public"
SITE = json.loads((ROOT / "site.json").read_text(encoding="utf-8"))
E = html.escape


def inline(s):
    s = E(s, quote=False)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"\*([^*]+)\*", r"<em>\1</em>", s)
    s = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", r'<img src="\2" alt="\1" loading="lazy">', s)
    s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
    return s


def md(text):
    out, para, lst = [], [], None

    def flush():
        nonlocal para, lst
        if para:
            out.append("<p>" + inline(" ".join(para)) + "</p>")
            para = []
        if lst:
            out.append(f"<{lst[0]}>" + "".join(f"<li>{inline(i)}</li>" for i in lst[1]) + f"</{lst[0]}>")
            lst = None

    for line in text.splitlines():
        m = re.match(r"\{\{youtube ([\w-]{6,20})\}\}\s*$", line.strip())
        if m:
            flush()
            out.append(
                '<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/%s" '
                'title="Video" loading="lazy" allowfullscreen></iframe></div>' % m.group(1))
        elif re.match(r"#{2,3} ", line):
            flush()
            n = len(line.split()[0])
            out.append(f"<h{n}>{inline(line[n+1:])}</h{n}>")
        elif line.startswith("> "):
            flush()
            out.append(f"<blockquote>{inline(line[2:])}</blockquote>")
        elif re.match(r"[-*] ", line):
            if not lst or lst[0] != "ul":
                flush(); lst = ("ul", [])
            lst[1].append(line[2:])
        elif re.match(r"\d+\. ", line):
            if not lst or lst[0] != "ol":
                flush(); lst = ("ol", [])
            lst[1].append(re.sub(r"^\d+\. ", "", line))
        elif not line.strip():
            flush()
        else:
            para.append(line.strip())
    flush()
    return "\n".join(out)


def load_posts(drafts):
    posts = []
    for f in sorted((ROOT / "posts").glob("*.md")):
        raw = f.read_text(encoding="utf-8")
        m = re.match(r"---\n(.*?)\n---\n(.*)", raw, re.S)
        if not m:
            print("skip (no front matter):", f.name); continue
        meta = dict(l.split(":", 1) for l in m.group(1).splitlines() if ":" in l)
        meta = {k.strip(): v.strip() for k, v in meta.items()}
        if not drafts and "-draft-" in f.name:
            continue
        date = datetime.strptime(meta["date"], "%Y-%m-%d")
        slug = re.sub(r"^\d{4}-\d{2}-\d{2}-", "", f.stem)
        words = len(m.group(2).split())
        posts.append(dict(meta, slug=slug, dt=date, body=md(m.group(2)),
                          mins=max(1, round(words / 220)), cat=meta.get("category", "land")))
    return sorted(posts, key=lambda p: p["dt"], reverse=True)


CSS = """
:root{--bg:#f6f1e7;--ink:#2b2a26;--mute:#6f6a5e;--card:#fffdf8;--line:#e2dac8;--accent:#4f6b3a;--accent2:#b5651d}
@media(prefers-color-scheme:dark){:root{--bg:#1d1f1a;--ink:#ece7da;--mute:#a39e90;--card:#262922;--line:#3a3d33;--accent:#9bbf7a;--accent2:#e0a060}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.7 Georgia,'Times New Roman',serif}
a{color:var(--accent)}img,iframe{max-width:100%}.wrap{max-width:760px;margin:0 auto;padding:0 16px}
header.site{border-bottom:1px solid var(--line);padding:18px 0}header.site .wrap{display:flex;flex-wrap:wrap;gap:12px 28px;align-items:baseline;justify-content:space-between}
header.site a.brand{font-size:1.35rem;font-weight:700;color:var(--ink);text-decoration:none;letter-spacing:.01em}
nav a{margin-right:16px;font:600 .8rem/1 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:var(--mute);text-decoration:none}nav a:hover{color:var(--accent)}
.hero{padding:56px 0 28px}.hero h1{font-size:2.3rem;line-height:1.2;margin:0 0 10px}.hero p{color:var(--mute);margin:0;font-size:1.1rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:20px 22px;margin:18px 0}
.card h2{margin:4px 0 6px;font-size:1.4rem;line-height:1.3}.card h2 a{color:var(--ink);text-decoration:none}.card h2 a:hover{color:var(--accent)}
.meta{font:600 .75rem/1.4 system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;color:var(--mute)}.meta .cat{color:var(--accent2)}
article h1{font-size:2.1rem;line-height:1.25;margin:40px 0 6px}article h2{margin-top:2em}article blockquote{margin:1.4em 0;padding:2px 18px;border-left:4px solid var(--accent2);color:var(--mute)}
code{background:var(--card);border:1px solid var(--line);padding:1px 5px;border-radius:4px;font-size:.88em}
.video{position:relative;aspect-ratio:16/9;margin:1.6em 0}.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:10px}
footer{border-top:1px solid var(--line);margin-top:60px;padding:26px 0 40px;color:var(--mute);font:.85rem/1.6 system-ui,sans-serif}
"""


def page(title, body, path="", desc=None, extra_head=""):
    desc = desc or SITE["tagline"]
    nav = "".join(f'<a href="/category/{k}/">{v}</a>' for k, v in SITE["categories"].items())
    full = title if title == SITE["name"] else f"{title} | {SITE['name']}"
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{E(full)}</title>
<meta name="description" content="{E(desc)}"><link rel="canonical" href="{SITE['base']}{path}">
<link rel="alternate" type="application/rss+xml" title="{E(SITE['name'])}" href="/feed.xml">
<meta property="og:title" content="{E(full)}"><meta property="og:description" content="{E(desc)}"><meta property="og:type" content="website">
<style>{CSS}</style>{extra_head}</head><body>
<header class="site"><div class="wrap"><a class="brand" href="/">{E(SITE['name'])}</a><nav>{nav}<a href="/about/">About</a></nav></div></header>
<main class="wrap">{body}</main>
<footer><div class="wrap">&copy; {datetime.now().year} {E(SITE['name'])} &middot; <a href="/feed.xml">RSS</a></div></footer>
</body></html>"""


def card(p):
    date = f'{p["dt"]:%B} {p["dt"].day}, {p["dt"].year}'
    return (f'<div class="card"><div class="meta"><span class="cat">{E(SITE["categories"].get(p["cat"], p["cat"]))}</span>'
            f' &middot; {date}' +
            f'</div><h2><a href="/posts/{p["slug"]}/">{E(p["title"])}</a></h2><div>{E(p.get("summary",""))}</div></div>')


def write(rel, content):
    f = OUT / rel
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(content, encoding="utf-8")


def main():
    drafts = "--no-drafts" not in sys.argv
    posts = load_posts(drafts)
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    if (ROOT / "static").exists():
        shutil.copytree(ROOT / "static", OUT / "static")

    hero = f'<section class="hero"><h1>{E(SITE["tagline"])}</h1><p>Notes and videos from the farm.</p></section>'
    write("index.html", page(SITE["name"], hero + "".join(card(p) for p in posts[:12]), "/"))

    for p in posts:
        date = f'{p["dt"]:%B} {p["dt"].day}, {p["dt"].year}'
        body = (f'<article><div class="meta"><span class="cat">{E(SITE["categories"].get(p["cat"], p["cat"]))}</span> &middot; {date} &middot; {p["mins"]} min read</div>'
                f'<h1>{E(p["title"])}</h1>{p["body"]}</article>')
        write(f'posts/{p["slug"]}/index.html', page(p["title"], body, f'/posts/{p["slug"]}/', p.get("summary")))

    for k, label in SITE["categories"].items():
        sel = [p for p in posts if p["cat"] == k]
        body = f'<section class="hero"><h1>{E(label)}</h1></section>' + ("".join(card(p) for p in sel) or "<p>Nothing here yet.</p>")
        write(f"category/{k}/index.html", page(label, body, f"/category/{k}/"))

    about = ROOT / "about.md"
    write("about/index.html", page("About", f'<article><h1>About</h1>{md(about.read_text(encoding="utf-8")) if about.exists() else "<p>Coming soon.</p>"}</article>', "/about/"))

    items = "".join(
        f'<item><title>{E(p["title"])}</title><link>{SITE["base"]}/posts/{p["slug"]}/</link>'
        f'<guid>{SITE["base"]}/posts/{p["slug"]}/</guid><pubDate>{p["dt"]:%a, %d %b %Y 08:00:00 +0000}</pubDate>'
        f'<description>{E(p.get("summary",""))}</description></item>' for p in posts[:30])
    write("feed.xml", f'<?xml version="1.0"?><rss version="2.0"><channel><title>{E(SITE["name"])}</title>'
                      f'<link>{SITE["base"]}/</link><description>{E(SITE["tagline"])}</description>{items}</channel></rss>')
    urls = ["/"] + [f'/posts/{p["slug"]}/' for p in posts] + [f"/category/{k}/" for k in SITE["categories"]] + ["/about/"]
    write("sitemap.xml", '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
          "".join(f'<url><loc>{SITE["base"]}{u}</loc></url>' for u in urls) + "</urlset>")
    write("404.html", page("Page not found", '<section class="hero"><h1>Page not found</h1><p><a href="/">Back to the farm</a></p></section>', "/404.html"))
    write("robots.txt", f"User-agent: *\nAllow: /\nSitemap: {SITE['base']}/sitemap.xml\n")
    print(f"built {len(posts)} posts -> {OUT}")


if __name__ == "__main__":
    main()
