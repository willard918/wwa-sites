# The server (set up 2026-11-11)

- **Host:** Hostinger VPS KVM 1, Ubuntu 24.04, IP **82.180.162.77**, hostname srv2151450. Renews at $11.99/mo (24-month prepaid term).
- **Login:** `ssh -i ~/.ssh/wwa_vps root@82.180.162.77`. Key only; password logins are off (`/etc/ssh/sshd_config.d/00-wwa.conf`). The private key is `C:\Users\willa\.ssh\wwa_vps` (no passphrase). Hostinger's browser terminal is the fallback.
- **Security:** ufw allows 22, 80, 443 only; fail2ban on; unattended upgrades on (Ubuntu default).
- **Service:** `wwa.service` runs `lotcheck/server.py` as user `wwa` on 127.0.0.1:8787 from `/srv/website`; settings in `/etc/wwa.env`; data (leads, events, suppression list, outbox, letters.json) in `/var/lib/wwa`. Caddy (Ubuntu package, 2.6.2) proxies port 80.
- **Live (2026-11-11):** name.com A records for `@` and `www` point at 82.180.162.77 (TTL 300). Caddy uses `deploy/Caddyfile`, fetched the HTTPS certificates itself, and http redirects to https. https://pacificnestadu.com passes `deploy/smoke.py`.
- **Not set:** `WWA_POSTAL`, SMTP (email stays in the outbox).

## Update the site after a rebuild
```
cd website && python build.py
tar czf - --exclude=__pycache__ index.html splash.html privacy.html lotcheck outreach | ssh -i ~/.ssh/wwa_vps root@82.180.162.77 'tar xzf - -C /srv/website && chown -R wwa:wwa /srv/website && systemctl restart wwa'
python deploy/smoke.py http://82.180.162.77 <a letter code>
```
Letters file: `scp -i ~/.ssh/wwa_vps data/letters.json root@82.180.162.77:/var/lib/wwa/ && ssh -i ~/.ssh/wwa_vps root@82.180.162.77 chown wwa:wwa /var/lib/wwa/letters.json`.

## Read what happened
`ssh ... 'journalctl -u wwa -n 50'` for the service log; `ssh ... 'cd /srv/website/outreach && WWA_DATA=/var/lib/wwa python3 report.py'` for the campaign report; `/var/lib/wwa/notify/` holds the lead alerts.
