"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Skeleton } from "@/components/ui/skeleton";

const ProjectSession = dynamic(
  () => import("./project-session").then((mod) => mod.ProjectSession),
  { ssr: false, loading: () => <Skeleton className="h-[70svh] rounded-xl" /> },
);
export function ProjectWorkspace({ slug }: { slug: string }) {
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(
    api.projects.queries.get,
    isAuthenticated ? { slug } : "skip",
  );
  if (data === undefined)
    return (
      <Skeleton aria-label="Loading project" className="h-[70svh] rounded-xl" />
    );
  if (data === null)
    return (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">Project not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This project is unavailable or you don’t have access to it.
        </p>
        <Link
          className="mt-5 inline-block underline underline-offset-4"
          href="/dashboard"
        >
          Back to projects
        </Link>
      </div>
    );
  return <ProjectSession key={data.project._id} data={data} />;
}
