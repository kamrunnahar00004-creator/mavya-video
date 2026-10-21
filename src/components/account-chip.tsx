"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/profile-view";
import { NO_PROFILE, PROFILE_EVENT, displayName, type Profile } from "@/lib/profile";
import { planById, type PlanId } from "@/lib/plans";

/** Bottom of the sidebar: who is signed in and their plan; opens Settings. Updates when the profile is saved. */
export function AccountChip() {
  const [profile, setProfile] = useState<Profile>(NO_PROFILE);
  const [plan, setPlan] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/profile")
      .then((r) => r.json() as Promise<Profile>)
      .then((p) => alive && setProfile(p))
      .catch(() => undefined);
    fetch("/api/usage")
      .then((r) => (r.ok ? (r.json() as Promise<{ plan: PlanId | null }>) : null))
      .then((u) => alive && setPlan(u?.plan ? `${planById(u.plan).name} plan` : "No plan"))
      .catch(() => alive && setPlan("No plan"));
    const update = (e: Event) => setProfile((e as CustomEvent<Profile>).detail);
    window.addEventListener(PROFILE_EVENT, update);
    return () => {
      alive = false;
      window.removeEventListener(PROFILE_EVENT, update);
    };
  }, []);
  return (
    <Link href="/settings" className="flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-raised">
      <Avatar profile={profile} />
      <span className="min-w-0">
        <span className="block truncate text-[13.5px] font-semibold">{displayName(profile)}</span>
        <span className="block text-[12px] text-soft">{plan ?? " "}</span>
      </span>
    </Link>
  );
}
