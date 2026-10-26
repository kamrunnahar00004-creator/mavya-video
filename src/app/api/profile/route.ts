import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";
import { NO_PROFILE, type Profile } from "@/lib/profile";
import { authEnabled, createSupabaseServerClient, getSessionUser } from "@/lib/supabase/server";

/**
 * The signed-in person's profile: email from sign-in (read-only), names and picture from the `profiles` table
 * (filled from Google at sign-up, see supabase/migrations). Without Supabase keys (local, no accounts) it falls back
 * to one local profile in .data/profile.json.
 */
const FILE = path.join(process.cwd(), ".data", "profile.json");
const AVATAR = /^\/api\/media\/[A-Za-z0-9-]+\.(jpg|png)$/;

async function readLocal(): Promise<Profile> {
  try {
    return { ...NO_PROFILE, ...(JSON.parse(await readFile(FILE, "utf8")) as Partial<Profile>) };
  } catch {
    // A copy: PATCH edits the result, never the shared default.
    return { ...NO_PROFILE };
  }
}

type Row = { first_name: string; last_name: string; avatar_url: string };

async function readAccount(): Promise<Profile | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("profiles").select("first_name, last_name, avatar_url").eq("id", user.id).maybeSingle<Row>();
  if (error) throw error;
  return { email: user.email ?? "", firstName: data?.first_name ?? "", lastName: data?.last_name ?? "", avatar: data?.avatar_url ?? "" };
}

export async function GET() {
  await connection();
  if (!authEnabled()) return Response.json(await readLocal());
  try {
    const profile = await readAccount();
    return profile ? Response.json(profile) : Response.json({ error: "Sign in first." }, { status: 401 });
  } catch {
    return Response.json({ error: "Profile is unavailable. Try again." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as Partial<Record<keyof Profile, unknown>> | null;
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });
  const patch: Partial<Profile> = {};
  for (const key of ["firstName", "lastName"] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "string" || body[key].length > 60) return Response.json({ error: "Names are up to 60 characters." }, { status: 400 });
    patch[key] = body[key].trim();
  }
  if (body.avatar !== undefined) {
    if (body.avatar !== "" && (typeof body.avatar !== "string" || !AVATAR.test(body.avatar))) return Response.json({ error: "Invalid picture" }, { status: 400 });
    patch.avatar = body.avatar;
  }

  if (authEnabled()) {
    const user = await getSessionUser();
    if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
    const supabase = await createSupabaseServerClient();
    const row: Partial<Row> & { updated_at: string } = { updated_at: new Date().toISOString() };
    if (patch.firstName !== undefined) row.first_name = patch.firstName;
    if (patch.lastName !== undefined) row.last_name = patch.lastName;
    if (patch.avatar !== undefined) row.avatar_url = patch.avatar;
    const { error } = await supabase.from("profiles").update(row).eq("id", user.id);
    if (error) return Response.json({ error: "Couldn't save." }, { status: 500 });
    try { return Response.json(await readAccount()); }
    catch { return Response.json({ error: "Profile is unavailable. Try again." }, { status: 503 }); }
  }

  const next = { ...(await readLocal()), ...patch };
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(`${FILE}.tmp`, JSON.stringify(next, null, 2));
  await rename(`${FILE}.tmp`, FILE);
  return Response.json(next);
}
