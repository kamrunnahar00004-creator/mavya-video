import { Suspense } from "react";
import { EditorLoader } from "@/components/editor-loader";

export default function EditPage() {
  return (
    <Suspense fallback={null}>
      <EditorLoader />
    </Suspense>
  );
}
