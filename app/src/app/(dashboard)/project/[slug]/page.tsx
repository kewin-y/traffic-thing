import type { Metadata } from "next";
import { ProjectWorkspace } from "@/features/projects/components/project-workspace";

export const metadata: Metadata = { title: "Map project" };
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ProjectWorkspace slug={slug} />;
}
