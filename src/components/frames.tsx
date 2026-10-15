/** "Phone filming the laptop": the screen recording on a tilted laptop, filmed handheld. */
export function LaptopFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: "radial-gradient(120% 80% at 50% 30%, #57534e 0%, #292524 55%, #0c0a09 100%)" }}>
      <div className="handheld absolute inset-0 flex items-center justify-center" style={{ perspective: "700px" }}>
        <div className="w-[104%]" style={{ transform: "rotateX(14deg) rotateY(-9deg) rotateZ(-1.5deg)" }}>
          <div className="rounded-t-[8px] bg-[#111] p-[5px] pb-[7px] shadow-2xl">
            <div className="relative aspect-[16/10] overflow-hidden rounded-[3px] bg-white">
              {children}
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: "linear-gradient(115deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.08) 100%)" }}
              />
            </div>
          </div>
          <div className="mx-[-6%] h-[10px] rounded-b-[10px] bg-gradient-to-b from-[#9ca3af] to-[#4b5563]" />
        </div>
      </div>
      <div className="pointer-events-none absolute inset-0" style={{ boxShadow: "inset 0 0 60px rgba(0,0,0,0.6)" }} />
    </div>
  );
}

/** Stand-in for an AI person until the avatar model is connected. */
export function AvatarPlaceholder({ tones, label }: { tones: [string, string]; label?: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: `linear-gradient(160deg, ${tones[0]}, ${tones[1]})` }}>
      <div className="absolute left-1/2 top-[22%] h-[28%] w-[36%] -translate-x-1/2 rounded-full bg-black/20" />
      <div className="absolute bottom-0 left-1/2 h-[40%] w-[78%] -translate-x-1/2 rounded-t-[50%] bg-black/20" />
      {label && <span className="absolute left-2 top-2 rounded-md bg-black/45 px-1.5 py-0.5 text-[10px] font-bold text-white">{label}</span>}
    </div>
  );
}
