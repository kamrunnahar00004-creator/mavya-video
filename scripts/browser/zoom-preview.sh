#!/usr/bin/env bash
# Keyframed zoom in the preview, in real Windows Chrome (founder 2026-11-11: "in the preview there is the wobble").
# A still picture in a 258x459 box like the editor's phone, zoomed 0 -> 32 % with the app's own videoStyle() at every
# frame, captured at 1x and 2x screen density, measured against a perfect float zoom. Before the fix it drifted
# 0.54 px per frame; after it 0.13 (1x) / 0.09 (2x); perfect is 0.06. Fails above 0.25 px. Never touches production.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FF="$ROOT/node_modules/ffmpeg-static/ffmpeg"
WIN="$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')"
LAB="$(wslpath "$WIN")/mavya-zoom-preview"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT" "$LAB"' EXIT
rm -rf "$LAB" && mkdir -p "$LAB"
cp "$ROOT/scripts/browser/zoom-preview/lab.html" "$ROOT/scripts/browser/zoom-preview/run.mjs" "$LAB/"
"$FF" -v error -y -f lavfi -i "testsrc2=s=1080x1920:r=30:d=0.04" -frames:v 1 -vf "drawgrid=w=40:h=40:t=2:c=white@0.6" "$OUT/still.png"
"$FF" -v error -y -loop 1 -i "$OUT/still.png" -t 1 -r 30 -vf "scale=480:854,format=yuv420p" -c:v libx264 -crf 14 "$LAB/still480.mp4"
# The app's own transform for every frame (src/lib/adjust.ts videoStyle).
(cd "$ROOT" && node -e '
const {load}=require("./scripts/check-module.cjs"); const a=load("src/lib/adjust.ts",{react:{}});
const look={zoom:0,panX:0,panY:0,keys:[{t:0.3,zoom:0,panX:0,panY:0},{t:2.3,zoom:32,panX:0,panY:0}]};
console.log("window.APP="+JSON.stringify(Array.from({length:90},(_,n)=>a.videoStyle(look,n/30)?.transform??""))+";");') > "$LAB/app.js"
for dpr in 1 2; do (cd "$LAB" && node.exe "$WIN\\mavya-zoom-preview\\run.mjs" "$dpr" app,exact > /dev/null); done
fail=0
for dpr in 1 2; do
  w=$((258 * dpr)); h=$((458 * dpr))
  node "$ROOT/scripts/browser/zoom-preview/ideal.mjs" "$FF" "$LAB/shots-$dpr-exact/000.png" "$OUT/ideal.mp4" "$w" "$h"
  "$FF" -v error -y -framerate 30 -i "$LAB/shots-$dpr-app/%03d.png" -vf "scale=$w:$h,format=gray" -c:v libx264 -crf 0 "$OUT/app.mp4"
  for v in ideal app; do node "$ROOT/scripts/browser/zoom-preview/motion.mjs" "$FF" "$OUT/$v.mp4" "$w" "$h" > "$OUT/$v.json"; done
  node "$ROOT/scripts/browser/zoom-preview/report.cjs" "$OUT/ideal.json" 0.25 9 "perfect zoom, ${dpr}x" || true
  node "$ROOT/scripts/browser/zoom-preview/report.cjs" "$OUT/app.json" 0.25 1.2 "Mavya preview, ${dpr}x" || fail=1
done
[ "$fail" = 0 ] && echo "zoom-preview: smooth" || { echo "zoom-preview: the preview zoom wobbles"; exit 1; }
