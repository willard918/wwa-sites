# Putting willardwilliams.com live (nothing here has been done)

Facts (2026-11-12): DNS is at HostGator (ns1949/ns1950.hostgator.com). `@` A record is 192.185.45.8. HostGator also hosts the WordPress site and the email. The VPS is 82.180.162.77 and already serves pacificnestadu.com.

1. **Save the old site.** In WordPress: Tools > Export (all content), and download the Media folder from HostGator cPanel > File Manager. Keep a copy of anything you want to move into the new blog.
2. **Note the email records.** HostGator cPanel > Zone Editor: screenshot or copy the MX, SPF (TXT) and any other records. Do not change them.
3. **Upload the site:** `python deploy.py --upload` (safe; the site is just stored on the server).
4. **Point the web address:** in Zone Editor, change only the `@` and `www` A/CNAME records to 82.180.162.77. Leave MX alone. Lower the TTL first if you can, so a mistake is easy to undo.
5. **Turn on HTTPS:** `python deploy.py --caddy` (validates the file, backs up the old one, reloads). Caddy fetches the certificate once DNS has propagated.
6. **Check** https://willardwilliams.com and https://www.willardwilliams.com. To undo: set the `@` record back to 192.185.45.8.

Do not cancel HostGator: it holds your email.
