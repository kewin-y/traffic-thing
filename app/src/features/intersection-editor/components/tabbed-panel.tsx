"use client";

import { useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const PANEL_MIN_WIDTH = 240;
export const PANEL_MAX_WIDTH = 640;
export const PANEL_DEFAULT_WIDTH = 288;

/** Shared, resizable map panel. Keep tab contents mounted to retain their state. */
export function TabbedPanel<T extends string>({
  side,
  label,
  open,
  onOpenChange,
  value,
  onValueChange,
  width,
  onWidthChange,
  tabs,
}: {
  side: "left" | "right";
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: T;
  onValueChange: (value: T) => void;
  width: number;
  onWidthChange: (width: number) => void;
  tabs: ReadonlyArray<{ value: T; label: string; content: ReactNode }>;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const id = useId();
  function resizeTo(next: number) {
    const available = panelRef.current?.parentElement?.clientWidth ?? Infinity;
    const max = Math.max(
      Math.min(PANEL_MIN_WIDTH, available - 40),
      Math.min(PANEL_MAX_WIDTH, available - 240),
    );
    onWidthChange(
      Math.round(Math.max(Math.min(PANEL_MIN_WIDTH, max), Math.min(max, next))),
    );
  }
  return (
    <aside
      ref={panelRef}
      aria-label={label}
      style={{ width, maxWidth: "calc(100% - 40px)" }}
      className={cn(
        "absolute inset-y-0 z-20 flex flex-col bg-background/95 shadow-xl backdrop-blur transition-transform duration-300 ease-out",
        side === "left" ? "left-0 border-r" : "right-0 border-l",
        !open && (side === "left" ? "-translate-x-full" : "translate-x-full"),
      )}
    >
      {open && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize ${label.toLowerCase()}`}
          aria-valuemin={PANEL_MIN_WIDTH}
          aria-valuemax={PANEL_MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          title="Drag to resize"
          className={cn(
            "absolute inset-y-0 z-10 w-2 cursor-ew-resize touch-none transition-colors hover:bg-primary/30 focus-visible:bg-primary/30 focus-visible:outline-none",
            side === "left"
              ? "right-0 translate-x-1/2"
              : "left-0 -translate-x-1/2",
          )}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const bounds =
              panelRef.current?.parentElement?.getBoundingClientRect();
            if (bounds)
              resizeTo(
                side === "left"
                  ? event.clientX - bounds.left
                  : bounds.right - event.clientX,
              );
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            resizeTo(
              width +
                (event.key === (side === "left" ? "ArrowRight" : "ArrowLeft")
                  ? 16
                  : -16),
            );
          }}
        />
      )}
      <button
        type="button"
        aria-label={`${open ? "Hide" : "Show"} ${label.toLowerCase()}`}
        aria-expanded={open}
        aria-controls={`${id}-content`}
        title={`${open ? "Hide" : "Show"} panel`}
        onClick={() => onOpenChange(!open)}
        className={cn(
          "absolute top-1/2 flex h-16 w-7 -translate-y-1/2 items-center justify-center border bg-background/95 text-lg text-muted-foreground shadow-md backdrop-blur hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
          side === "left"
            ? "-right-7 rounded-r-lg border-l-0"
            : "-left-7 rounded-l-lg border-r-0",
        )}
      >
        {side === "left" ? (open ? "‹" : "›") : open ? "›" : "‹"}
      </button>
      <div
        id={`${id}-content`}
        inert={!open}
        aria-hidden={!open}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          role="tablist"
          aria-label={`${label} sections`}
          className="m-3 mb-0 flex shrink-0 rounded-lg bg-muted p-1"
        >
          {tabs.map((tab, index) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              id={`${id}-tab-${tab.value}`}
              aria-selected={value === tab.value}
              aria-controls={`${id}-panel-${tab.value}`}
              tabIndex={value === tab.value ? 0 : -1}
              onClick={() => onValueChange(tab.value)}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight"
                    ? (index + 1) % tabs.length
                    : event.key === "ArrowLeft"
                      ? (index - 1 + tabs.length) % tabs.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? tabs.length - 1
                          : null;
                if (next === null) return;
                event.preventDefault();
                onValueChange(tabs[next].value);
                document
                  .getElementById(`${id}-tab-${tabs[next].value}`)
                  ?.focus();
              }}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-ring",
                value === tab.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {tabs.map((tab) => (
          <div
            key={tab.value}
            role="tabpanel"
            id={`${id}-panel-${tab.value}`}
            aria-labelledby={`${id}-tab-${tab.value}`}
            hidden={value !== tab.value}
            className={cn(
              "min-h-0 flex-1 flex-col",
              value === tab.value ? "flex" : "hidden",
            )}
          >
            {tab.content}
          </div>
        ))}
      </div>
    </aside>
  );
}
