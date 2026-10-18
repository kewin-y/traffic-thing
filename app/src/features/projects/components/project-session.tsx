"use client";

import Link from "next/link";
import { TabbedPanel } from "@/features/intersection-editor/components/tabbed-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/features/auth/components/user-menu";
import { SimulateDialog } from "@/features/simulations/components/simulate-dialog";
import {
  SimulationHistory,
  useSimulationHistory,
} from "@/features/simulations/components/simulation-history";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { EditorLoader } from "@/features/intersection-editor/components/editor-loader";
import { ProjectAutosave } from "../lib/project-autosave";
import { downloadState, draftKey } from "../lib/local-drafts";
import { projectStateSchema } from "../../../../shared/projects";

type ProjectData = NonNullable<
  FunctionReturnType<typeof api.projects.queries.get>
>;
function sessionDraftKey(data: ProjectData) {
  let tab = "default";
  try {
    tab =
      sessionStorage.getItem("traffic-thing:editor-tab") ?? crypto.randomUUID();
    sessionStorage.setItem("traffic-thing:editor-tab", tab);
  } catch {
    /* Fall back to a project-scoped key. */
  }
  return `${draftKey(data.project.ownerId, data.project._id)}:${tab}`;
}
export function ProjectSession({ data }: { data: ProjectData }) {
  const history = useSimulationHistory(data.project._id);
  const [historyOpen, setHistoryOpen] = useState(
    () => window.matchMedia("(min-width: 1024px)").matches,
  );
  const [leftTab, setLeftTab] = useState<"components" | "history">(
    "components",
  );
  const [leftWidth, setLeftWidth] = useState(320);
  const [componentsTarget, setComponentsTarget] =
    useState<HTMLDivElement | null>(null);
  const [selectedRunId, setSelectedRunId] =
    useState<Id<"simulationRuns"> | null>(null);
  const [historyToolbar, setHistoryToolbar] = useState<HTMLDivElement | null>(
    null,
  );
  const active = history.results.some(
    (run) => run.status === "queued" || run.status === "running",
  );
  // Viewing the history plays the selected run back on the map.
  const shownRun =
    historyOpen && leftTab === "history"
      ? history.results.find(
          (run) => run._id === (selectedRunId ?? history.results[0]?._id),
        )
      : undefined;
  const shownId = shownRun?._id;
  const shownStatus = shownRun?.status;
  const shownRecorded = Boolean(shownRun?.recordingStorageId);
  const shownDuration = shownRun?.settings.durationSeconds ?? 0;
  const historyEmpty =
    historyOpen &&
    leftTab === "history" &&
    history.status !== "LoadingFirstPage" &&
    history.results.length === 0;
  const playbackRun = useMemo(
    () =>
      shownId && shownStatus
        ? {
            runId: shownId,
            status: shownStatus,
            recorded: shownRecorded,
            durationSeconds: shownDuration,
          }
        : historyEmpty
          ? ("no-runs" as const)
          : null,
    [shownId, shownStatus, shownRecorded, shownDuration, historyEmpty],
  );
  const save = useMutation(api.projects.mutations.save);
  // Keep this editor session stable while Convex publishes our own saves.
  const [session] = useState(() => {
    const key = sessionDraftKey(data);
    return {
      key,
      project: data.project,
      autosave: new ProjectAutosave({
        key,
        state: projectStateSchema.parse(data.state),
        revision: data.revision,
        save: (state, expectedRevision) =>
          save({ projectId: data.project._id, expectedRevision, state }),
      }),
    };
  });
  const status = useSyncExternalStore(
    session.autosave.subscribe,
    session.autosave.getStatus,
    session.autosave.getStatus,
  );
  useEffect(() => {
    session.autosave.start();
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (session.autosave.isDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    const online = () => session.autosave.retry();
    window.addEventListener("online", online);
    return () => {
      session.autosave.stop();
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("online", online);
    };
  }, [session]);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="z-40 flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-background px-4 py-2 sm:px-5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Link
            href="/dashboard"
            className="flex shrink-0 items-center gap-2 text-xs hover:underline"
          >
            <span aria-hidden>←</span> Projects
          </Link>
          <span aria-hidden className="h-5 w-px shrink-0 bg-border" />
          <h1
            className="max-w-32 truncate text-sm font-medium sm:max-w-64"
            title={session.project.name}
          >
            {session.project.name}
          </h1>
          <p
            role="status"
            aria-live="polite"
            className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground"
          >
            <span
              aria-hidden
              className={
                status === "saved"
                  ? "size-1.5 rounded-full bg-emerald-600"
                  : "size-1.5 rounded-full bg-amber-500"
              }
            />
            {
              {
                saved: "Saved",
                pending: "Unsaved changes",
                saving: "Saving…",
                error: "Couldn’t save",
                conflict: "Conflicting changes",
              }[status]
            }
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
          <div ref={setHistoryToolbar} className="flex items-center gap-1" />
          <SimulateDialog
            projectId={session.project._id}
            autosave={session.autosave}
            saved={status === "saved"}
            hasNetwork={Boolean(session.project.network)}
            active={active}
            onQueued={(runId) => {
              setSelectedRunId(runId);
              setLeftTab("history");
              setHistoryOpen(true);
            }}
          />
          <div className="hidden items-center gap-1 sm:flex">
            <ThemeToggle />
            <UserMenu compact />
          </div>
        </div>
      </header>
      <div className="shrink-0 bg-background px-3">
        {(status === "error" || status === "conflict") && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 p-3 text-sm"
          >
            <p className="flex-1">{session.autosave.getMessage()}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadState(session.autosave.getState())}
            >
              Download changes
            </Button>
            {status === "error" ? (
              <Button size="sm" onClick={session.autosave.retry}>
                Retry save
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (
                    !window.confirm(
                      "Discard your local changes and load the latest saved project? Download your changes first if you want to keep them.",
                    )
                  )
                    return;
                  session.autosave.discard();
                  window.location.reload();
                }}
              >
                Load latest
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="relative flex min-h-0 flex-1">
        <TabbedPanel
          side="left"
          label="Components and history panel"
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          value={leftTab}
          onValueChange={setLeftTab}
          width={leftWidth}
          onWidthChange={setLeftWidth}
          tabs={[
            {
              value: "components",
              label: "Components",
              content: (
                <div
                  ref={setComponentsTarget}
                  data-toolbox
                  aria-label="Component tools"
                  className="min-h-0 flex-1 overflow-y-auto"
                />
              ),
            },
            {
              value: "history",
              label: "History",
              content: (
                <>
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <SimulationHistory
                      history={history}
                      selectedRunId={selectedRunId}
                      onSelect={setSelectedRunId}
                    />
                  </div>
                  <p className="border-t px-5 py-3 text-[11px] leading-relaxed text-muted-foreground">
                    Runs use GCN car demand when available, with synthetic
                    walking, cycling and scooter trips. Imported-road closures
                    and lane-count changes affect runs; scenery is visual only.
                  </p>
                </>
              ),
            },
          ]}
        />
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <EditorLoader
              projectId={session.project._id}
              initialState={session.autosave.initialState}
              networkReference={session.project.network}
              onStateChange={session.autosave.update}
              historyToolbar={historyToolbar}
              componentsTarget={componentsTarget}
              leftPanelInset={historyOpen ? leftWidth + 12 : 12}
              playbackRun={playbackRun}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
