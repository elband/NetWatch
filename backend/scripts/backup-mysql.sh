#!/usr/bin/env bash
# NetWatch — Backup MySQL harian (jalankan via cron).
# Cron contoh (tiap hari 02:00):
#   0 2 * * * /var/www/netwatch/backend/scripts/backup-mysql.sh >> /var/log/netwatch-backup.log 2>&1
#
# Variabel dibaca dari backend/.env (DB_*). Hasil: backup terkompresi + retensi 30 hari.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env"
BACKUP_DIR="${NETWATCH_BACKUP_DIR:-/var/backups/netwatch}"
RETENTION_DAYS="${NETWATCH_BACKUP_RETENTION:-30}"

# Muat kredensial dari .env (tanpa mengekspor ke proses lain).
set -a; [ -f "$ENV_FILE" ] && . "$ENV_FILE"; set +a
DB_HOST="${DB_HOST:-127.0.0.1}"; DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-netwatch}"; DB_NAME="${DB_NAME:-netwatch_erp}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR}/netwatch_${STAMP}.sql.gz"

echo "[$(date)] Mulai backup ${DB_NAME} → ${OUT}"
MYSQL_PWD="${DB_PASSWORD:-}" mysqldump \
  --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
  --single-transaction --quick --routines --triggers --events \
  "$DB_NAME" | gzip -9 > "$OUT"

# Verifikasi file tidak kosong.
[ -s "$OUT" ] || { echo "[ERROR] Backup kosong/gagal!"; exit 1; }

# Retensi: hapus backup lebih tua dari N hari.
find "$BACKUP_DIR" -name 'netwatch_*.sql.gz' -mtime +"$RETENTION_DAYS" -delete

echo "[$(date)] Backup selesai: $(du -h "$OUT" | cut -f1)"
# TODO produksi: salin ke off-site/object storage (rclone/aws s3 cp) untuk DR.
