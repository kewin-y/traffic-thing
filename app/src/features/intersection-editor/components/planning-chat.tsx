"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useUIMessages } from "@convex-dev/agent/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { chatOpSchema, type ChatOp } from "../../../../shared/chat";
import type { ProjectState } from "../../../../shared/projects";

export interface PlanningChatProps {
  projectId: Id<"projects">;
  getState: () => ProjectState;
  applyOps: (base: ProjectState, ops: ChatOp[]) => void;
}

export function PlanningChat({
  projectId,
  getState,
  applyOps,
}: PlanningChatProps) {
  const threadId = useQuery(api.assistant.queries.thread, { projectId });
  const { results, status, loadMore } = useUIMessages(
    api.assistant.queries.listMessages,
    threadId ? { projectId, threadId } : "skip",
    { initialNumItems: 30, stream: true },
  );
  const sendChat = useAction(api.assistant.actions.sendChat);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [results, busy, notice]);

  async function send() {
    const prompt = draft.trim();
    if (!prompt || prompt.length > 4000 || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    const base = getState();
    setDraft("");
    try {
      const result = await sendChat({ projectId, prompt, state: base });
      if (!mounted.current) return;
      const ops = chatOpSchema.array().max(40).parse(JSON.parse(result));
      if (ops.length) {
        applyOps(base, ops);
        setNotice("Map edits applied. Use Undo to reverse them.");
      }
    } catch (cause) {
      if (!mounted.current) return;
      const message =
        cause instanceof ConvexError && typeof cause.data === "string"
          ? cause.data
          : cause instanceof Error && !cause.message.includes("[CONVEX")
            ? cause.message
            : "The assistant could not reply. Please try again.";
      setError(message);
      setDraft((current) => current || prompt);
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <>
      <div
        className="min-h-0 flex-1 overflow-y-auto p-3 text-sm"
        role="log"
        aria-label="Planning conversation"
        aria-live="polite"
      >
        {threadId === undefined ||
        (threadId && status === "LoadingFirstPage") ? (
          <p className="text-muted-foreground">Loading conversation…</p>
        ) : results.length === 0 ? (
          <div className="mt-6 text-center text-muted-foreground">
            <p className="font-medium text-foreground">Planning assistant</p>
            <p className="mt-1 text-xs leading-relaxed">
              Ask about this plan, or describe a map edit. Changes can be
              undone.
            </p>
          </div>
        ) : (
          <>
            {status === "CanLoadMore" && (
              <Button size="sm" variant="ghost" onClick={() => loadMore(30)}>
                Load earlier messages
              </Button>
            )}
            <ul className="flex flex-col gap-2">
              {results.map((message) => {
                const text = message.parts
                  .filter((part) => part.type === "text")
                  .map((part) => part.text)
                  .join("");
                if (!text) return null;
                return (
                  <li
                    key={`${message.order}-${message.stepOrder}`}
                    className={
                      message.role === "user"
                        ? "ml-8 rounded-lg bg-primary px-3 py-2 break-words whitespace-pre-wrap text-primary-foreground"
                        : "mr-4 rounded-lg bg-muted px-3 py-2 break-words whitespace-pre-wrap"
                    }
                  >
                    <span className="mb-1 block text-xs font-medium">
                      {message.role === "user" ? "You" : "Assistant"}
                    </span>
                    {text}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {busy && (
          <p className="mt-3 text-xs text-muted-foreground" role="status">
            Assistant is working…
          </p>
        )}
        {notice && (
          <p className="mt-3 text-xs text-muted-foreground" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="mt-3 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor="planning-chat-input" className="sr-only">
          Message the planning assistant
        </label>
        <textarea
          id="planning-chat-input"
          rows={2}
          maxLength={4000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="Ask about this plan…"
          className="min-h-9 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button
          type="submit"
          size="sm"
          disabled={busy || threadId === undefined || !draft.trim()}
        >
          {busy ? "Working…" : "Send"}
        </Button>
      </form>
    </>
  );
}
