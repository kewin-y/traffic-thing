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
}: {
  history: ReturnType<typeof useSimulationHistory>;
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
  return (
    <section
      className="space-y-3 rounded-xl border p-4"
      aria-label="Simulation history"
    >
      <h2 className="font-semibold">Simulation history</h2>
      <p className="text-xs text-muted-foreground">
        Baseline runs use synthetic demand. Map edits are preserved in each
        snapshot for future support.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {history.status === "LoadingFirstPage" ? (
        <p className="text-sm">Loading runs…</p>
      ) : history.results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No simulations yet.</p>
      ) : (
        history.results.map((run) => (
          <article key={run._id} className="space-y-2 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {run.status.charAt(0).toUpperCase() + run.status.slice(1)} ·{" "}
                {run.settings.durationSeconds}s · seed {run.settings.seed}
              </p>
              <time
                className="text-xs text-muted-foreground"
                dateTime={new Date(run._creationTime).toISOString()}
              >
                {new Date(run._creationTime).toLocaleString()}
              </time>
            </div>
            <p className="text-xs text-muted-foreground">
              {run.network.name} · {run.network.version} · revision{" "}
              {run.projectRevision}
              {run.attempts > 0 ? ` · attempt ${run.attempts}/5` : ""}
            </p>
            {run.status === "queued" && (
              <p role="status" className="text-xs">
                Waiting for the worker…
                {run.error ? " Retrying after a worker error." : ""}
              </p>
            )}
            {run.status === "running" && (
              <p role="status" className="text-xs">
                Simulation in progress…
              </p>
            )}
            {run.error && run.status === "failed" && (
              <p role="alert" className="text-sm text-destructive">
                {run.error}
              </p>
            )}
            {run.result && (
              <>
                <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  {Object.entries({
                    Completed: run.result.completed,
                    Departed: run.result.departed,
                    Running: run.result.running,
                    Pending: run.result.pending,
                    "Avg. trip": seconds(run.result.averageTripDurationSeconds),
                    "Avg. waiting": seconds(
                      run.result.averageWaitingTimeSeconds,
                    ),
                    "Avg. time lost": seconds(
                      run.result.averageTimeLossSeconds,
                    ),
                  }).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-muted-foreground">
                  Averages cover completed trips. {run.result.sumoVersion}.
                </p>
              </>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void download(run, false)}
              >
                Download snapshot
              </Button>
              {run.recordingStorageId && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void download(run, true)}
                >
                  Download recording
                </Button>
              )}
            </div>
          </article>
        ))
      )}
      {history.status === "CanLoadMore" && (
        <Button variant="outline" onClick={() => history.loadMore(8)}>
          Load older runs
        </Button>
      )}
    </section>
  );
}
function seconds(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}s`;
}
