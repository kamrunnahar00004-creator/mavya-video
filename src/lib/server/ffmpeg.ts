import "server-only";
import { constants } from "node:fs";
import { access, chmod, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let resolved: Promise<string> | null = null;

/**
 * The ffmpeg binary from ffmpeg-static, by file path. Deployed functions ship only the binary
 * (next.config outputFileTracingIncludes), not the package's index.js, so `require("ffmpeg-static")`
 * fails there with MODULE_NOT_FOUND. If the shipped file is not executable, run a copy from the temp dir.
 */
export function ffmpegPath(): Promise<string> {
  resolved ??= (async () => {
    const bin = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    try {
      await access(bin, constants.X_OK);
      return bin;
    } catch {
      await access(bin, constants.R_OK).catch(() => { throw new Error("ffmpeg unavailable"); });
      const copy = path.join(tmpdir(), "mavya-ffmpeg");
      await copyFile(bin, copy);
      await chmod(copy, 0o755);
      return copy;
    }
  })().catch((error) => {
    resolved = null;
    throw error;
  });
  return resolved;
}
