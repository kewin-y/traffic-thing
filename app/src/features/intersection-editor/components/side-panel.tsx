"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TabbedPanel } from "./tabbed-panel";
export { PANEL_DEFAULT_WIDTH } from "./tabbed-panel";
export type PanelTab = "tools" | "chat";
export function SidePanel({
  open,
  onOpenChange,
  tab,
  onTabChange,
  width,
  onWidthChange,
  tools,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  width: number;
  onWidthChange: (width: number) => void;
  tools: React.ReactNode;
}) {
  return (
    <TabbedPanel
      side="right"
      label="Planning panel"
      open={open}
      onOpenChange={onOpenChange}
      value={tab}
      onValueChange={onTabChange}
      width={width}
      onWidthChange={onWidthChange}
      tabs={[
        {
          value: "tools",
          label: "Tools",
          content: (
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3">
              {tools}
            </div>
          ),
        },
        { value: "chat", label: "Chat", content: <ChatTab /> },
      ]}
    />
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
