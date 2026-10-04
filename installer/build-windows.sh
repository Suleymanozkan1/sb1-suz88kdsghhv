#!/usr/bin/env bash
# Builds the Windows installer (HotelCost-Setup-<version>.exe) on Linux.
#   TARGET=windows (default) → dist/HotelCost-Setup-<version>.exe (needs makensis)
#   TARGET=linux             → dist/linux/HotelCost (same layout with Linux binaries, used to test setup)
# Bundles: Next.js standalone server, Node.js 22 runtime, PostgreSQL 16 (embedded build), WinSW service wrapper.
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${TARGET:-windows}"
VERSION="$(node -p "require('./package.json').version")"
NODE_VERSION="${NODE_VERSION:-22.22.0}"
PG_VERSION="${PG_VERSION:-16.14.0-beta.17}"
CACHE="${CACHE:-$HOME/.cache/hotelcost-installer}"
OUT="dist/$TARGET/HotelCost"
mkdir -p "$CACHE" dist
rm -rf "$OUT" && mkdir -p "$OUT/app" "$OUT/node" "$OUT/pgsql"

echo "▶ web application (standalone)"
NEXT_OUTPUT=standalone npx next build >/dev/null
cp -r .next/standalone/. "$OUT/app/"
mkdir -p "$OUT/app/.next" && cp -r .next/static "$OUT/app/.next/static"
[ -d public ] && cp -r public "$OUT/app/public"
mkdir -p "$OUT/app/assets" && cp -r assets/fonts "$OUT/app/assets/fonts"
mkdir -p "$OUT/app/prisma" && cp -r prisma/migrations "$OUT/app/prisma/migrations" && cp prisma/schema.prisma "$OUT/app/prisma/"
# Prisma client with every bundled engine (Windows + Linux)
rm -rf "$OUT/app/node_modules/.prisma" && cp -r node_modules/.prisma "$OUT/app/node_modules/.prisma"
mkdir -p "$OUT/app/node_modules/@prisma" && rm -rf "$OUT/app/node_modules/@prisma/client" && cp -r node_modules/@prisma/client "$OUT/app/node_modules/@prisma/client"
# runtime modules used by setup (PostgreSQL driver) and the demo loader
for m in pg pg-pool pg-protocol pg-types pg-connection-string pg-int8 pgpass postgres-array postgres-bytea postgres-date postgres-interval split2 xtend bcryptjs exceljs jszip; do
  [ -d "node_modules/$m" ] && rm -rf "$OUT/app/node_modules/$m" && cp -r "node_modules/$m" "$OUT/app/node_modules/$m"
done

echo "▶ setup program"
npx esbuild installer/setup.ts --bundle --platform=node --target=node22 --format=cjs --external:@prisma/client --external:.prisma/client --external:next --external:react --external:react-dom --external:pdfkit --external:pg-native --alias:@=./src --outfile="$OUT/app/setup.cjs" --log-level=error
cp installer/files/*.cmd "$OUT/" 2>/dev/null || true
cp installer/files/README.txt "$OUT/README.txt"
cp LICENSE "$OUT/LICENSE.txt" 2>/dev/null || true

echo "▶ PostgreSQL $PG_VERSION ($TARGET)"
PKG="@embedded-postgres/$([ "$TARGET" = windows ] && echo windows-x64 || echo linux-x64)@$PG_VERSION"
TGZ="$CACHE/$(echo "$PKG" | tr '/@' '__').tgz"
[ -f "$TGZ" ] || (cd "$CACHE" && npm pack -q "$PKG" >/dev/null && mv embedded-postgres-*.tgz "$TGZ")
tar xzf "$TGZ" -C "$CACHE" && cp -r "$CACHE/package/native/." "$OUT/pgsql/" && rm -rf "$CACHE/package"
if [ "$TARGET" != windows ]; then
  # linux build ships a .txz archive inside native/
  for x in "$OUT"/pgsql/*.txz; do [ -f "$x" ] && tar xJf "$x" -C "$OUT/pgsql" && rm "$x"; done
  chmod +x "$OUT"/pgsql/bin/* 2>/dev/null || true
  # restore the soname links (libfoo.so.60 → libfoo.so.60.2) the archive does not carry
  (cd "$OUT/pgsql/lib" && for f in *.so.*.*; do [ -e "$f" ] || continue; l="${f%.*}"; [ -e "$l" ] || ln -s "$f" "$l"; done)
fi

echo "▶ Node.js $NODE_VERSION ($TARGET)"
if [ "$TARGET" = windows ]; then
  ZIP="$CACHE/node-v$NODE_VERSION-win-x64.zip"
  [ -f "$ZIP" ] || curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip" -o "$ZIP"
  unzip -q -j -o "$ZIP" "node-v$NODE_VERSION-win-x64/node.exe" "node-v$NODE_VERSION-win-x64/LICENSE" -d "$OUT/node"
  echo "▶ WinSW service wrapper"
  WSW="$CACHE/node-windows.tgz"
  [ -f "$WSW" ] || (cd "$CACHE" && npm pack -q node-windows@1.0.0-beta.8 >/dev/null && mv node-windows-*.tgz "$WSW")
  tar xzf "$WSW" -C "$CACHE" package/bin/winsw/winsw.exe && cp "$CACHE/package/bin/winsw/winsw.exe" "$OUT/HotelCostServer.exe" && rm -rf "$CACHE/package"
  echo "▶ installer"
  makensis -V2 -DVERSION="$VERSION" -DSRC="$PWD/$OUT" -DOUTFILE="$PWD/dist/HotelCost-Setup-$VERSION.exe" installer/hotelcost.nsi
  ls -lh "dist/HotelCost-Setup-$VERSION.exe"
else
  ln -sf "$(command -v node)" "$OUT/node/node"
  echo "linux test layout ready: $OUT"
fi
