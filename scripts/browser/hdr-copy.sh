#!/usr/bin/env bash
# iPhone HDR uploads in real Windows Chrome (founder 2026-11-11: "it had the perfect color and while editing the color
# just bursted"). Before its copies exist the editor plays the HDR original, which Chrome tone-maps itself; after a
# refresh it plays the server's copy. Both must look the same. Makes an iPhone-like HLG clip (scripts/hdr-fixture.mjs),
# makes its copies with the server's own commands (render.mjs previewRuns) and its thumbnail (thumbs.ts thumbArgs),
# shows the original and both copies side by side in Chrome, and fails when a copy is more than 14 levels from what
# Chrome shows for the original. Prints Chrome's colours for the original: when Chrome changes how it shows HDR, put
# them in BANDS.chrome in scripts/hdr-fixture.mjs. Never touches production. Usage: bash scripts/browser/hdr-copy.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FF="$ROOT/node_modules/ffmpeg-static/ffmpeg"
WIN="$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')"
# A folder of its own per run, so two runs never delete each other's files (Codex 2026-11-11).
NAME="mavya-hdr-copy-$$-$RANDOM"
LAB="$(wslpath "$WIN")/$NAME"
trap 'rm -rf "$LAB"' EXIT
mkdir -p "$LAB"
cp "$ROOT/scripts/browser/hdr-copy/run.mjs" "$LAB/"
node --input-type=module -e '
import { makeHlgClip } from "'"$ROOT"'/scripts/hdr-fixture.mjs";
import { previewRuns } from "'"$ROOT"'/render/render.mjs";
import { execFileSync } from "node:child_process";
const [ff, lab] = process.argv.slice(1);
makeHlgClip(ff, `${lab}/original.mov`);
for (const args of previewRuns(`${lab}/original.mov`, `${lab}/p480.mp4`, `${lab}/v1080.mp4`, true)) execFileSync(ff, args, { stdio: "ignore" });
' "$FF" "$LAB"
# The bands are horizontal and fill the frame, so each box is the whole picture squeezed to 120x213.
cat > "$LAB/lab.html" <<'HTML'
<!doctype html><body style="margin:0;background:#f0f">
<video src="original.mov" muted style="position:absolute;left:0;top:0;width:120px;height:213px;object-fit:fill"></video>
<video src="p480.mp4" muted style="position:absolute;left:150px;top:0;width:120px;height:213px;object-fit:fill"></video>
<video src="v1080.mp4" muted style="position:absolute;left:300px;top:0;width:120px;height:213px;object-fit:fill"></video>
<script>window.ready=Promise.all([...document.querySelectorAll("video")].map(v=>new Promise((r,j)=>{v.onerror=j;const go=()=>{v.currentTime=0.5;v.onseeked=r};v.readyState>=2?go():v.onloadeddata=go})));</script>
</body>
HTML
(cd "$LAB" && node.exe "$WIN\\$NAME\\run.mjs")
for i in 0 1 2; do "$FF" -v error -y -i "$LAB/shot.png" -vf "crop=120:213:$((i * 150)):0" "$LAB/box$i.png"; done
node --input-type=module -e '
import { BANDS, bandColours } from "'"$ROOT"'/scripts/hdr-fixture.mjs";
const [ff, lab] = process.argv.slice(1);
const [orig, p480, v1080] = [0, 1, 2].map((i) => bandColours(ff, `${lab}/box${i}.png`));
console.log("Chrome shows the HDR original as:", JSON.stringify(orig));
let bad = 0;
// A page that never drew (blank or one colour) must not pass: grey and white bands of the original must differ.
if (Math.abs(orig[1][0] - orig[0][0]) < 60) { console.error("FAIL the original did not draw:", JSON.stringify(orig)); process.exit(1); }
for (const [name, copy] of [["editor copy (p480)", p480], ["export copy (v1080)", v1080]]) BANDS.forEach((b, i) => {
  const off = Math.max(...copy[i].map((c, k) => Math.abs(c - orig[i][k])));
  const line = `${name}, ${b.name}: ${copy[i].join(" ")} vs original ${orig[i].join(" ")} (off by ${off})`;
  if (off > 14) { bad++; console.error("FAIL", line); } else console.log("ok  ", line);
});
if (bad) process.exit(1);
console.log("hdr-copy: the copies look like the original in Chrome");
' "$FF" "$LAB"
