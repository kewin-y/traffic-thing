"use client";
import { useState } from "react";
import { useConvex, usePaginatedQuery } from "convex/react";
import type { Id } from "@/convex/_generated/dataModel";
import type { Doc } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";

export function useSimulationHistory(projectId: Id<"projects">) {
  return usePaginatedQuery(
    api.simulations.queries.list,
    { projectId },
    { initialNumItems: 8 },
  );
}
export function SimulationHistory({
  history,
  selectedRunId,
  onSelect,
}: {
  history: ReturnType<typeof useSimulationHistory>;
  selectedRunId: Id<"simulationRuns"> | null;
  onSelect: (runId: Id<"simulationRuns">) => void;
}) {
  const convex = useConvex();
  const [error, setError] = useState<string | null>(null);
  async function download(run: Doc<"simulationRuns">, recording: boolean) {
    setError(null);
    try {
      if (recording) {
        const url = await convex.query(api.simulations.queries.recordingUrl, {
          runId: run._id,
        });
        if (!url) throw new Error();
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `simulation-${run._id}.json.gz`;
        anchor.rel = "noopener";
        anchor.click();
      } else {
        const state = await convex.query(api.simulations.queries.snapshot, {
          runId: run._id,
        });
        if (!state) throw new Error();
        const url = URL.createObjectURL(
          new Blob([JSON.stringify({ run, state }, null, 2)], {
            type: "application/json",
          }),
        );
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `simulation-${run._id}-snapshot.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      setError("Couldn’t download this run. Please try again.");
    }
  }
  const selected = selectedRunId ?? history.results[0]?._id;
  return (
    <section aria-label="Project simulation runs" className="py-2">
      {error && (
        <p role="alert" className="px-5 py-3 text-xs text-destructive">
          {error}
        </p>
      )}
      {history.status === "LoadingFirstPage" ? (
        <p role="status" className="px-5 py-8 text-sm text-muted-foreground">
          Loading runs…
        </p>
      ) : history.results.length === 0 ? (
        <div className="px-5 py-10">
          <h3 className="text-sm font-medium">Your first run starts here</h3>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Run a simulation to see its progress and results alongside your map.
          </p>
        </div>
      ) : (
        history.results.map((run) => {
          const expanded = selected === run._id;
          const statusLabel = {
            queued: "Queued",
            running: "Running",
            succeeded: "Completed",
            failed: "Failed",
          }[run.status];
          const color = {
            queued: "bg-amber-500",
            running: "animate-pulse bg-amber-500",
            succeeded: "bg-emerald-600",
            failed: "bg-destructive",
          }[run.status];
          return (
            <article key={run._id} className="border-b last:border-b-0">
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`run-${run._id}`}
                onClick={() => onSelect(run._id)}
                className={`flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${expanded ? "bg-muted/50" : ""}`}
              >
                <span className="flex w-3 shrink-0 justify-center pt-1.5">
                  <span
                    aria-hidden
                    className={`size-1.5 rounded-full ${color}`}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium">
                      SUMO · {run.settings.durationSeconds}s
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {statusLabel}
                    </span>
                  </span>
                  <time
                    dateTime={new Date(run._creationTime).toISOString()}
                    className="mt-1.5 block text-[11px] text-muted-foreground"
                  >
                    {new Date(run._creationTime).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}{" "}
                    · seed {run.settings.seed}
                  </time>
                </span>
                <span
                  aria-hidden
                  className="w-3 shrink-0 pt-0.5 text-xs text-muted-foreground"
                >
                  {expanded ? "⌄" : "›"}
                </span>
              </button>
              {expanded && (
                <div id={`run-${run._id}`} className="space-y-4 px-5 pt-3 pb-5">
                  <p className="text-[11px] text-muted-foreground">
                    Saved revision {run.projectRevision}
                    {run.attempts > 0 ? ` · attempt ${run.attempts}/5` : ""}
                  </p>
                  {(run.status === "queued" || run.status === "running") && (
                    <p role="status" className="text-xs">
                      {run.status === "running"
                        ? "Simulation in progress…"
                        : run.error
                          ? "Worker unavailable. Retrying…"
                          : "Waiting for the worker…"}
                    </p>
                  )}
                  {run.status === "failed" && (
                    <p
                      role="alert"
                      className="text-xs leading-relaxed text-destructive"
                    >
                      {run.error ?? "Simulation failed."}
                    </p>
                  )}
                  {run.result && (
                    <>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
                        {Object.entries({
                          "Completed trips": run.result.completed,
                          Departed: run.result.departed,
                          "Still running": run.result.running,
                          Pending: run.result.pending,
                          "Avg. trip": seconds(
                            run.result.averageTripDurationSeconds,
                          ),
                          "Avg. waiting": seconds(
                            run.result.averageWaitingTimeSeconds,
                          ),
                          "Avg. time lost": seconds(
                            run.result.averageTimeLossSeconds,
                          ),
                        }).map(([label, value]) => (
                          <div key={label}>
                            <dt className="text-[11px] text-muted-foreground">
                              {label}
                            </dt>
                            <dd className="mt-1 text-base font-medium tabular-nums tracking-tight">
                              {value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">
                        Averages cover full trips arriving during the measured
                        window, including time before it when the worker uses
                        warm-up. {run.result.sumoVersion}.
                      </p>
                    </>
                  )}
                  <div className="flex flex-col gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full text-xs"
                      onClick={() => void download(run, false)}
                    >
                      Download snapshot{" "}
                      <span aria-hidden className="ml-auto">
                        ↓
                      </span>
                    </Button>
                    {run.recordingStorageId && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full text-xs"
                        onClick={() => void download(run, true)}
                      >
                        Download recording{" "}
                        <span aria-hidden className="ml-auto">
                          ↓
                        </span>
                      </Button>
                    )}
                  </div>
                  <p className="break-all font-mono text-[10px] text-muted-foreground">
                    {run.network.name} / {run.network.version}
                  </p>
                </div>
              )}
            </article>
          );
        })
      )}
      {(history.status === "CanLoadMore" ||
        history.status === "LoadingMore") && (
        <div className="p-4">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={history.status === "LoadingMore"}
            onClick={() => history.loadMore(8)}
          >
            {history.status === "LoadingMore" ? "Loading…" : "Load older runs"}
          </Button>
        </div>
      )}
    </section>
  );
}
function seconds(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}s`;
}
