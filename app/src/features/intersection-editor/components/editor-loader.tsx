"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// WebGL is browser-only, so the editor skips server rendering.
export const EditorLoader = dynamic(
  () => import("./intersection-editor").then((mod) => mod.IntersectionEditor),
  {
    ssr: false,
    loading: () => <Skeleton className="h-full min-h-0" />,
  },
);
