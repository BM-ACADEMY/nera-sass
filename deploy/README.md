# Deploying Getnera on a VPS

| Address | What | Served from |
|---|---|---|
| getnera.in | Landing page (`/login` redirects to the app) | `/var/www/getnera/landing` |
| app.getnera.in | Customer panel | `/var/www/getnera/app` |
| admin.getnera.in | Admin panel | `/var/www/getnera/admin` |
| api.getnera.in | Node API, socket.io, Meta webhooks | pm2 `getnera-api` on 127.0.0.1:3600 |

Assumes Ubuntu 22.04/24.04 and a sudo user.

## 1. DNS

At the domain registrar, add A records pointing at the VPS IP:
`@`, `www`, `app`, `admin`, `api`.
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
PORT=3600
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
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d getnera.in -d www.getnera.in -d app.getnera.in -d admin.getnera.in -d api.getnera.in
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

## Updating later

```bash
cd /opt/getnera && git pull
bash deploy/deploy.sh            # everything
bash deploy/deploy.sh server     # or one part: landing | app | admin | server
```
