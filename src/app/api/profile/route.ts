import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";
import { NO_PROFILE, type Profile } from "@/lib/profile";

/**
 * The profile (name, picture) until accounts exist: one local profile in .data/profile.json. With accounts it moves
 * to the user record; the email will come from sign-in and is read-only here.
 */
const FILE = path.join(process.cwd(), ".data", "profile.json");
const AVATAR = /^\/api\/media\/[A-Za-z0-9-]+\.(jpg|png)$/;

async function read(): Promise<Profile> {
  try {
    return { ...NO_PROFILE, ...(JSON.parse(await readFile(FILE, "utf8")) as Partial<Profile>) };
  } catch {
    // A copy: PATCH edits the result, never the shared default.
    return { ...NO_PROFILE };
  }
}

export async function GET() {
  await connection();
  return Response.json(await read());
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<Record<keyof Profile, unknown>> | null;
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });
  const next = await read();
  for (const key of ["firstName", "lastName"] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "string" || body[key].length > 60) return Response.json({ error: "Names are up to 60 characters." }, { status: 400 });
    next[key] = body[key].trim();
  }
  if (body.avatar !== undefined) {
    if (body.avatar !== "" && (typeof body.avatar !== "string" || !AVATAR.test(body.avatar))) return Response.json({ error: "Invalid picture" }, { status: 400 });
    next.avatar = body.avatar;
  }
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(`${FILE}.tmp`, JSON.stringify(next, null, 2));
  await rename(`${FILE}.tmp`, FILE);
  return Response.json(next);
}
