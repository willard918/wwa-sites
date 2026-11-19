# Putting the site on pacificnestadu.com (staging)

The site is one Python process (`lotcheck/server.py`) that serves the pages and the lot-check API. HostGator shared hosting (where trilliumdesignbuild.com and willardwilliams.com live) cannot run it, and Squarespace cannot either, so it needs its own small host.

## Choose a host (you create the account; I can't)
- **Simplest: a small VPS** (about $5 to $6 a month at DigitalOcean, Hetzner, Vultr or Linode; Ubuntu). Full control, one fixed IP, works with the Caddyfile here.
- **Or a container host** (Fly.io, Render, Railway): use `deploy/Dockerfile`. Give it a persistent volume mounted at `/data`.

## On a VPS (Ubuntu)
1. Copy the `website` folder up (it needs `index.html`, `splash.html`, `privacy.html`, `lotcheck/`, `outreach/`; the other folders are not needed).
2. Copy `data/letters.json` to the server's data folder if the letters will be used (the splash page reads it).
3. `sudo apt install python3 caddy`
4. Create `/etc/wwa.env` from `deploy/env.example` (the values, one per line, no quotes). Set at least `WWA_BASE_URL=https://pacificnestadu.com`, `WWA_DATA=/var/lib/wwa`, `WWA_TRUST_PROXY=1`.
5. Run it as a service, `/etc/systemd/system/wwa.service`:
   ```
   [Unit]
   Description=WWA site
   After=network.target
   [Service]
   EnvironmentFile=/etc/wwa.env
   WorkingDirectory=/srv/website
   ExecStart=/usr/bin/python3 lotcheck/server.py --port 8787
   Restart=always
   User=www-data
   [Install]
   WantedBy=multi-user.target
   ```
   then `sudo mkdir -p /var/lib/wwa && sudo chown www-data /var/lib/wwa && sudo systemctl enable --now wwa`
6. Put `deploy/Caddyfile` at `/etc/caddy/Caddyfile` and `sudo systemctl reload caddy`. Caddy fetches the HTTPS certificate once DNS points at the server.

## DNS at name.com (pacificnestadu.com)
The domain now points at a parking page (91.195.240.94). In name.com > the domain > DNS records:
- change the **A record for the bare domain** (`@`) to the server's IP;
- change or add **`www`** as an A record to the same IP (delete any parking CNAME/ALIAS records on `@` and `www` first).
Nothing else needs to change. Leave the other eight domains alone. Changes usually take minutes, sometimes an hour.

## Check it
`python deploy/smoke.py https://pacificnestadu.com <a letter code>` prints ok/FAIL for each page and the live lot check.

## Before real traffic or email
- `WWA_POSTAL` set (a real street address or PO box). Email is refused without it.
- Sending: leave SMTP empty to keep emails in the outbox. To send, use a transactional provider and add SPF, DKIM and DMARC records for the sending domain at name.com. Send from a subdomain you own.
- Back up `/var/lib/wwa` (leads, events, suppression list, outbox).
- The privacy page is a plain-language draft: have it reviewed.
- Letters: the QR codes use `--base`. Do not print them until the base address is the one that serves the splash page: `python outreach/letters.py build --base https://pacificnestadu.com`.
