# Deploying Getnera on a VPS

| Address | What | Served from |
|---|---|---|
| getnera.in | Landing page (`/login` redirects to the app) | `/var/www/getnera/landing` |
| app.getnera.in | Customer panel | `/var/www/getnera/app` |
| admin.getnera.in | Admin panel | `/var/www/getnera/admin` |
| api.getnera.in | Node API, socket.io, Meta webhooks | pm2 `getnera-api` on 127.0.0.1:3601 |
| media.getnera.in | Encrypted chat media (signed links only) | pm2 `getnera-media` on 127.0.0.1:3700 |

The VPS (82.25.85.114) is shared with other client sites. Port 3600 belongs to the old
`leados-api`. Never remove other nginx sites, never run `ufw enable/reset`, never `pm2 delete all`.

Assumes Ubuntu 22.04/24.04 and a sudo user.

## 1. DNS

At the domain registrar, add A records pointing at the VPS IP:
`@`, `www`, `app`, `admin`, `api`, `media`.
Check with `ping app.getnera.in` before running certbot.

## 2. Packages (once)

```bash
sudo apt update && sudo apt install -y nginx git rsync curl certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

## 3. Code (once)

```bash
sudo mkdir -p /opt/getnera && sudo chown $USER /opt/getnera
git clone https://github.com/BM-ACADEMY/nera-sass.git /opt/getnera
cd /opt/getnera && git checkout main
```
The repo is private: use a GitHub deploy key or a personal access token when git asks.

## 4. server/.env (once)

Copy the local `server/.env` to `/opt/getnera/server/.env` (scp, never through git or chat), then change:

```
NODE_ENV=production
PORT=3601
PORTAL_URL=https://app.getnera.in
ADMIN_PANEL_URL=https://admin.getnera.in
API_BASE_URL=https://api.getnera.in
PUBLIC_API_URL=https://api.getnera.in
MFA_ENFORCED=true
```

Also point every OAuth callback at the new domain (`GOOGLE_CALLBACK_URL`, `GOOGLE_REDIRECT_URI`,
`GOOGLE_CALLBACK_LOCALSEOBRIDGE`, `GOOGLE_CALLBACK_GSCINTEL`, `LINKEDIN_REDIRECT_URI`,
`META_CONTENT_OS_REDIRECT_URI`) and register the same URLs in Google / LinkedIn / Meta consoles.

Keep `TOKEN_ENCRYPTION_KEY` exactly as it is now: stored WhatsApp tokens are encrypted with it.
Keep `JWT_SECRET` too, unless you want everyone logged out.

MongoDB: if Mongo runs on this same VPS use `127.0.0.1` in `MONGODB_URI` and keep port 27017
closed to the internet. If it is another server, allow only this VPS's IP on 27017.

```bash
chmod 600 /opt/getnera/server/.env
```

## 5. nginx + HTTPS (once)

```bash
sudo cp /opt/getnera/deploy/nginx/getnera.conf /etc/nginx/sites-available/getnera
sudo ln -sf /etc/nginx/sites-available/getnera /etc/nginx/sites-enabled/getnera
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d getnera.in -d www.getnera.in -d app.getnera.in -d admin.getnera.in -d api.getnera.in -d media.getnera.in
```
Choose "redirect" when certbot asks, so http goes to https.

## 6. Build and start

```bash
cd /opt/getnera && bash deploy/deploy.sh
pm2 startup   # run the command it prints, so the API starts after a reboot
```

## 7. Meta

In the Meta app dashboard, set the WhatsApp webhook callback URL to
`https://api.getnera.in/webhook/whatsapp` (same verify token as before).

## 8. Check

- https://getnera.in loads, and its Login button opens https://app.getnera.in/login
- https://app.getnera.in/login: customer login lands on /dashboard
- https://admin.getnera.in: admin login works, the Live badge turns green
- https://api.getnera.in/health answers
- `pm2 logs getnera-api` shows `[MongoDB] Connected`

## 9. Media server (media.getnera.in)

Chat files (images, voice notes, videos, documents, sent and received) are stored
encrypted (AES-256-GCM, one key per workspace) in one folder per workspace:
`/var/lib/getnera-media/t_<tenant id>/<yyyy>/<mm>/<random>.nmf`, admin inbox files in
`platform/`. The browser only gets signed links that expire after 15 minutes.

```bash
sudo mkdir -p /var/lib/getnera-media && sudo chown $USER /var/lib/getnera-media && chmod 700 /var/lib/getnera-media
cd /opt/getnera/mediaserver && cp .env.example .env && node scripts/keygen.js
```
Put the three printed values into `mediaserver/.env`, then `chmod 600 mediaserver/.env`.
**Save `MEDIA_MASTER_KEY` in the password manager now.** Without it no stored file can be read.

Add to `server/.env` (same signing secret and internal key as above):
```
MEDIA_SERVER_URL=http://127.0.0.1:3700
MEDIA_PUBLIC_URL=https://media.getnera.in
MEDIA_SIGNING_SECRET=<same as mediaserver/.env>
MEDIA_INTERNAL_KEY=<same as mediaserver/.env>
```
Then `bash deploy/deploy.sh media && bash deploy/deploy.sh server`, and check that
`https://media.getnera.in/health` answers and `https://media.getnera.in/internal/files/t_1` gives 404.

Move the old `server/uploads/media/` files over (dry run first, then apply):
```bash
cd /opt/getnera/server
node scripts/migrate-media-to-mediaserver.js
node scripts/migrate-media-to-mediaserver.js --apply
```
Add `--delete-local` once you have checked old chats still show their files.

Backups: back up `/var/lib/getnera-media` like the database. The files are useless
without `MEDIA_MASTER_KEY`, so keep that key out of the same backup.

## Updating later

```bash
cd /opt/getnera && git pull
bash deploy/deploy.sh            # everything
bash deploy/deploy.sh server     # or one part: landing | app | admin | server | media
```
