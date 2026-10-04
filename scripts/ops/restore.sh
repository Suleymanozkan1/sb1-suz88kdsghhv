#!/usr/bin/env bash
# Restores a backup into a target database (created if missing). Refuses to overwrite a
# non-empty database unless FORCE=1. After restoring, run `npm run ops:verify-restore`.
# Usage: TARGET_URL=postgresql://.../hotelcost_restore scripts/ops/restore.sh backups/hotelcost_X.dump
set -euo pipefail
FILE="${1:?backup file required}"
: "${TARGET_URL:?TARGET_URL is required}"
URL="${TARGET_URL%%\?*}"
if [ -f "$FILE.sha256" ]; then sha256sum --check --status "$FILE.sha256" || { echo "checksum mismatch: $FILE" >&2; exit 1; }; fi
DB="${URL##*/}"
ADMIN="${URL%/*}/postgres"
psql "$ADMIN" -tAc "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1 || psql "$ADMIN" -c "CREATE DATABASE \"$DB\""
TABLES="$(psql "$URL" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
if [ "$TABLES" != "0" ] && [ "${FORCE:-0}" != "1" ]; then echo "target $DB is not empty ($TABLES tables); set FORCE=1 to replace it" >&2; exit 1; fi
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --single-transaction --dbname="$URL" "$FILE"
echo "restored $FILE into $DB"
