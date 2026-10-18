"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
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

function Edited({ project }: { project: Doc<"projects"> }) {
  return (
    <time dateTime={new Date(project.updatedAt).toISOString()}>
      {new Date(project.updatedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}
    </time>
  );
}
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
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div>
          <h1 className="text-[32px] leading-[38px] font-semibold tracking-[-0.04em]">
            Your projects
          </h1>
          <p className="mt-2 text-sm leading-[22px] text-muted-foreground">
            A place to try a different kind of city.
          </p>
        </div>
        <CreateProjectDialog label="+ New project" />
      </div>
      {ownerId && <LegacyMapImport key={ownerId} ownerId={ownerId} />}
      <div className="flex items-center justify-between border-b pb-4 text-xs">
        <h2 className="font-semibold">All projects</h2>
        <span className="text-muted-foreground">Last edited ↓</span>
      </div>
      {status === "LoadingFirstPage" ? (
        <div
          aria-label="Loading projects"
          className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
        >
          {[0, 1, 2].map((n) => (
            <Skeleton key={n} className="h-56 rounded-lg" />
          ))}
        </div>
      ) : results.length ? (
        <>
          <section
            aria-label="Recent projects"
            className="grid gap-6 md:grid-cols-2 lg:grid-cols-3"
          >
            {results.slice(0, 3).map((project) => (
              <Link
                key={project._id}
                href={`/project/${project.slug}`}
                className="group flex min-h-56 flex-col rounded-lg border p-6 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="mb-7 self-start rounded border bg-muted/40 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {project.network?.name.replaceAll("-", " / ") ??
                    "Map project"}
                </span>
                <h3 className="break-words text-lg font-medium tracking-tight">
                  {project.name}
                </h3>
                <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                  {project.description || "A new perspective on your streets."}
                </p>
                <div className="mt-auto flex items-center justify-between gap-2 pt-8 text-xs text-muted-foreground">
                  <span>
                    Edited <Edited project={project} />
                  </span>
                  <span
                    aria-hidden
                    className="text-base transition-transform group-hover:translate-x-1"
                  >
                    ↗
                  </span>
                </div>
              </Link>
            ))}
          </section>
          {results.length > 3 && (
            <section aria-label="More projects" className="mt-3">
              <div className="flex items-center justify-between border-b pb-4 text-xs">
                <h2 className="font-semibold">More projects</h2>
                <span className="text-muted-foreground">
                  Name / Last edited
                </span>
              </div>
              {results.slice(3).map((project) => (
                <Link
                  key={project._id}
                  href={`/project/${project.slug}`}
                  className="flex items-center gap-4 border-b py-5 text-sm transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span
                    aria-hidden
                    className="w-5 shrink-0 text-muted-foreground"
                  >
                    ↗
                  </span>
                  <h3 className="min-w-0 flex-1 truncate font-medium">
                    {project.name}
                  </h3>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    <Edited project={project} />
                  </span>
                </Link>
              ))}
            </section>
          )}
        </>
      ) : (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-dashed px-6 text-center">
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
