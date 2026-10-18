"use client";

import Link from "next/link";
import { SimulateDialog } from "@/features/simulations/components/simulate-dialog";
import {
  SimulationHistory,
  useSimulationHistory,
} from "@/features/simulations/components/simulation-history";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
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
  const active = history.results.some(
    (run) => run.status === "queued" || run.status === "running",
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
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/dashboard"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← All projects
          </Link>
          <h1 className="mt-1 break-words text-xl font-semibold">
            {session.project.name}
          </h1>
        </div>
        <p
          role="status"
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
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
        <SimulateDialog
          projectId={session.project._id}
          autosave={session.autosave}
          saved={status === "saved"}
          hasNetwork={Boolean(session.project.network)}
          active={active}
        />
      </div>
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
      <div className="h-[calc(100svh-15rem)] min-h-[560px]">
        <EditorLoader
          initialState={session.autosave.initialState}
          networkReference={session.project.network}
          onStateChange={session.autosave.update}
        />
      </div>
      <SimulationHistory history={history} />
    </div>
  );
}
