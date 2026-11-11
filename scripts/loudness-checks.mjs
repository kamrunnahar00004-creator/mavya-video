// Export loudness (founder 2026-11-11: an export with a song at full volume peaked at 0 dB and clipped; "can you then
// by default put the volume to a correct level?"). Every export is set to -14 LUFS and never peaks over -1 dBFS
// (render/loudness.mjs). Checks the meter against ffmpeg's BS.1770 meter on several kinds of sound, the gain rules,
// the browser mix (levelMix) measured by ffmpeg afterwards, the server's measure-and-level pass end to end (picture
// copied untouched), and that both export lanes call it. Offline, ~5 s.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import url from "node:url";
import { ENCODER_ROOM_DB, MAX_BOOST_DB, PEAK_MAX_DB, TARGET_LUFS, exportGainDb, integratedLufs, levelFile, levelMix, peakDb } from "../render/loudness.mjs";
import { levelArgs, loudnessArgs, parseLoudness } from "../render/render.mjs";
const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const ff = path.join(root, "node_modules/ffmpeg-static/ffmpeg");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loudness-"));
let checks = 0; const ok = (c, m) => { checks++; if (!c) { console.error("loudness-checks FAILED:", m); process.exitCode = 1; } };
const RATE = 48000;
const meter = (file) => parseLoudness(spawnSync(ff, loudnessArgs(file), { encoding: "utf8", timeout: 60_000 }).stderr);
const pcm = (file) => {
  const b = execFileSync(ff, ["-v", "error", "-i", file, "-vn", "-ac", "2", "-ar", String(RATE), "-f", "f32le", "-"], { maxBuffer: 1 << 28, timeout: 60_000 });
  const f = new Float32Array(b.buffer, b.byteOffset, b.length / 4), n = f.length / 2, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = f[2 * i]; R[i] = f[2 * i + 1]; }
  return [L, R];
};
const wav = (name, chs) => {
  const n = chs[0].length, b = Buffer.alloc(n * 8);
  for (let i = 0; i < n; i++) { b.writeFloatLE(chs[0][i], i * 8); b.writeFloatLE(chs[1][i], i * 8 + 4); }
  fs.writeFileSync(`${dir}/${name}.raw`, b);
  execFileSync(ff, ["-v", "error", "-y", "-f", "f32le", "-ar", String(RATE), "-ac", "2", "-i", `${dir}/${name}.raw`, "-c:a", "pcm_f32le", `${dir}/${name}.wav`], { timeout: 60_000 });
  return `${dir}/${name}.wav`;
};
try {
  // 1. The meter agrees with ffmpeg's on very different sounds: a loud clipped "song", a quiet voice-like tone with
  // pauses (gating matters), pink-ish noise, a bass hum (K-weighting matters).
  const sources = {
    loudSong: "sine=f=220:d=6,volume=12,aformat=channel_layouts=stereo",
    quietVoice: "sine=f=440:d=6,volume='0.05*gt(mod(t,1),0.4)':eval=frame,aformat=channel_layouts=stereo",
    noise: "anoisesrc=d=6:c=pink:a=0.3,aformat=channel_layouts=stereo",
    bassHum: "sine=f=40:d=6,volume=0.5,aformat=channel_layouts=stereo",
  };
  for (const [name, src] of Object.entries(sources)) {
    execFileSync(ff, ["-v", "error", "-y", "-f", "lavfi", "-i", src, "-ar", String(RATE), "-c:a", "pcm_f32le", `${dir}/${name}.wav`], { timeout: 60_000 });
    const chs = pcm(`${dir}/${name}.wav`), theirs = meter(`${dir}/${name}.wav`), ours = integratedLufs(chs, RATE), tp = peakDb(chs);
    ok(Math.abs(ours - theirs.lufs) <= 0.15, `${name}: our meter ${ours.toFixed(2)} LUFS, ffmpeg's ${theirs.lufs} (allowed 0.15)`);
    ok(Math.abs(tp - theirs.peak) <= 0.3, `${name}: our true peak ${tp.toFixed(2)} dBTP, ffmpeg's ${theirs.peak} (allowed 0.3)`);
  }

  // 2. The gain rules.
  ok(Math.abs(exportGainDb(-8.2, 0.4) - -5.8) < 1e-9, "the founder's export (-8.2 LUFS, peak +0.4): down 5.8 dB to -14");
  ok(Math.abs(exportGainDb(-20, -4) - (PEAK_MAX_DB - ENCODER_ROOM_DB + 4)) < 1e-9, "a quiet mix with a high peak is raised only until its peak reaches the cap (with room for the encoder)");
  ok(Math.abs(exportGainDb(-Infinity, 6) - (PEAK_MAX_DB - ENCODER_ROOM_DB - 6)) < 1e-9 && exportGainDb(-Infinity, -20) === 0, "a mix too short to measure is still turned down when it clips (Codex: 100 ms at +6 dB), never up");
  ok(exportGainDb(-40, -30) === MAX_BOOST_DB, `a near-silent mix is raised at most ${MAX_BOOST_DB} dB`);
  ok(exportGainDb(-Infinity, -Infinity) === 0 && exportGainDb(-75, -60) === 0, "silence is left alone");
  ok(TARGET_LUFS === -14 && PEAK_MAX_DB === -1 && ENCODER_ROOM_DB >= 1, "the platforms' level: -14 LUFS, true peaks at most -1 dBTP, mixes capped at least 1 dB lower for the encoder");

  // 3. The browser export's mix after levelMix, measured by ffmpeg.
  for (const name of ["loudSong", "noise"]) {
    const chs = pcm(`${dir}/${name}.wav`);
    levelMix(chs, RATE);
    const m = meter(wav(`${name}-levelled`, chs));
    const cap = PEAK_MAX_DB - ENCODER_ROOM_DB;
    ok((Math.abs(m.lufs - TARGET_LUFS) <= 0.3 || m.peak >= cap - 0.3) && m.peak <= cap + 0.1, `${name} after levelMix: ${m.lufs} LUFS, true peak ${m.peak} dBTP`);
  }
  ok(peakDb([new Float32Array(10)]) === -Infinity && levelMix([new Float32Array(RATE), new Float32Array(RATE)], RATE) === 0, "a silent mix stays silent");

  // 3b. Sharp high bursts set right at the mix's cap stay under -1 dBTP once AAC-encoded (Codex 2026-11-11: at a
  // sample-peak cap they came out at +3.5).
  for (const f of [5000, 10000, 15000]) {
    execFileSync(ff, ["-v", "error", "-y", "-f", "lavfi", "-i", `sine=f=${f}:d=4,volume='8*gt(mod(t,0.5),0.45)':eval=frame,aformat=channel_layouts=stereo`, "-ar", String(RATE), "-c:a", "pcm_f32le", `${dir}/burst.wav`], { timeout: 60_000 });
    const chs = pcm(`${dir}/burst.wav`), k = 10 ** ((PEAK_MAX_DB - ENCODER_ROOM_DB - peakDb(chs)) / 20);
    for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k;
    execFileSync(ff, ["-v", "error", "-y", "-i", wav("burst-capped", chs), "-c:a", "aac", "-b:a", "160k", `${dir}/burst.m4a`], { timeout: 60_000 });
    const m = meter(`${dir}/burst.m4a`);
    ok(m.peak <= PEAK_MAX_DB, `${f} Hz bursts at the cap: ${m.peak} dBTP after AAC (at most ${PEAK_MAX_DB})`);
  }

  // 4. The server's pass on a loud, clipping export: measured, levelled, picture copied as is.
  execFileSync(ff, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x568:r=30:d=4", "-f", "lavfi", "-i", "sine=f=220:d=4,volume=12",
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-b:a", "160k", "-shortest", `${dir}/joined.mp4`], { timeout: 60_000 });
  const before = meter(`${dir}/joined.mp4`), gain = exportGainDb(before.lufs, before.peak);
  ok(gain < -3, `the loud export is turned down (${before.lufs} LUFS, peak ${before.peak} dBFS: gain ${gain.toFixed(2)} dB)`);
  execFileSync(ff, levelArgs(`${dir}/joined.mp4`, `${dir}/out.mp4`, gain), { stdio: "ignore", timeout: 60_000 });
  const after = meter(`${dir}/out.mp4`);
  ok(Math.abs(after.lufs - TARGET_LUFS) <= 0.5 && after.peak <= PEAK_MAX_DB + 0.3, `server export after the pass: ${after.lufs} LUFS, peak ${after.peak} dBFS`);
  const video = (f) => execFileSync(ff, ["-v", "error", "-i", f, "-map", "0:v", "-c", "copy", "-f", "md5", "-"], { encoding: "utf8", timeout: 60_000 });
  ok(video(`${dir}/joined.mp4`) === video(`${dir}/out.mp4`), "the picture is copied untouched");
  ok(parseLoudness("  Integrated loudness:\n    I:         -inf LUFS\n  Sample peak:\n    Peak:      -inf dBFS").lufs === -Infinity, "a silent file reads as silent");

  // 4b. The server's re-check: an encode that overshot is redone quieter; a right one is left; a right export untouched.
  const runPasses = async (peaks) => { const gains = []; let i = 0; const out = await levelFile(async (f) => (f === null ? { lufs: -8, peak: 0 } : { lufs: -14, peak: peaks[i++] }), async (g, p) => { gains.push(g); return `out${p}`; }); return { out, gains }; };
  let lv = await runPasses([0.5, -1.2]);
  ok(lv.out === "out1" && lv.gains.length === 2 && Math.abs(lv.gains[1] - (lv.gains[0] - 1.7)) < 1e-9, `an encode that came out over -1 dBTP is redone 1.5 + 0.2 dB quieter (${JSON.stringify(lv.gains)})`);
  lv = await runPasses([-1.5]);
  ok(lv.out === "out0" && lv.gains.length === 1, "a right encode is kept");
  ok((await levelFile(async () => ({ lufs: -14, peak: -3 }), async () => "x")) === null, "an export already at the level is left as made");

  // 5. Both lanes use it.
  const browser = fs.readFileSync(path.join(root, "src/lib/browser-export.ts"), "utf8");
  ok(/await mixSound\(\);[\s\S]{0,200}levelMix\(mix, RATE\);[\s\S]{0,200}copyToChannel\(mix\[0\], 0\)/.test(browser), "the browser export levels its mix before encoding it");
  const server = fs.readFileSync(path.join(root, "render/server.mjs"), "utf8");
  ok(/loudnessArgs\(file \?\? joined\)[\s\S]{0,200}levelFile\(measure, async \(gain, pass\)[\s\S]{0,200}levelArgs\(joined, file, gain\)[\s\S]{0,80}\}\)\) \?\? joined;/.test(server) && /ebur128=peak=true/.test(fs.readFileSync(path.join(root, "render/render.mjs"), "utf8")) && /demoArgs\(out, demo, at\)/.test(server) && /createReadStream\(out\)/.test(server), "the server export levels its file before the demo is cut and the upload");
} catch (e) { ok(false, String(e?.stack ?? e).slice(0, 400)); }
finally { fs.rmSync(dir, { recursive: true, force: true }); }
if (!process.exitCode && checks !== 29) { console.error(`loudness-checks: ${checks} checks ran, expected 29`); process.exitCode = 1; }
if (!process.exitCode) console.log(`loudness-checks: ${checks} checks pass`);
