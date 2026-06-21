#!/usr/bin/env bash
# NetWatch — Restore MySQL dari file backup .sql.gz
# Pemakaian: ./restore-mysql.sh /var/backups/netwatch/netwatch_YYYYMMDD-HHMMSS.sql.gz
# PERINGATAN: menimpa database yang ada. Uji di staging dulu (restore drill rutin!).
set -euo pipefail

FILE="${1:-}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "Pemakaian: $0 <file.sql.gz>"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a; [ -f "${SCRIPT_DIR}/../.env" ] && . "${SCRIPT_DIR}/../.env"; set +a
DB_HOST="${DB_HOST:-127.0.0.1}"; DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-netwatch}"; DB_NAME="${DB_NAME:-netwatch_erp}"

read -r -p "Restore '$FILE' ke database '$DB_NAME'? Data saat ini akan ditimpa. Ketik 'YA': " ok
[ "$ok" = "YA" ] || { echo "Dibatalkan."; exit 1; }

echo "[$(date)] Restore mulai…"
gunzip -c "$FILE" | MYSQL_PWD="${DB_PASSWORD:-}" mysql \
  --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" "$DB_NAME"
echo "[$(date)] Restore selesai ke ${DB_NAME}."
