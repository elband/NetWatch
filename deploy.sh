#!/usr/bin/env bash
# =============================================================================
# Deploy NetWatch ke server produksi — AMAN untuk data existing.
# Urutan: BACKUP DB (wajib sukses) → git pull → build frontend → install backend
#         → migrate (aditif/idempoten) → restart PM2.
# Migrasi TIDAK menghapus data bisnis; hanya menambah struktur & mengisi unit_id
# data lama ke unit ELB. Backup tetap dibuat sebagai jaring pengaman.
#
# Pakai:   bash deploy.sh          (dengan konfirmasi)
#          bash deploy.sh -y       (tanpa konfirmasi, untuk otomatisasi)
# Override: PM2_APP=netwatch BRANCH=main BACKUP_DIR=/var/backups bash deploy.sh
# =============================================================================
set -euo pipefail
cd "$(dirname "$0")"

PM2_APP="${PM2_APP:-}"                 # nama proses PM2 (kosong = pakai ecosystem.config.cjs)
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BRANCH="${BRANCH:-main}"

# --- Baca kredensial DB dari backend/.env ---
ENV_FILE="backend/.env"
[ -f "$ENV_FILE" ] || { echo "❌ $ENV_FILE tidak ditemukan. Buat dari backend/.env.example dulu."; exit 1; }
getenv() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed 's/^["'\'']//; s/["'\'']$//'; }
DB_HOST="$(getenv DB_HOST)";     DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="$(getenv DB_PORT)";     DB_PORT="${DB_PORT:-3306}"
DB_USER="$(getenv DB_USER)";     DB_USER="${DB_USER:-root}"
DB_PASSWORD="$(getenv DB_PASSWORD)"
DB_NAME="$(getenv DB_NAME)";     DB_NAME="${DB_NAME:-netwatch_erp}"

echo "▶ Deploy NetWatch  (branch=$BRANCH  db=$DB_NAME@$DB_HOST:$DB_PORT)"

if [ "${1:-}" != "-y" ]; then
  read -r -p "Lanjut deploy ke server ini? Backup DB dibuat lebih dulu. [y/N] " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || { echo "Dibatalkan."; exit 0; }
fi

# --- 1) BACKUP DB (deploy dibatalkan bila backup gagal/kosong) ---
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/netwatch-$(date +%F-%H%M%S).sql"
echo "▶ Backup database → $BACKUP_FILE"
MYSQL_PWD="$DB_PASSWORD" mysqldump -h "$DB_HOST" -P "$DB_PORT" -u "$DB_USER" \
  --single-transaction --quick --routines --triggers "$DB_NAME" > "$BACKUP_FILE"
[ -s "$BACKUP_FILE" ] || { echo "❌ Backup kosong/gagal — deploy DIBATALKAN."; rm -f "$BACKUP_FILE"; exit 1; }
gzip -f "$BACKUP_FILE"
echo "✔ Backup OK: ${BACKUP_FILE}.gz ($(du -h "${BACKUP_FILE}.gz" | cut -f1))"

# --- 2) Ambil kode terbaru (fast-forward saja; abort bila ada konflik lokal) ---
echo "▶ Mengambil kode ($BRANCH)"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

# --- 3) Build frontend + dependensi backend ---
echo "▶ Build frontend"
( cd frontend && npm install && npm run build )
echo "▶ Install dependensi backend"
( cd backend && npm install )

# --- 4) Migrasi DB (aditif & idempoten — aman diulang) ---
echo "▶ Migrasi database"
( cd backend && npm run migrate )
# CATATAN: JANGAN 'npm run seed' di produksi — itu menambah user demo ber-PIN lemah.

# --- 5) Restart aplikasi ---
echo "▶ Restart PM2"
if [ -n "$PM2_APP" ]; then pm2 restart "$PM2_APP" --update-env; else pm2 startOrReload ecosystem.config.cjs; fi
pm2 save || true

echo
echo "✅ Deploy selesai."
echo "   Verifikasi:      pm2 logs   dan buka aplikasi di browser."
echo "   Rollback DATA:   gunzip -c ${BACKUP_FILE}.gz | MYSQL_PWD=\$DB_PASSWORD mysql -h $DB_HOST -u $DB_USER $DB_NAME"
echo "   Rollback KODE:   git checkout <commit-sebelumnya> lalu jalankan ulang build + restart"
