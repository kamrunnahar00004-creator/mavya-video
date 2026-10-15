"use client";

import dynamic from "next/dynamic";

// The editor drives video elements and pointer drags, so it only renders in the browser.
export const EditorLoader = dynamic(() => import("@/components/editor").then((m) => m.Editor), { ssr: false });
