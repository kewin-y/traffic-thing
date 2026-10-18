import { ConvexError } from "convex/values";
import type { ProjectState } from "../../../../shared/projects";
import { clearDraft, readDraft, writeDraft } from "./local-drafts";

export type SaveStatus = "saved" | "pending" | "saving" | "error" | "conflict";
export class ProjectAutosave {
  readonly initialState: ProjectState;
  private state: ProjectState;
  private saved: string;
  private revision: number;
  private status: SaveStatus = "saved";
  private message = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving = false;
  private active = false;
  private listeners = new Set<() => void>();

  constructor(
    private options: {
      key: string;
      state: ProjectState;
      revision: number;
      save: (state: ProjectState, revision: number) => Promise<number>;
    },
  ) {
    const draft = readDraft(options.key);
    this.initialState = this.state = draft?.state ?? options.state;
    this.saved = JSON.stringify(options.state);
    this.revision = options.revision;
    if (draft && JSON.stringify(draft.state) !== this.saved) {
      this.status =
        draft.revision === options.revision ? "pending" : "conflict";
      if (this.status === "conflict")
        this.message =
          "Your recovered changes are based on an older version. Download them before loading the latest project.";
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getStatus = () => this.status;
  getMessage = () => this.message;
  getState = () => this.state;
  getRevision = () => this.revision;
  isDirty = () => JSON.stringify(this.state) !== this.saved;
  private publish(status: SaveStatus, message = "") {
    this.status = status;
    this.message = message;
    for (const listener of this.listeners) listener();
  }
  start = () => {
    this.active = true;
    if (this.isDirty() && this.status !== "conflict") this.schedule();
  };
  stop = () => {
    clearTimeout(this.timer);
    // Send pending edits on client navigation; retain the draft until acknowledged.
    void this.flush(true);
    this.active = false;
    // The synchronous recovery draft survives navigation and browser closure.
  };
  update = (state: ProjectState) => {
    if (JSON.stringify(state) === JSON.stringify(this.state)) return;
    this.state = state;
    if (this.isDirty())
      writeDraft(this.options.key, { revision: this.revision, state });
    if (this.status === "conflict") return;
    this.publish(this.isDirty() ? "pending" : "saved");
    this.schedule();
  };
  private schedule() {
    clearTimeout(this.timer);
    if (this.active && this.isDirty() && !this.saving)
      this.timer = setTimeout(() => void this.flush(), 800);
  }
  discard = () => {
    clearTimeout(this.timer);
    this.saved = JSON.stringify(this.state);
    clearDraft(this.options.key);
    this.publish("saved");
  };
  retry = () => {
    if (this.status !== "conflict") void this.flush();
  };
  private async flush(allowInactive = false) {
    if (
      (!this.active && !allowInactive) ||
      this.saving ||
      !this.isDirty() ||
      this.status === "conflict"
    )
      return;
    this.saving = true;
    const state = this.state;
    this.publish("saving");
    try {
      this.revision = await this.options.save(state, this.revision);
      this.saved = JSON.stringify(state);
      if (this.isDirty()) {
        writeDraft(this.options.key, {
          revision: this.revision,
          state: this.state,
        });
        this.publish("pending");
      } else {
        clearDraft(this.options.key);
        this.publish("saved");
      }
    } catch (error) {
      const data = error instanceof ConvexError ? error.data : null;
      if (
        data &&
        typeof data === "object" &&
        "code" in data &&
        data.code === "CONFLICT"
      ) {
        this.publish(
          "conflict",
          "This project changed in another tab. Download your changes before loading the latest project.",
        );
      } else {
        this.publish(
          "error",
          typeof data === "string"
            ? data
            : "Couldn’t save your changes. A recovery draft is kept in this browser when storage is available.",
        );
      }
    } finally {
      this.saving = false;
      if (this.status === "pending") {
        if (this.active) this.schedule();
        else void this.flush(true);
      }
    }
  }
}
