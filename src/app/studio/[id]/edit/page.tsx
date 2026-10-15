import { redirect } from "next/navigation";
import { Suspense } from "react";

/** Old bookmarks open the shared clip editor in the run's five-step studio. */
async function RedirectToStudio({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return redirect(`/studio/${id}`);
}

export default function EditPage({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={null}><RedirectToStudio params={params} /></Suspense>;
}
