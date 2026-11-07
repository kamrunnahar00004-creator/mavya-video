#!/usr/bin/env bash
# Runs scripts/browser/editor-browser-checks.mjs against a credential-free local copy of the app (WSL + Windows
# Chrome, the founder's setup): copies the repo without .env files, seeds a local store and four tiny test clips,
# starts `next dev` on :3210 with accounts off, then drives Windows Chrome with Windows node. Never touches production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
WIN_TMP="$(wslpath "$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')")/mavya-browser-checks"
trap 'kill "${SERVER:-0}" 2>/dev/null || true; rm -rf "$WORK"' EXIT
cd "$ROOT" && git ls-files -co --exclude-standard | grep -v '^\.env' | grep -v '^\.data/' | tar -cf - -T - | tar -xf - -C "$WORK"
ln -s "$ROOT/node_modules" "$WORK/node_modules"
# Turbopack resolves the symlinked node_modules only with the root at /.
sed -i 's|  turbopack: {|  turbopack: {\n    root: "/",|' "$WORK/next.config.ts"
FF="$ROOT/node_modules/ffmpeg-static/ffmpeg"
mkdir -p "$WORK/.data/media"
n=1; for c in red green blue orange; do
  "$FF" -v error -y -f lavfi -i "color=$c:s=360x640:r=30:d=3" -f lavfi -i "sine=d=3" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$WORK/.data/media/11111111-aaaa-4aaa-8aaa-00000000000$n.mp4"; n=$((n+1)); done
cat > "$WORK/.data/db.json" <<'JSON'
{"references":[],"assets":[],"runs":[{"id":"dddddddd-4444-4444-8444-444444444444","title":"Browser checks","createdAt":"2026-11-07T00:00:00Z","updatedAt":"2026-11-07T00:00:00Z","sourceRefId":null,"hook":{"mode":"upload","text":"Hook line","clip":{"mediaId":"11111111-aaaa-4aaa-8aaa-000000000001.mp4","name":"red","kind":"video","offset":0,"length":3},"start":0,"end":3,"avatarIndex":null,"variationIndex":null},"demo":{"clip":null,"frame":"none"},"texts":[],"project":null}]}
JSON
(cd "$WORK" && env -i HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin:$(dirname "$(command -v node)")" npx next dev -p 3210 > "$WORK/dev.log" 2>&1) &
SERVER=$!
for i in $(seq 1 180); do curl -s -o /dev/null -w '%{http_code}' http://localhost:3210/studio | grep -q 200 && break; sleep 1; done
mkdir -p "$WIN_TMP" && cp "$ROOT/scripts/browser/editor-browser-checks.mjs" "$WIN_TMP/"
(cd "$WIN_TMP" && cmd.exe /c "node editor-browser-checks.mjs")
