# Launch: willardwilliamsarchitect.com (prepared 2026-11-19)

Done: pricing hidden (quote button, mailto with the configuration), Studio section carries the architecture services, footer note rewritten, deployed to https://pacificnestadu.com (smoke test passes). Library stays off (other architects' plans).

## Switch day (needs the owner's go-ahead)
1. name.com > willardwilliamsarchitect.com > DNS. Screenshot/note the current records (rollback = put them back).
2. Change only `@` A and `www` (currently 198.185.165.162, SiteFLEX) to **82.180.162.77**. Leave MX, `mail`, TXT and everything else alone (mail is at 192.185.45.8, HostGator).
3. Put the second block of `deploy/Caddyfile` on the server (`/etc/caddy/Caddyfile`, backup at `Caddyfile.bak-2026-11-19`), `systemctl reload caddy`; Caddy fetches the certificates.
4. `python deploy/smoke.py https://willardwilliamsarchitect.com`; send a test email to willardw@ and reply from it.
5. Rollback: restore the two A records to 198.185.165.162.

## After
- Keep SiteFLEX 2-4 weeks, read the agreement for cancellation/export terms, then cancel.
- Replace placeholder pricing with real Pacific Wall / Trillium numbers, then re-enable the price panel.
- Real project photos for a portfolio (the old site's gallery looks like template filler; mirrored images may belong to SiteFLEX).
- Set WWA_POSTAL and SMTP before any email sending; review the privacy page.
- Phase 2: pacificlivingsolutions.com, willardwilliams.com (HostGator, export WordPress first).
