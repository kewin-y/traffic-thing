import type { Metadata } from "next";
import { EditorLoader } from "@/features/intersection-editor/components/editor-loader";

export const metadata: Metadata = { title: "Intersection editor" };

export default function EditorPage() {
  return (
    <div className="h-[calc(100svh-9rem)]">
      <EditorLoader />
    </div>
  );
}
