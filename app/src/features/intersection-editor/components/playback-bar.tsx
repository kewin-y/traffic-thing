"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { PlaybackClock } from "../lib/playback/clock";
import type { PlaybackStats } from "../lib/playback/scene";

const RATES = [0.5, 1, 2, 4, 8, 16];

function clockTime(seconds: number) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The timeline, disabled, while there is nothing to play yet: the run is
 * still simulating or loading, wasn't recorded, or there are no runs.
 */
export function PlaybackNotice({
  left,
  right,
  duration,
  busy,
  children,
}: {
  left: number;
  right: number;
  duration: number | null;
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label="Simulation playback"
      aria-disabled="true"
      className="absolute bottom-16 z-10 rounded-lg border bg-background/95 px-3 py-2 shadow-lg backdrop-blur"
      style={{ left, right }}
    >
      <div className="flex items-center gap-3 opacity-60">
        <Button
          size="icon-sm"
          variant="outline"
          disabled
          aria-label="Play simulation"
        >
          <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
            <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
          </svg>
        </Button>
        <span className="w-24 shrink-0 text-xs tabular-nums">
          0:00{" "}
          <span className="text-muted-foreground">
            / {duration === null ? "–:––" : clockTime(duration)}
          </span>
        </span>
        <input
          type="range"
          aria-label="Simulation time"
          disabled
          min={0}
          max={1}
          value={0}
          readOnly
          className="h-1.5 min-w-0 flex-1 accent-primary"
        />
        <div className="flex shrink-0 overflow-hidden rounded-md border">
          {RATES.map((r) => (
            <span key={r} className="px-1.5 py-0.5 text-[11px] tabular-nums">
              {r}×
            </span>
          ))}
        </div>
      </div>
      <p
        role="status"
        className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground"
      >
        {busy && (
          <span
            aria-hidden
            className="size-1.5 animate-pulse rounded-full bg-amber-500"
          />
        )}
        {children}
      </p>
    </div>
  );
}

/**
 * Scrub, play and speed up a recorded run. Scroll over the bar to step
 * through time. Only this bar re-renders as time advances.
 */
export function PlaybackBar({
  clock,
  stats,
  warmupSeconds,
  demandSource,
  left,
  right,
}: {
  clock: PlaybackClock;
  /** Counts of what is drawn right now, read a few times a second. */
  stats: () => PlaybackStats;
  warmupSeconds: number;
  demandSource: "model" | "mounted" | null;
  left: number;
  right: number;
}) {
  const playing = useSyncExternalStore(
    clock.subscribe,
    () => clock.playing,
    () => false,
  );
  const rate = useSyncExternalStore(
    clock.subscribe,
    () => clock.rate,
    () => 1,
  );
  const [time, setTime] = useState(() => clock.current());
  const [counts, setCounts] = useState<PlaybackStats>(stats);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let frame = 0;
    let lastCounts = 0;
    const tick = (now: number) => {
      setTime(clock.current());
      if (now - lastCounts > 250) {
        lastCounts = now;
        setCounts(stats());
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clock, stats]);

  // Wheel scrubbing needs a non-passive listener to keep the page still.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta =
        Math.abs(event.deltaY) > Math.abs(event.deltaX)
          ? event.deltaY
          : event.deltaX;
      const step = Math.max(1, clock.duration / 200);
      clock.seek(clock.current() + Math.sign(delta) * step);
    };
    bar.addEventListener("wheel", onWheel, { passive: false });
    return () => bar.removeEventListener("wheel", onWheel);
  }, [clock]);

  const kmh = (mps: number | null) =>
    mps === null ? "—" : `${Math.round(mps * 3.6)} km/h`;

  return (
    <div
      ref={barRef}
      role="group"
      aria-label="Simulation playback"
      className="absolute bottom-16 z-10 rounded-lg border bg-background/95 px-3 py-2 shadow-lg backdrop-blur"
      style={{ left, right }}
      onKeyDown={(event) => {
        if (event.key === " " && event.target === event.currentTarget) {
          event.preventDefault();
          if (clock.playing) clock.pause();
          else clock.play();
        }
      }}
    >
      <div className="flex items-center gap-3">
        <Button
          size="icon-sm"
          variant="outline"
          aria-label={playing ? "Pause playback" : "Play simulation"}
          title={playing ? "Pause" : "Play"}
          onClick={() => (playing ? clock.pause() : clock.play())}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
              <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
              <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
            </svg>
          )}
        </Button>
        <span className="w-24 shrink-0 text-xs tabular-nums">
          {clockTime(time)}{" "}
          <span className="text-muted-foreground">
            / {clockTime(clock.duration)}
          </span>
        </span>
        <input
          type="range"
          aria-label="Simulation time"
          aria-valuetext={`${clockTime(time)} of ${clockTime(clock.duration)}`}
          min={0}
          max={clock.duration}
          step={0.1}
          value={time}
          onChange={(event) => clock.seek(Number(event.target.value))}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary"
        />
        <div
          role="radiogroup"
          aria-label="Playback speed"
          className="flex shrink-0 overflow-hidden rounded-md border"
        >
          {RATES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={rate === r}
              onClick={() => clock.setRate(r)}
              className={`px-1.5 py-0.5 text-[11px] tabular-nums transition-colors ${
                rate === r
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`}
            >
              {r}×
            </button>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          <span className="font-medium text-foreground tabular-nums">
            {counts.car}
          </span>{" "}
          cars · avg {kmh(counts.carSpeed)}
        </span>
        <span>
          <span className="font-medium text-foreground tabular-nums">
            {counts.pedestrian}
          </span>{" "}
          simulated pedestrians
        </span>
        <span>
          <span className="font-medium text-foreground tabular-nums">
            {counts.bicycle}
          </span>{" "}
          cyclists
        </span>
        <span>
          <span className="font-medium text-foreground tabular-nums">
            {counts.scooter}
          </span>{" "}
          e-scooters
        </span>
        <span>{counts.resting} decorative people at rest</span>
        <span
          className="flex items-center gap-1.5"
          aria-label="Road speed relative to the limit"
        >
          <span
            aria-hidden
            className="h-1.5 w-8 rounded-full bg-gradient-to-r from-[#e5484d] via-[#f5a623] to-[#2bb673]"
          />
          congested → free-flowing
        </span>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {demandSource === "model"
          ? "GCN car demand"
          : demandSource === "mounted"
            ? "Mounted car demand"
            : "Recorded car demand"}
        {` · ${warmupSeconds}s warm-up · Recorded agents over the current map layout.`}
      </p>
    </div>
  );
}
