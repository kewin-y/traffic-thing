import type { Metadata } from "next";
import { EditorLoader } from "@/features/intersection-editor/components/editor-loader";

export const metadata: Metadata = { title: "Intersection editor" };

// The prototype opens straight into the 3D editor; no sign-in needed.
export default function HomePage() {
  return (
    <main className="h-svh p-3">
      <EditorLoader />
    </main>
  );
}
