#!/usr/bin/env bash
# Upload copies made in the browser (founder 2026-11-23), in real Windows Chrome. Bundles src/lib/browser-copies.ts,
# runs it on: an H.264 SDR clip with sound (landscape, 60 fps), an iPhone-like HLG HDR clip (must be left to the
# server), and any real clips given as arguments (e.g. 4K iPhone HEVC .MOV files). Checks each copy against what the
# render server makes from the same clip (render.mjs previewArgs): size, codec, frame rate, key frames, sound, length,
# and the picture (PSNR). Prints how long the browser took. Never touches production.
# Usage: bash scripts/browser/copies.sh [clip.mov ...]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FF="$ROOT/node_modules/ffmpeg-static/ffmpeg"
WIN="$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')"
NAME="mavya-copies-$$-$RANDOM"
LAB="$(wslpath "$WIN")/$NAME"
trap '[ -n "${KEEP_DIR:-}" ] && cp -r "$LAB/out" "$KEEP_DIR"; rm -rf "$LAB"' EXIT
mkdir -p "$LAB/out"
cp "$ROOT/scripts/browser/copies/run.mjs" "$LAB/"
# The module as the app ships it, mediabunny included.
npx --yes esbuild@0.24.0 "$ROOT/src/lib/browser-copies.ts" --bundle --format=esm --outfile="$LAB/copies.js" --log-level=error
# Fixtures.
"$FF" -v error -y -f lavfi -i "testsrc2=size=1920x1080:rate=30" -f lavfi -i "sine=frequency=440:sample_rate=48000" -t 4 -vf gblur=sigma=3 -c:v libx264 -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 -c:a aac -shortest "$LAB/sdr.mp4"
# No colour tags (some screen recorders): left to the server, which keeps its colours as they are.
"$FF" -v error -y -f lavfi -i "testsrc2=size=1920x1080:rate=30" -t 2 -c:v libx264 -pix_fmt yuv420p "$LAB/untagged.mp4"
# 60 fps: checked for the 30 fps cap and sizes only (dropping every other frame of a test pattern that changes every
# frame can pick the other frame of each pair than ffmpeg does, which a picture comparison would call a mismatch).
"$FF" -v error -y -f lavfi -i "testsrc2=size=1080x1920:rate=60" -t 3 -c:v libx264 -pix_fmt yuv420p -color_primaries bt709 -color_trc bt709 -colorspace bt709 "$LAB/sdr60.mp4"
node --input-type=module -e 'import { makeHlgClip } from "'"$ROOT"'/scripts/hdr-fixture.mjs"; makeHlgClip(process.argv[1], process.argv[2]);' "$FF" "$LAB/hdr.mov"
CLIPS=("sdr.mp4" "sdr60.mp4" "hdr.mov" "untagged.mp4"); i=0
for f in "$@"; do i=$((i+1)); cp "$f" "$LAB/real$i.mov"; CLIPS+=("real$i.mov"); done
LIST=$(printf '"%s",' "${CLIPS[@]}"); LIST="[${LIST%,}]"
cat > "$LAB/lab.html" <<HTML
<!doctype html><body><script type="module">
import { makeCopies } from "./copies.js";
window.done = (async () => {
  const out = {};
  for (const name of $LIST) {
    const blob = await (await fetch(name)).blob();
    const t = performance.now();
    const c = await makeCopies(new File([blob], name, { type: name.endsWith(".mp4") ? "video/mp4" : "video/quicktime" }));
    out[name] = { ms: Math.round(performance.now() - t), made: Boolean(c) };
    if (c) for (const [k, b] of Object.entries(c)) await fetch("out/" + name + "." + k + ".mp4", { method: "PUT", body: b });
  }
  return out;
})();
</script></body>
HTML
(cd "$LAB" && node.exe "$WIN\\$NAME\\run.mjs")
cat "$LAB/out/result.json"; echo
node --input-type=module -e '
import { previewArgs } from "'"$ROOT"'/render/render.mjs";
import { execFileSync, spawnSync } from "node:child_process"; import fs from "node:fs";
const [ff, lab, list] = process.argv.slice(1); const clips = JSON.parse(list);
const res = JSON.parse(fs.readFileSync(`${lab}/out/result.json`, "utf8"));
const err = (args) => spawnSync(ff, ["-hide_banner", ...args], { encoding: "utf8", maxBuffer: 1 << 28 }).stderr;
const v = (f) => { const s = err(["-i", f]); const m = /Video: (\w+).*?, (\d+)x(\d+)[, ].*?([\d.]+) fps/.exec(s); const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(s); return { codec: m?.[1], w: +m?.[2], h: +m?.[3], fps: +m?.[4], audio: /Audio: aac/.test(s), sec: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : NaN }; };
// Frames paired in order: the browser keeps the original timestamps exactly (frame 1500 of an iPhone clip at 49.9967 s,
// like the original), the server snaps them to a 1/30 s grid (50.0000 s); paired by time, the same frames scored low.
const psnr = (a, b, w, h) => Number(/average:([\d.inf]+)/.exec(err(["-i", a, "-i", b, "-lavfi", `[0:v]setpts=N/30/TB,scale=${w}:${h},format=yuv420p[x];[1:v]setpts=N/30/TB,scale=${w}:${h},format=yuv420p[y];[x][y]psnr`, "-f", "null", "-"]))?.[1]);
const frames = (f) => Number((/frame= *(\d+)/g.exec(err(["-i", f, "-map", "0:v", "-f", "null", "-", "-stats"]).split("\r").filter((l) => l.includes("frame=")).pop() ?? "") ?? [])[1]);
const keyframes = (f) => (err(["-skip_frame", "nokey", "-i", f, "-vf", "showinfo", "-f", "null", "-"]).match(/pts_time:/g) ?? []).length;
let bad = 0; const fail = (m) => { bad++; console.error("FAIL", m); }; const ok = (m) => console.log("ok  ", m);
for (const c of clips) {
  const r = res[c];
  if (c === "hdr.mov") { r.made ? fail("HDR clip was copied in the browser (must be left to the server tone-map)") : ok("HDR clip left to the server"); continue; }
  if (c === "untagged.mp4") { r.made ? fail("a clip without colour tags was copied in the browser (its colours would shift)") : ok("untagged clip left to the server"); continue; }
  if (!r.made) { fail(`${c}: the browser made no copies`); continue; }
  const src = v(`${lab}/${c}`), m = v(`${lab}/out/${c}.master.mp4`), p = v(`${lab}/out/${c}.preview.mp4`);
  // What the server makes from the same clip.
  execFileSync(ff, previewArgs(`${lab}/${c}`, `${lab}/out/${c}.srv-p.mp4`, `${lab}/out/${c}.srv-m.mp4`), { stdio: "ignore" });
  const sm = v(`${lab}/out/${c}.srv-m.mp4`), sp = v(`${lab}/out/${c}.srv-p.mp4`);
  m.codec === "h264" && m.w === 1080 && m.h === 1920 ? ok(`${c} master 1080x1920 h264`) : fail(`${c} master ${m.codec} ${m.w}x${m.h}`);
  p.codec === "h264" && p.w === sp.w && p.h === sp.h ? ok(`${c} preview ${p.w}x${p.h} like the server`) : fail(`${c} preview ${p.w}x${p.h}, server ${sp.w}x${sp.h}`);
  // Over 30.5 fps is capped at 30; an iPhone 30.4 keeps its own frames (as the server copy does).
  const cap = src.fps > 30.5 ? 30.01 : Math.max(30.01, src.fps + 0.1);
  m.fps <= cap && p.fps <= cap ? ok(`${c} frame rate ${m.fps} (source ${src.fps})`) : fail(`${c} fps ${m.fps}/${p.fps}, source ${src.fps}`);
  m.audio === sm.audio && p.audio === sp.audio ? ok(`${c} sound as the server (${m.audio})`) : fail(`${c} sound ${m.audio}/${p.audio}, server ${sm.audio}`);
  Math.abs(m.sec - sm.sec) < 0.15 && Math.abs(p.sec - sp.sec) < 0.15 ? ok(`${c} length ${m.sec}s like the server ${sm.sec}s`) : fail(`${c} length ${m.sec}/${p.sec}, server ${sm.sec}`);
  const [fm, fs] = [frames(`${lab}/out/${c}.master.mp4`), frames(`${lab}/out/${c}.srv-m.mp4`)];
  // Within 2: on a capped 60 fps clip ffmpeg adds a frame or two at the end (3 s: 92 frames, the browser exactly 90).
  Math.abs(fm - fs) <= 2 ? ok(`${c} the same frames as the server copy (${fm} vs ${fs})`) : fail(`${c} ${fm} frames, the server copy ${fs}`);
  const kf = keyframes(`${lab}/out/${c}.master.mp4`);
  kf >= Math.floor(m.sec) ? ok(`${c} a key frame every second (${kf} in ${m.sec}s)`) : fail(`${c} only ${kf} key frames in ${m.sec}s`);
  if (c === "sdr60.mp4") { console.log(`time ${c}: ${(r.ms / 1000).toFixed(1)} s`); continue; }
  // The picture matches the server copy. Real footage measures 45+ dB between the two; the test pattern is blurred
  // like real footage (a razor-sharp pattern turns a sub-pixel difference in where canvas and ffmpeg centre the crop into
  // a low score that says nothing about real video).
  for (const [a, b, w, h, name] of [[`${lab}/out/${c}.master.mp4`, `${lab}/out/${c}.srv-m.mp4`, 1080, 1920, "master"], [`${lab}/out/${c}.preview.mp4`, `${lab}/out/${c}.srv-p.mp4`, p.w, p.h, "preview"]]) {
    const db = psnr(a, b, w, h);
    // The 480p preview is a ~1 Mbps editor copy on both sides: 32 dB; the export copy 35.
    const need = name === "preview" ? 32 : 35;
    db >= need ? ok(`${c} ${name} picture matches the server copy (${db} dB)`) : fail(`${c} ${name} picture off from the server copy (${db} dB, needs ${need})`);
  }
  console.log(`time ${c}: ${(r.ms / 1000).toFixed(1)} s in the browser (clip ${src.sec}s, ${src.w}x${src.h} ${src.codec})`);
}
if (bad) process.exit(1);
console.log("copies: the browser copies match the server copies");
' "$FF" "$LAB" "$LIST"
