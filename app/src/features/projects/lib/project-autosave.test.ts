import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ConvexError } from "convex/values";
import { ProjectAutosave } from "./project-autosave";
import { emptyProjectState } from "../../../../shared/projects";

let storage: Map<string, string>;
beforeEach(() => {
  vi.useFakeTimers();
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function changed(zoom = 18) {
  return {
    ...emptyProjectState(),
    camera: { ...emptyProjectState().camera, zoom },
  };
}

test("rapid edits debounce and an unchanged initial mount never writes", async () => {
  const save = vi.fn().mockResolvedValue(1);
  const controller = new ProjectAutosave({
    key: "draft",
    state: emptyProjectState(),
    revision: 0,
    save,
  });
  controller.start();
  controller.update(emptyProjectState());
  await vi.advanceTimersByTimeAsync(1000);
  expect(save).not.toHaveBeenCalled();
  controller.update(changed(18));
  await vi.advanceTimersByTimeAsync(500);
  controller.update(changed(19));
  await vi.advanceTimersByTimeAsync(799);
  expect(save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(save).toHaveBeenCalledExactlyOnceWith(changed(19), 0);
  expect(controller.getStatus()).toBe("saved");
  expect(storage.has("draft")).toBe(false);
  controller.stop();
});

test("edits made during an in-flight save use the newly acknowledged revision", async () => {
  let complete!: (revision: number) => void;
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue(2);
  const controller = new ProjectAutosave({
    key: "draft",
    state: emptyProjectState(),
    revision: 0,
    save,
  });
  controller.start();
  controller.update(changed(18));
  await vi.advanceTimersByTimeAsync(800);
  controller.update(changed(19));
  complete(1);
  await vi.advanceTimersByTimeAsync(800);
  expect(save).toHaveBeenNthCalledWith(2, changed(19), 1);
  expect(controller.getStatus()).toBe("saved");
  expect(storage.has("draft")).toBe(false);
  controller.stop();
});

test("navigation sends pending edits while keeping a recoverable draft until acknowledged", async () => {
  const save = vi
    .fn()
    .mockImplementationOnce(() => new Promise<number>(() => {}))
    .mockResolvedValue(1);
  const first = new ProjectAutosave({
    key: "draft",
    state: emptyProjectState(),
    revision: 0,
    save,
  });
  first.start();
  first.update(changed());
  first.stop();
  await vi.advanceTimersByTimeAsync(1000);
  expect(save).toHaveBeenCalledExactlyOnceWith(changed(), 0);
  expect(storage.has("draft")).toBe(true);
  save.mockClear();
  const reopened = new ProjectAutosave({
    key: "draft",
    state: emptyProjectState(),
    revision: 0,
    save,
  });
  expect(reopened.initialState).toEqual(changed());
  reopened.start();
  await vi.advanceTimersByTimeAsync(800);
  expect(save).toHaveBeenCalledExactlyOnceWith(changed(), 0);
  reopened.stop();
});

test("conflicts preserve local work and never retry against a newer revision", async () => {
  const save = vi.fn().mockRejectedValue(new ConvexError({ code: "CONFLICT" }));
  const controller = new ProjectAutosave({
    key: "draft",
    state: emptyProjectState(),
    revision: 0,
    save,
  });
  controller.start();
  controller.update(changed());
  await vi.advanceTimersByTimeAsync(800);
  expect(controller.getStatus()).toBe("conflict");
  controller.retry();
  controller.update(changed(19));
  await vi.advanceTimersByTimeAsync(2000);
  expect(save).toHaveBeenCalledTimes(1);
  expect(JSON.parse(storage.get("draft")!).state).toEqual(changed(19));
  controller.stop();
  const reopened = new ProjectAutosave({
    key: "draft",
    state: changed(20),
    revision: 1,
    save,
  });
  expect(reopened.getStatus()).toBe("conflict");
  expect(reopened.initialState).toEqual(changed(19));
  reopened.start();
  reopened.retry();
  await vi.advanceTimersByTimeAsync(1000);
  expect(save).toHaveBeenCalledTimes(1);
  reopened.stop();
});

test("save failures keep the draft and can be retried", async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(1);
  const controller = new ProjectAutosave({
    key: "draft",
    state: emptyProjectState(),
    revision: 0,
    save,
  });
  controller.start();
  controller.update(changed());
  await vi.advanceTimersByTimeAsync(800);
  expect(controller.getStatus()).toBe("error");
  expect(storage.has("draft")).toBe(true);
  controller.retry();
  await vi.advanceTimersByTimeAsync(0);
  expect(controller.getStatus()).toBe("saved");
  expect(save).toHaveBeenLastCalledWith(changed(), 0);
  controller.stop();
});

test("discard clears recovery and prevents flushing discarded edits on reload", () => {
  const save = vi.fn();
  const controller = new ProjectAutosave({
    key: "draft",
    state: emptyProjectState(),
    revision: 0,
    save,
  });
  controller.start();
  controller.update(changed());
  controller.discard();
  controller.stop();
  expect(controller.isDirty()).toBe(false);
  expect(storage.has("draft")).toBe(false);
  expect(save).not.toHaveBeenCalled();
});

test("navigation during an in-flight save drains the newer edits afterward", async () => {
  let complete!: (revision: number) => void;
  const save = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          complete = resolve;
        }),
    )
    .mockResolvedValue(2);
  const controller = new ProjectAutosave({
    key: "draft",
    state: emptyProjectState(),
    revision: 0,
    save,
  });
  controller.start();
  controller.update(changed(18));
  await vi.advanceTimersByTimeAsync(800);
  controller.update(changed(19));
  controller.stop();
  complete(1);
  await vi.advanceTimersByTimeAsync(0);
  expect(save).toHaveBeenNthCalledWith(2, changed(19), 1);
  expect(controller.getStatus()).toBe("saved");
  expect(storage.has("draft")).toBe(false);
});
