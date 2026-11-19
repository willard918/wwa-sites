# Farm blog (willardwilliams.com)

Static blog/vlog. No dependencies beyond Python.

- Write posts as `posts/YYYY-MM-DD-slug.md` (front matter: title, date, category, summary).
- Categories: animals, garden, build, land (edit in `site.json`).
- Embed a YouTube video with `{{youtube VIDEOID}}` on its own line.
- `python build.py` builds `public/`; `--no-drafts` skips files with `-draft-` in the name.
- Preview: `python -m http.server 8802 --directory public`.

## Going live (not done yet)
willardwilliams.com DNS is at HostGator (ns1949/ns1950.hostgator.com), A record 192.185.45.8, and HostGator also holds the email. To publish: change only the `@` and `www` A records to 82.180.162.77 in HostGator's DNS zone (leave MX alone), add a `willardwilliams.com` block to `website/deploy/Caddyfile` serving `/srv/farm`, then copy `public/` to the VPS. The existing WordPress site stops being served once the A record moves, so export it first.
