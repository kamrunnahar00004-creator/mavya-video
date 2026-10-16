import { Suspense } from "react";
import { ReferenceView } from "@/components/reference-view";

export default function ReferencePage() {
  return (
    <Suspense fallback={null}>
      <ReferenceView />
    </Suspense>
  );
}
