"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { SettingsPage } from "@/components/settings-shell";
import { NO_PROFILE, PROFILE_EVENT, initials, signOut, type Profile } from "@/lib/profile";

/** Settings > Profile: picture, email (from sign-in), first and last name, and deleting the account. */
export function ProfileView() {
  const [saved, setSaved] = useState<Profile | null>(null);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [busy, setBusy] = useState<"save" | "photo" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/profile")
      .then((r) => r.json() as Promise<Profile>)
      .then((p) => {
        if (!alive) return;
        setSaved(p);
        setFirst(p.firstName);
        setLast(p.lastName);
      })
      .catch(() => alive && setSaved(NO_PROFILE));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const save = async (patch: Partial<Profile>, done: string) => {
    const res = await fetch("/api/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save.");
    const p = (await res.json()) as Profile;
    setSaved(p);
    window.dispatchEvent(new CustomEvent(PROFILE_EVENT, { detail: p }));
    setToast(done);
  };

  const saveNames = async () => {
    setBusy("save");
    await save({ firstName: first, lastName: last }, "Saved").catch((e: Error) => setToast(e.message));
    setBusy(null);
  };

  const pickPhoto = async (f: File | undefined) => {
    if (!f) return;
    if (!["image/jpeg", "image/png"].includes(f.type)) return setToast("Use a JPG or PNG.");
    if (f.size > 5 * 1024 * 1024) return setToast("Use a picture under 5 MB.");
    setBusy("photo");
    try {
      const form = new FormData();
      form.append("file", f);
      const res = await fetch("/api/media", { method: "POST", body: form });
      if (!res.ok) throw new Error("Couldn't upload the picture.");
      const { mediaId } = (await res.json()) as { mediaId: string };
      await save({ avatar: `/api/media/${mediaId}` }, "Picture updated");
    } catch (e) {
      setToast((e as Error).message);
    }
    setBusy(null);
  };

  const deleteAccount = async () => {
    setConfirm(false);
    const res = await fetch("/api/account", { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setToast(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't delete the account.");
      return;
    }
    await signOut();
  };

  const dirty = saved !== null && (first.trim() !== saved.firstName || last.trim() !== saved.lastName);
  const p = saved ?? NO_PROFILE;
  const input = "w-full rounded-lg border border-line-strong bg-panel px-3 py-2 text-[14.5px] text-text outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-raised disabled:text-muted";
  const row = "grid gap-2 border-t border-line px-6 py-5 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-center sm:gap-6";
  const label = "text-[14px] font-semibold";

  return (
    <SettingsPage title="Profile" subtitle="Manage your personal details">
        <section className="mt-6 overflow-hidden rounded-2xl border border-line bg-panel">
          <div className={row.replace("border-t ", "")}>
            <span className={label}>Profile picture</span>
            <div className="flex items-center gap-4">
              <Avatar profile={p} className="h-14 w-14 text-[18px]" />
              <input ref={file} type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
              <button type="button" onClick={() => file.current?.click()} disabled={busy !== null} className="flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-1.5 text-[13.5px] font-bold hover:border-ink disabled:opacity-60">
                {busy === "photo" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload
              </button>
              {p.avatar && (
                <button type="button" onClick={() => void save({ avatar: "" }, "Picture removed").catch((e: Error) => setToast(e.message))} disabled={busy !== null} className="text-[13.5px] font-semibold text-muted hover:text-text">
                  Remove
                </button>
              )}
            </div>
          </div>

          <div className={row}>
            <label className={label} htmlFor="p-email">Email</label>
            <input id="p-email" className={input} value={p.email} placeholder="Shown after you sign in" disabled />
          </div>
          <div className={row}>
            <label className={label} htmlFor="p-first">First name</label>
            <input id="p-first" className={input} value={first} maxLength={60} autoComplete="given-name" onChange={(e) => setFirst(e.target.value)} disabled={!saved} />
          </div>
          <div className={row}>
            <label className={label} htmlFor="p-last">Last name</label>
            <input id="p-last" className={input} value={last} maxLength={60} autoComplete="family-name" onChange={(e) => setLast(e.target.value)} disabled={!saved} />
          </div>
          <div className="flex justify-end border-t border-line bg-raised px-6 py-3.5">
            <button type="button" onClick={() => void saveNames()} disabled={!dirty || busy !== null} className="btn-primary px-4 py-2 text-[14px] disabled:opacity-50">
              {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />}
              Save changes
            </button>
          </div>
        </section>

        <h2 className="mt-10 text-[15px] font-bold text-red-700!">Danger zone</h2>
        <section className="mt-3 rounded-2xl border border-red-200 bg-panel">
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5">
            <div>
              <p className="text-[14px] font-semibold">Delete account</p>
              <p className="mt-0.5 text-[13.5px] text-muted">Permanently delete your account and all associated data</p>
            </div>
            <button type="button" onClick={() => setConfirm(true)} className="rounded-lg border border-red-300 px-4 py-2 text-[14px] font-bold text-red-700 hover:bg-red-50">
              Delete
            </button>
          </div>
        </section>

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#15121f]/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && setConfirm(false)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="del-title" className="w-full max-w-[420px] rounded-2xl bg-panel p-6 shadow-[0_24px_64px_-16px_rgba(21,18,31,0.45)]">
            <h2 id="del-title" className="text-[19px] font-bold">Delete your account?</h2>
            <p className="mt-2 text-[14px] text-muted">Your videos, uploads and plan are removed for good. This can&apos;t be undone.</p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setConfirm(false)} className="rounded-lg border border-line-strong px-4 py-2 text-[14px] font-bold hover:border-ink">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void deleteAccount()}
                className="rounded-lg bg-red-600 px-4 py-2 text-[14px] font-bold text-white hover:bg-red-700"
              >
                Delete account
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="fade-in fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-text px-4 py-2.5 text-[13.5px] font-semibold text-bg shadow-lg">{toast}</div>}
    </SettingsPage>
  );
}

/** The profile picture, or initials on violet. */
export function Avatar({ profile, className = "h-8 w-8 text-[12px]" }: { profile: Profile; className?: string }) {
  return profile.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={profile.avatar} alt="" className={`${className} shrink-0 rounded-full object-cover`} />
  ) : (
    <span aria-hidden className={`${className} flex shrink-0 items-center justify-center rounded-full bg-accent font-bold text-white`}>{initials(profile)}</span>
  );
}
