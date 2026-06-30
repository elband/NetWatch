# NetWatch — Panduan Deploy Produksi

Panduan langkah-demi-langkah men-deploy NetWatch ERP ke server produksi (Linux)
secara aman. Mengasumsikan Ubuntu 22.04+. Untuk HA/DR lanjutan lihat
[DISASTER-RECOVERY.md](DISASTER-RECOVERY.md).

> Ringkas: siapkan server → konfigurasi `.env` kuat → DB & Redis aman → build →
> PM2 → Nginx + TLS → backup terjadwal → verifikasi. Checklist akhir di bawah.

---

## 0. Prasyarat

| Komponen | Versi | Catatan |
|---|---|---|
| Node.js | 22.x LTS | `node -v` |
| MySQL | 8.x | |
| Redis | ≥ 6.2 | BullMQ menyarankan ≥6.2 |
| Nginx | stabil | reverse proxy + TLS |
| PM2 | terbaru | `npm i -g pm2` |
| Git | — | |

```bash
sudo apt update && sudo apt install -y nginx mysql-server redis-server git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm i -g pm2
```

---

## 1. Ambil kode

```bash
sudo mkdir -p /var/www && cd /var/www
sudo git clone https://github.com/elband/NetWatch.git netwatch
sudo chown -R $USER:$USER /var/www/netwatch
cd /var/www/netwatch
git checkout main      # atau rilis/tag yang disetujui
```

---

## 2. Database MySQL — user least-privilege

Jangan pakai root untuk aplikasi. Buat DB + user khusus:

```sql
sudo mysql
CREATE DATABASE netwatch_erp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'netwatch'@'127.0.0.1' IDENTIFIED BY 'GANTI_PASSWORD_KUAT';
GRANT SELECT, INSERT, UPDATE, DELETE ON netwatch_erp.* TO 'netwatch'@'127.0.0.1';
-- ALTER/CREATE/INDEX/DROP hanya untuk menjalankan migrasi (boleh dicabut setelahnya):
GRANT ALTER, CREATE, INDEX, DROP, REFERENCES ON netwatch_erp.* TO 'netwatch'@'127.0.0.1';
FLUSH PRIVILEGES; EXIT;
```

(Opsional, untuk PITR/replikasi — lihat DR runbook §3.2: aktifkan `log_bin`,
`binlog_format=ROW`.)

---

## 3. Redis — wajib di-amankan

Edit `/etc/redis/redis.conf`:

```conf
bind 127.0.0.1 ::1
requirepass GANTI_PASSWORD_REDIS_KUAT
```
```bash
sudo systemctl restart redis-server
redis-cli -a 'GANTI_PASSWORD_REDIS_KUAT' ping   # → PONG
```

---

## 4. Konfigurasi backend `.env`

```bash
cd /var/www/netwatch/backend
cp .env.example .env
# generate secret kuat:
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(48).toString('hex'))"
nano .env
```

Isi minimal untuk produksi (server **menolak boot** bila `JWT_SECRET` lemah/<32
char atau `DB_PASSWORD` kosong saat `NODE_ENV=production`):

```ini
NODE_ENV=production
PORT=4000
TZ=Asia/Makassar                 # zona server (WITA). Bisa diubah dari UI Pengaturan.

JWT_SECRET=<hasil-generate-48-byte-hex>
JWT_EXPIRES_IN=8h

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=netwatch
DB_PASSWORD=GANTI_PASSWORD_KUAT
DB_NAME=netwatch_erp
# DB_POOL_LIMIT=20

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=GANTI_PASSWORD_REDIS_KUAT
REDIS_TLS=false                  # true hanya bila Redis lintas-host via TLS

WAGATEWAY_API_KEY=<api-key-gateway-wa-internal>     # header X-API-Key, format wag_xxx.yyy
WAGATEWAY_BASE_URL=https://wg.aptpairport.id
WAGATEWAY_DEVICE_ID=                                # opsional; kosong = device default gateway
CORS_ORIGIN=https://netwatch.example.com   # WAJIB eksak (bukan *), karena cookie credentials

# Opsional:
# PING_INTERVAL_MS=15000
# WA_LOG_RETENTION_DAYS=90
# LOG_LEVEL=info
```

`.env` sudah di-`.gitignore` — jangan pernah commit. Batasi izin: `chmod 600 .env`.

---

## 5. Install dependency, migrasi, build

```bash
# Backend
cd /var/www/netwatch/backend
npm ci
mkdir -p uploads/{incidents,inspections,avatars,maps,documents,diklat,leave,activities,kegiatan,maintenance}
npm run migrate            # schema + kolom + 13 index (idempoten)

# Frontend (di-serve oleh Express saat NODE_ENV=production)
cd /var/www/netwatch/frontend
npm ci
npm run build              # → frontend/dist
```

---

## 6. Jalankan dengan PM2

```bash
cd /var/www/netwatch
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup                # ikuti perintah yang dicetak (auto-start saat reboot)
pm2 install pm2-logrotate  # WAJIB: rotasi log otomatis
```

Cek: `pm2 status`, `pm2 logs netwatch`. Health lokal: `curl localhost:4000/health` → `{"ok":true}`.

> Scaling (cluster) belum diaktifkan secara default — butuh `@socket.io/redis-adapter`
> lebih dulu. Lihat DR runbook §6.

---

## 7. Nginx + TLS

```bash
sudo cp /var/www/netwatch/nginx.conf.example /etc/nginx/sites-available/netwatch
sudo nano /etc/nginx/sites-available/netwatch    # ganti server_name & path uploads
sudo ln -s /etc/nginx/sites-available/netwatch /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# TLS gratis (Let's Encrypt):
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d netwatch.example.com
```

Template sudah memuat: redirect 80→443, TLS 1.2/1.3, **HSTS**, `X-Frame-Options`,
`X-Content-Type-Options`, `server_tokens off`, `client_max_body_size 20M`, dan
zona rate-limit login. (CSP tersedia di template — aktifkan setelah diuji di staging.)

---

## 8. Backup terjadwal + uji restore

```bash
# Backup harian 02:00 (script sudah ada di repo):
crontab -e
0 2 * * * /var/www/netwatch/backend/scripts/backup-mysql.sh >> /var/log/netwatch-backup.log 2>&1

# Uji restore (WAJIB, ke DB staging — bukan produksi):
/var/www/netwatch/backend/scripts/restore-mysql.sh /var/backups/netwatch/netwatch_<stamp>.sql.gz
```
Tambahkan salinan **off-site** (rclone/S3) — lihat DR runbook §3.3. Retensi
default 30 hari (lokal) via script; log WhatsApp auto-purge 90 hari (PDP).

---

## 9. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'     # 80 + 443
sudo ufw enable
```
Port **4000 (Node), 3306 (MySQL), 6379 (Redis) JANGAN diekspos** ke publik —
hanya diakses lokal via Nginx/loopback.

---

## 10. Verifikasi pasca-deploy

```bash
curl -I https://netwatch.example.com            # 200, ada Strict-Transport-Security & X-Frame-Options
curl https://netwatch.example.com/api/health    # {"ok":true}
```
- [ ] Login lewat browser berhasil; cookie sesi `netwatch_token` ber-flag `HttpOnly; Secure; SameSite=Strict`.
- [ ] Header keamanan tampil (HSTS, X-Frame-Options, X-Content-Type-Options).
- [ ] Pengaturan → **Waktu Server** menampilkan zona benar (WITA); ubah bila perlu.
- [ ] Pengaturan → **WhatsApp**: isi no. koordinator; uji notifikasi.
- [ ] Monitoring perangkat (ping) berjalan; SSH device hanya untuk role berwenang.
- [ ] `pm2 logs` bersih; rate-limit login aktif (coba salah berulang → 429).

---

## 11. Update rilis berikutnya

```bash
cd /var/www/netwatch && git pull
cd backend && npm ci && npm run migrate          # migrasi idempoten
cd ../frontend && npm ci && npm run build
pm2 reload netwatch                               # zero-downtime reload
```

---

## Checklist ringkas (production-ready)

- [ ] `.env`: `NODE_ENV=production`, `JWT_SECRET` acak ≥32, `DB_PASSWORD`, `REDIS_PASSWORD`, `CORS_ORIGIN` eksak, `WAGATEWAY_API_KEY`, `chmod 600`
- [ ] DB user least-privilege (bukan root); `npm run migrate` sukses
- [ ] Redis `requirepass` + `bind 127.0.0.1`
- [ ] `frontend/dist` ter-build; folder `uploads/*` ada & writable
- [ ] PM2 jalan + `pm2 save` + `pm2 startup` + `pm2-logrotate`
- [ ] Nginx TLS aktif (HSTS), redirect 80→443, port internal tertutup firewall
- [ ] Cron backup aktif + **restore diuji** + salinan off-site
- [ ] Verifikasi pasca-deploy (bagian 10) lulus

> CI (GitHub Actions, `.github/workflows/ci.yml`) menjalankan test + audit + build
> otomatis tiap push — pastikan hijau sebelum deploy.
