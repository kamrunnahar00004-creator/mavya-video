import { RouteSkeleton } from "@/components/route-skeleton";
import { Suspense } from "react";
import { RunView } from "@/components/run-view";

export default function RunPage() {
  return (
    <Suspense fallback={<RouteSkeleton path="/studio/loading" />}>
      <RunView />
    </Suspense>
  );
}
