"use client";

import { useEffect, useState } from "react";
import Link from "@/components/pending-link";
import { Avatar } from "@/components/profile-view";
import { NO_PROFILE, PROFILE_EVENT, displayName, type Profile } from "@/lib/profile";
import { planById, type PlanId } from "@/lib/plans";
import { newestWrites } from "@/lib/account-loader";

// The last values this page saw: a remounted chip (moving between the studio and Settings) shows them at once
// while it refreshes. Memory only; signing out reloads the page, so they never outlive the session.
// Only the newest request writes them, even from a chip that has unmounted.
const lastProfile = newestWrites<Profile>();
const lastPlan = newestWrites<string>();

/** Bottom of the sidebar: who is signed in and their plan; opens Settings. Updates when the profile is saved. */
export function AccountChip() {
  const [profile, setProfile] = useState<Profile>(lastProfile.get() ?? NO_PROFILE);
  const [plan, setPlan] = useState<string | null>(lastPlan.get());
  useEffect(() => {
    let alive = true;
    const profileTicket = lastProfile.ticket();
    fetch("/api/profile")
      .then((r) => { if (!r.ok) throw Error("Profile unavailable"); return r.json() as Promise<Profile>; })
      .then((p) => { if (lastProfile.write(profileTicket, p) && alive) setProfile(p); })
      .catch(() => undefined);
    const planTicket = lastPlan.ticket();
    fetch("/api/usage")
      .then((r) => (r.ok ? (r.json() as Promise<{ plan: PlanId | null }>) : null))
      .then((u) => {
        const text = u?.plan ? `${planById(u.plan).name} plan` : "No plan";
        if (u ? lastPlan.write(planTicket, text) && alive : alive) setPlan(u ? text : lastPlan.get() ?? text);
      })
      .catch(() => alive && setPlan(lastPlan.get() ?? "No plan"));
    const update = (e: Event) => { const p = (e as CustomEvent<Profile>).detail; lastProfile.write(lastProfile.ticket(), p); setProfile(p); };
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
