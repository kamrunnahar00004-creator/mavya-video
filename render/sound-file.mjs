// Node side of render/sound.mjs: a piece's raw 48 kHz stereo f32le sound (render.mjs pieceSoundArgs) stretched to
// exactly its planned length, written back as raw f32le for stepArgs. Read and written in 1 MiB chunks, so only the
// two channels and the stretch's own arrays are ever whole in memory (the render server has 512 MB; a 180 s video at
// 2x reads 360 s of sound).
import { open } from "node:fs/promises";
import { fillSound } from "./sound.mjs";

const CHUNK = 1 << 20;

/** @param {string} input  raw f32le stereo  @param {string} output  @param {number} samples  planned samples per channel */
export async function fillSoundFile(input, output, samples) {
  const src = await open(input, "r");
  let chs;
  try {
    const len = Math.floor((await src.stat()).size / 8);
    chs = [new Float32Array(len), new Float32Array(len)];
    const buf = Buffer.alloc(CHUNK);
    for (let at = 0; at < len; ) {
      const want = Math.min(CHUNK / 8, len - at);
      const { bytesRead } = await src.read(buf, 0, want * 8, at * 8);
      const got = Math.floor(bytesRead / 8);
      if (!got) throw new Error("short sound file");
      for (let i = 0; i < got; i++) { chs[0][at + i] = buf.readFloatLE(i * 8); chs[1][at + i] = buf.readFloatLE(i * 8 + 4); }
      at += got;
    }
  } finally {
    await src.close();
  }
  const [l, r] = fillSound(chs, samples);
  chs = null;
  const dst = await open(output, "w");
  try {
    const buf = Buffer.alloc(CHUNK);
    for (let at = 0; at < samples; ) {
      const n = Math.min(CHUNK / 8, samples - at);
      for (let i = 0; i < n; i++) { buf.writeFloatLE(l[at + i], i * 8); buf.writeFloatLE(r[at + i], i * 8 + 4); }
      await dst.write(buf, 0, n * 8);
      at += n;
    }
  } finally {
    await dst.close();
  }
}
