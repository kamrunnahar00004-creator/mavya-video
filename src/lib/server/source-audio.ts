import "server-only";
import { execFile } from "node:child_process";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const extracting = new Map<string, Promise<string>>();
const exec = promisify(execFile);

/** Extract once per source revision; share concurrent requests and publish atomically. */
export async function sourceAudio(code: string, source: string, stamp: string): Promise<string> {
  const directory = path.join(process.cwd(), ".data", "audio");
  const target = path.join(directory, `${code}-${stamp}.m4a`);
  try { await stat(target); return target; } catch { /* Not cached yet. */ }
  const pending = extracting.get(target);
  if (pending) return pending;
  const operation = (async () => {
    await mkdir(directory, { recursive: true });
    const temp = `${target}.${process.pid}.tmp.m4a`;
    try {
      const require = createRequire(path.join(process.cwd(), "package.json"));
      const ffmpeg = require("ffmpeg-static") as string | null;
      if (!ffmpeg) throw new Error("ffmpeg unavailable");
      await exec(ffmpeg, ["-nostdin", "-v", "error", "-y", "-i", source, "-vn", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", temp], { timeout: 60000 });
      await rename(temp, target);
      return target;
    } finally { await unlink(temp).catch(() => undefined); }
  })();
  extracting.set(target, operation);
  try { return await operation; } finally { extracting.delete(target); }
}
