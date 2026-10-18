"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateProjectDialog } from "@/features/projects/components/create-project-dialog";
const LegacyMapImport = dynamic(
  () =>
    import("@/features/projects/components/legacy-map-import").then(
      (mod) => mod.LegacyMapImport,
    ),
  { ssr: false },
);

export function DashboardView() {
  const { isAuthenticated } = useConvexAuth();
  const ownerId = useQuery(
    api.projects.queries.currentOwner,
    isAuthenticated ? {} : "skip",
  );
  const { results, status, loadMore } = usePaginatedQuery(
    api.projects.queries.list,
    isAuthenticated ? {} : "skip",
    { initialNumItems: 12 },
  );
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Your workspace
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Recent projects
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pick up where you left off, or start a new map.
          </p>
        </div>
        <CreateProjectDialog />
      </div>
      {ownerId && <LegacyMapImport key={ownerId} ownerId={ownerId} />}
      {status === "LoadingFirstPage" ? (
        <div
          aria-label="Loading projects"
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : results.length ? (
        <section
          aria-label="Recent projects"
          className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
        >
          {results.map((project) => (
            <Link
              key={project._id}
              href={`/project/${project.slug}`}
              className="group flex min-h-44 flex-col rounded-xl border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-primary"
            >
              <h2 className="break-words font-semibold group-hover:text-primary">
                {project.name}
              </h2>
              <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                {project.description || "Map project"}
              </p>
              <p className="mt-auto pt-6 text-xs text-muted-foreground">
                Edited{" "}
                <time dateTime={new Date(project.updatedAt).toISOString()}>
                  {new Date(project.updatedAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </time>
              </p>
            </Link>
          ))}
        </section>
      ) : (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed px-6 text-center">
          <h2 className="text-lg font-semibold">Your first map starts here</h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Create a project to design streets, select editable areas, and save
            your work.
          </p>
        </div>
      )}
      {(status === "CanLoadMore" || status === "LoadingMore") && (
        <Button
          variant="outline"
          className="self-center"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(12)}
        >
          {status === "LoadingMore" ? "Loading…" : "Load more projects"}
        </Button>
      )}
    </>
  );
}
