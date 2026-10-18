"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PanelTab = "tools" | "chat";

/** Limits, in pixels, for dragging the panel wider or narrower. */
export const PANEL_MIN_WIDTH = 240;
export const PANEL_MAX_WIDTH = 640;
export const PANEL_DEFAULT_WIDTH = 288;
/** Map space the panel always leaves free when dragged wide. */
const MAP_MIN_WIDTH = 240;
const KEY_STEP = 16;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  width: number;
  onWidthChange: (width: number) => void;
  /** Contents of the Tools tab. */
  tools: React.ReactNode;
}

const TABS: { id: PanelTab; label: string }[] = [
  { id: "tools", label: "Tools" },
  { id: "chat", label: "Chat" },
];

/** Slide-out panel on the right of the map, with Tools and Chat tabs. */
export function SidePanel({
  open,
  onOpenChange,
  tab,
  onTabChange,
  width,
  onWidthChange,
  tools,
}: Props) {
  const panelRef = useRef<HTMLElement>(null);

  /** Clamp a width to the limits and to the map's own size. */
  function resizeTo(next: number) {
    const mapWidth = panelRef.current?.parentElement?.clientWidth ?? Infinity;
    const max = Math.min(PANEL_MAX_WIDTH, mapWidth - MAP_MIN_WIDTH);
    onWidthChange(Math.round(Math.max(PANEL_MIN_WIDTH, Math.min(max, next))));
  }

  return (
    <aside
      ref={panelRef}
      aria-label="Planning panel"
      style={{ width }}
      className={cn(
        "absolute inset-y-0 right-0 z-20 flex flex-col border-l bg-background/95 shadow-xl backdrop-blur transition-transform duration-300 ease-out",
        !open && "translate-x-full",
      )}
    >
      {open && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          aria-valuemin={PANEL_MIN_WIDTH}
          aria-valuemax={PANEL_MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          title="Drag to resize"
          className="absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-ew-resize touch-none transition-colors hover:bg-primary/30 focus-visible:bg-primary/30 focus-visible:outline-none"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const right =
              panelRef.current?.parentElement?.getBoundingClientRect().right;
            if (right !== undefined) resizeTo(right - event.clientX);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") resizeTo(width + KEY_STEP);
            else if (event.key === "ArrowRight") resizeTo(width - KEY_STEP);
          }}
        />
      )}
      <button
        type="button"
        aria-label={open ? "Hide panel" : "Show panel"}
        aria-expanded={open}
        title={open ? "Hide panel" : "Show panel"}
        onClick={() => onOpenChange(!open)}
        className="absolute top-1/2 -left-7 flex h-16 w-7 -translate-y-1/2 items-center justify-center rounded-l-lg border border-r-0 bg-background/95 text-lg text-muted-foreground shadow-md backdrop-blur hover:text-foreground"
      >
        {open ? "›" : "‹"}
      </button>

      <div
        role="tablist"
        aria-label="Panel sections"
        className="m-3 mb-0 grid grid-cols-2 rounded-lg bg-muted p-1"
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`panel-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            onClick={() => onTabChange(id)}
            className={cn(
              "rounded-md py-1.5 text-sm font-medium transition",
              tab === id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`panel-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {tab === "tools" ? (
          <div className="flex flex-col gap-1.5 overflow-y-auto p-3">
            {tools}
          </div>
        ) : (
          <ChatTab />
        )}
      </div>
    </aside>
  );
}

interface Message {
  id: string;
  text: string;
}

/**
 * Chat with the planning assistant. Front end only for now: messages are
 * kept in this session and no assistant is connected to answer them.
 */
function ChatTab() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  function send() {
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [...current, { id: crypto.randomUUID(), text }]);
    setDraft("");
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">
        {messages.length === 0 ? (
          <div className="mt-6 text-center text-muted-foreground">
            <p className="font-medium text-foreground">Planning assistant</p>
            <p className="mt-1 text-xs leading-relaxed">
              Ask about the area you are editing, such as how a new signal or a
              turn ban could affect congestion.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {messages.map((message) => (
              <li
                key={message.id}
                className="ml-8 rounded-lg rounded-br-sm bg-primary px-3 py-2 break-words whitespace-pre-wrap text-primary-foreground"
              >
                {message.text}
              </li>
            ))}
            <li className="mr-8 rounded-lg rounded-bl-sm bg-muted px-3 py-2 text-xs text-muted-foreground">
              The assistant isn&apos;t connected yet, so there&apos;s no reply.
            </li>
          </ul>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="flex items-end gap-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label htmlFor="planning-chat-input" className="sr-only">
          Message the planning assistant
        </label>
        <textarea
          id="planning-chat-input"
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="Ask about this plan…"
          className="min-h-9 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Button type="submit" size="sm" disabled={!draft.trim()}>
          Send
        </Button>
      </form>
    </>
  );
}
