#!/usr/bin/env bash
# Export colour check in real Chrome (founder 2026-11-10: browser exports looked too contrasty and saturated; CapCut,
# phones and our server write standard-range BT.709). Builds a credential-free local copy of the app with a test-only
# page that runs browserExport, exports a clip of known colour patches on every encoder setting this Chrome offers
# (headed: the real GPU encoder), then measures each file here with ffmpeg: standard range, BT.709 labels, and the
# same colours as the source. Never touches production. Usage: bash scripts/browser/export-colour.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib.sh
. "$ROOT/scripts/browser/lib.sh"
SERVER=""
WORK="$(mktemp -d)"
trap cleanup EXIT
WIN_TMP="$(wslpath "$(cmd.exe /c 'echo %TEMP%' 2>/dev/null | tr -d '\r')")/mavya-export-colour"
if ! port_free 3210; then echo "export colour: port 3210 is in use; stop what runs there first"; exit 1; fi
cd "$ROOT" && git ls-files -co --exclude-standard | grep -v '^\.env' | grep -v '^\.data/' | tar -cf - -T - | tar -xf - -C "$WORK"
ln -s "$ROOT/node_modules" "$WORK/node_modules"
sed -i 's|  turbopack: {|  turbopack: {\n    root: "/",|' "$WORK/next.config.ts"
FF="$ROOT/node_modules/ffmpeg-static/ffmpeg"
mkdir -p "$WORK/.data/media" "$WORK/public/lab" "$WORK/src/app/export-lab"
echo '{"references":[],"assets":[],"runs":[]}' > "$WORK/.data/db.json"
# Known patches on a 1080x1920 standard-range BT.709 clip, like a phone's.
P="drawbox=x=0:y=0:w=540:h=480:color=0x000000:t=fill,drawbox=x=540:y=0:w=540:h=480:color=0xFFFFFF:t=fill"
P="$P,drawbox=x=0:y=480:w=540:h=480:color=0x1E1E1E:t=fill,drawbox=x=540:y=480:w=540:h=480:color=0xDCDCDC:t=fill"
P="$P,drawbox=x=0:y=960:w=540:h=480:color=0xC81E1E:t=fill,drawbox=x=540:y=960:w=540:h=480:color=0x1EB43C:t=fill"
P="$P,drawbox=x=0:y=1440:w=540:h=480:color=0x283CC8:t=fill,drawbox=x=540:y=1440:w=540:h=480:color=0xE1AA8C:t=fill"
"$FF" -v error -y -f lavfi -i "color=0x808080:s=1080x1920:r=30:d=${SECONDS_LONG:-2},format=yuv444p,$P,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p" \
  -c:v libx264 -crf 8 -preset veryfast -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 "$WORK/public/lab/patches.mp4"
# SOURCE=<file>: export that clip instead (labels and range only; its colours are not known patches).
if [ -n "${SOURCE:-}" ]; then cp "$SOURCE" "$WORK/public/lab/patches.mp4"; fi
cat > "$WORK/src/app/export-lab/page.tsx" <<'TSX'
"use client";
import { useEffect } from "react";
import { browserExport } from "@/lib/browser-export";
export default function Lab() {
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__lab = async (only: string) => {
      const spec = { width: 1080, height: 1920, fps: 30, total: Number(new URLSearchParams(location.search).get("t") ?? 2), segments: [{ url: `${location.origin}/lab/patches.mp4`, gap: 0, speed: 1, volume: 0, look: null, pieces: [{ start: 0, end: Number(new URLSearchParams(location.search).get("t") ?? 2) }] }], sounds: [], overlays: [] };
      const r = await browserExport(spec, [], () => undefined, undefined, only);
      const b = new Uint8Array(await r.video.arrayBuffer());
      let s = "";
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
      return { encoder: r.encoder, b64: btoa(s) };
    };
    w.__labels = ["hw-qp20", "hw-qp20-auto", "sw-22m", "hw-10m", "hw-14m-vbr"];
  }, []);
  return <p>export lab</p>;
}
TSX
NODE_DIR="$(dirname "$(command -v node)")"
(cd "$WORK" && exec setsid env -i HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin:$NODE_DIR" npx next dev -p 3210 > "$WORK/dev.log" 2>&1) &
SERVER=$!
ready=0; for i in $(seq 1 180); do
  kill -0 "$SERVER" 2>/dev/null || break
  if grep -q "localhost:3210" "$WORK/dev.log" && curl -s -o /dev/null -w '%{http_code}' http://localhost:3210/export-lab | grep -q 200; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then echo "export colour: the local server never started"; tail -20 "$WORK/dev.log"; exit 1; fi
rm -rf "$WIN_TMP" && mkdir -p "$WIN_TMP" && cp "$ROOT/scripts/browser/export-colour-run.mjs" "$WIN_TMP/"
(cd "$WIN_TMP" && cmd.exe /c "set T=${SECONDS_LONG:-2}&& set ONLY=${ONLY:-}&& node export-colour-run.mjs")
cp "$WORK/public/lab/patches.mp4" "$WIN_TMP/source.mp4"
PATCHES="${SOURCE:+no}" node "$ROOT/scripts/browser/export-colour-measure.cjs" "$WIN_TMP"
