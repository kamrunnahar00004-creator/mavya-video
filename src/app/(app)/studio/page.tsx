import { preload } from "react-dom";
import { RunsList } from "@/components/runs-list";
import { URL_CATALOG } from "@/lib/library-cache";

export default function StudioPage() {
  // Start the hook library request with the HTML, not after the scripts load; loadLibrary() picks up this response.
  preload(URL_CATALOG, { as: "fetch", crossOrigin: "anonymous" });
  return <RunsList />;
}
