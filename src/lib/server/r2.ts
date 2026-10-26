import "server-only";
import { assertProductionConfig } from "@/lib/production-config";
import { workSignal } from "@/lib/server/work-budget";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Cloudflare R2 (S3-compatible) for every file: uploads, generated hooks, exports and the library's clips.
 * Keys: media/<mediaId> for anything served at /api/media/<mediaId>; library/{sources,hooks,demos,audio}/<code>.*
 * for the curated library. The browser never sees the keys: it gets short-lived signed links.
 */
export const r2Enabled = () => { assertProductionConfig(); return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET); };

let client: S3Client | null = null;
function r2(): S3Client {
  return (client ??= new S3Client({
    region: "auto",
    requestHandler: { connectionTimeout: 5_000, requestTimeout: 20_000 },
    requestChecksumCalculation: "WHEN_REQUIRED",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  }));
}
const Bucket = () => process.env.R2_BUCKET!;

export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
  await r2().send(new PutObjectCommand({ Bucket: Bucket(), Key: key, Body: body, ContentType: contentType }), { abortSignal: workSignal(20_000) });
}

export async function objectSize(key: string): Promise<number | null> {
  try {
    const head = await r2().send(new HeadObjectCommand({ Bucket: Bucket(), Key: key }));
    return head.ContentLength ?? 0;
  } catch {
    return null;
  }
}

/** Download an object to a local file (for ffmpeg and the AI models); false when it does not exist. */
export async function downloadTo(key: string, file: string): Promise<boolean> {
  try {
    const signal = workSignal(60_000);
    const out = await r2().send(new GetObjectCommand({ Bucket: Bucket(), Key: key }), { abortSignal: signal });
    if (!out.Body) return false;
    await pipeline(out.Body as Readable, createWriteStream(file), { signal });
    return true;
  } catch {
    return false;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await r2().send(new DeleteObjectCommand({ Bucket: Bucket(), Key: key })).catch(() => undefined);
}
export async function deleteObjectStrict(key: string): Promise<void> {
  await r2().send(new DeleteObjectCommand({ Bucket: Bucket(), Key: key }));
}

/** A link the browser can read the object from, for `seconds`; with `download`, it saves as that file name. */
const readLinks = new Map<string, {until: number; value: Promise<string>}>();
export function signedGet(key: string, seconds = 3600, download?: string): Promise<string> {
  const disposition = download ? `attachment; filename="${download.replace(/[^\w .-]/g, "_")}"` : undefined;
  // Keep at least half the original lifetime for the browser's 30-minute redirect cache.
  // Permission checks remain at every API entry; PUT grants are never reused.
  const cacheKey = JSON.stringify([Bucket(), key, seconds, disposition]);
  const now = Date.now();
  const hit = readLinks.get(cacheKey);
  if (hit && hit.until > now) return hit.value;
  readLinks.delete(cacheKey);
  const value = getSignedUrl(r2(), new GetObjectCommand({ Bucket: Bucket(), Key: key, ResponseContentDisposition: disposition }), { expiresIn: seconds });
  if (seconds >= 120) {
    if (readLinks.size >= 1000) readLinks.delete(readLinks.keys().next().value!);
    const entry = {until: now + Math.min(seconds / 2, 1800) * 1000, value};
    readLinks.set(cacheKey, entry);
    void value.catch(() => { if (readLinks.get(cacheKey) === entry) readLinks.delete(cacheKey); });
  }
  return value;
}

/** A link the browser can upload one object to (PUT with this exact content type), for `seconds`. */
export function signedPut(key: string, contentType: string, seconds = 900, size?: number): Promise<string> {
  return getSignedUrl(r2(), new PutObjectCommand({ Bucket: Bucket(), Key: key, ContentType: contentType, ...(size === undefined ? {} : { ContentLength: size }) }), { expiresIn: seconds });
}
export async function objectInfo(key: string): Promise<{size: number; mime: string; etag: string} | null> {
 try {
  const h = await r2().send(new HeadObjectCommand({ Bucket: Bucket(), Key: key }));
  return { size: h.ContentLength ?? 0, mime: h.ContentType ?? "", etag: h.ETag ?? "" };
 } catch (error) {
  if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
  throw error;
 }
}
export async function copyObject(from: string, to: string, etag: string) {
 await r2().send(new CopyObjectCommand({ Bucket: Bucket(), Key: to, CopySource: `${Bucket()}/${from}`, CopySourceIfMatch: etag }));
}
