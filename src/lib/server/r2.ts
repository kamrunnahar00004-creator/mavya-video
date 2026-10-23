import "server-only";
import { assertProductionConfig } from "@/lib/production-config";
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
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  }));
}
const Bucket = () => process.env.R2_BUCKET!;

export async function putObject(key: string, body: Buffer | Uint8Array, contentType: string): Promise<void> {
  await r2().send(new PutObjectCommand({ Bucket: Bucket(), Key: key, Body: body, ContentType: contentType }));
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
    const out = await r2().send(new GetObjectCommand({ Bucket: Bucket(), Key: key }));
    if (!out.Body) return false;
    await pipeline(out.Body as Readable, createWriteStream(file));
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
export function signedGet(key: string, seconds = 3600, download?: string): Promise<string> {
  const disposition = download ? `attachment; filename="${download.replace(/[^\w .-]/g, "_")}"` : undefined;
  return getSignedUrl(r2(), new GetObjectCommand({ Bucket: Bucket(), Key: key, ResponseContentDisposition: disposition }), { expiresIn: seconds });
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
