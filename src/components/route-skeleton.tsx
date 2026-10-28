/** Shared by streamed route boundaries and immediate client navigation feedback. */
export function RouteSkeleton({ path = "/studio" }: { path?: string }) {
  const settings = path.startsWith("/settings");
  const detail = /^\/(studio|library)\/[^/]+/.test(path);
  const library = path.startsWith("/library");
  return (
    <div role="status" aria-label="Loading page" aria-busy="true" className="card flex h-full flex-col overflow-hidden bg-panel" data-route-skeleton={path}>
      <div className={settings ? `mx-auto w-full px-6 pt-10 ${path === "/settings/plans" ? "max-w-[1180px]" : "max-w-[760px]"}` : "border-b border-line px-6 py-4"}>
        <div className="shimmer h-7 w-40 rounded-lg" />
        {settings && <div className="mt-3 h-5 w-64 rounded bg-raised" />}
      </div>
      {detail ? (
        <div className="flex min-h-0 flex-1 gap-6 p-6">
          <div className="min-w-0 flex-1 space-y-5">{[0, 1, 2].map(i => <div key={i} className="shimmer h-32 rounded-xl" />)}</div>
          <div className="shimmer aspect-[9/16] max-h-full w-[30%] shrink-0 rounded-2xl" />
        </div>
      ) : settings ? (
        <div className="mx-auto w-full max-w-[760px] space-y-6 px-6 pt-10">{[0, 1, 2].map(i => <div key={i} className="shimmer h-24 rounded-xl" />)}</div>
      ) : (
        <div className={`grid content-start gap-3 p-6 ${library ? "mx-auto w-full max-w-[1100px] grid-cols-[repeat(auto-fill,minmax(132px,1fr))]" : "grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-5"}`}>
          {Array.from({ length: library ? 12 : 4 }, (_, i) => <div key={i} className="shimmer aspect-[9/16] rounded-xl" />)}
        </div>
      )}
    </div>
  );
}
