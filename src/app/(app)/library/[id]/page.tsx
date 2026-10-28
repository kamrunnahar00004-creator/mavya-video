import { RouteSkeleton } from "@/components/route-skeleton";
import { Suspense } from "react";
import { ReferenceView } from "@/components/reference-view";

export default function ReferencePage() {
  return (
    <Suspense fallback={<RouteSkeleton path="/library/loading" />}>
      <ReferenceView />
    </Suspense>
  );
}
