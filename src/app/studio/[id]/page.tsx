import { Suspense } from "react";
import { RunView } from "@/components/run-view";

export default function RunPage() {
  return (
    <Suspense fallback={null}>
      <RunView />
    </Suspense>
  );
}
