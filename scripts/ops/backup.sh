#!/usr/bin/env bash
# Consistent online backup of the HotelCost database (custom format, compressed).
# Usage: DATABASE_URL=postgresql://... scripts/ops/backup.sh [output-dir]
# Keeps the last $KEEP backups (default 14). The dump is taken in one snapshot,
# so ledger, balances and cost postings are always mutually consistent.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
OUT_DIR="${1:-./backups}"
KEEP="${KEEP:-14}"
mkdir -p "$OUT_DIR"
URL="${DATABASE_URL%%\?*}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/hotelcost_${STAMP}.dump"
pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$FILE" "$URL"
sha256sum "$FILE" > "$FILE.sha256"
echo "backup written: $FILE ($(du -h "$FILE" | cut -f1))"
ls -1t "$OUT_DIR"/hotelcost_*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old" "$old.sha256"; done
