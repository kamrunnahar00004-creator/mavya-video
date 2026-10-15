import { redirect } from "next/navigation";

/** Old bookmarks open the shared clip editor in the run's five-step studio. */
export default async function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/studio/${id}`);
}
