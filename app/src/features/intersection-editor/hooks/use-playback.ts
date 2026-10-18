"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { projectStateSchema } from "../../../../shared/projects";
import { NETWORK_SOURCE } from "../lib/network";
import { PlaybackClock } from "../lib/playback/clock";
import { PlaybackScene } from "../lib/playback/scene";
import {
  congestionAt,
  loadTimeline,
  UnsupportedTimelineError,
  type Timeline,
} from "../lib/playback/timeline";
import {
  basemapPlaces,
  restingPeople,
  type BasemapPlaces,
} from "../lib/street-life/ambient";
import type { Frame } from "../lib/street-life/frame";
import { STREET_LIFE_LAYER, StreetLifeLayer } from "../lib/street-life/layer";

/** The simulation run whose playback is on screen. */
export interface PlaybackRun {
  runId: Id<"simulationRuns">;
  status: "queued" | "running" | "succeeded" | "failed";
  recorded: boolean;
  durationSeconds: number;
}

type Loaded =
  | { runId: string; timeline: Timeline }
  | { runId: string; error: "unsupported" | "load-error" };

// Recordings are immutable; keep a few so switching runs is instant.
const cache = new Map<string, Promise<Timeline>>();
function cachedTimeline(runId: string, url: string, frame: Frame) {
  let pending = cache.get(runId);
  if (!pending) {
    pending = loadTimeline(url, frame, new AbortController().signal);
    pending.catch(() => cache.delete(runId));
    cache.set(runId, pending);
    if (cache.size > 3) cache.delete(cache.keys().next().value!);
  }
  return pending;
}

export function usePlayback({
  map,
  mapReady,
  run,
  frame,
}: {
  map: MapLibreMap | null;
  mapReady: boolean;
  run: PlaybackRun | null;
  frame: Frame;
}) {
  const url = useQuery(
    api.simulations.queries.recordingUrl,
    run?.status === "succeeded" && run.recorded ? { runId: run.runId } : "skip",
  );
  const snapshot = useQuery(
    api.simulations.queries.snapshot,
    run?.status === "succeeded" && run.recorded ? { runId: run.runId } : "skip",
  );
  const savedScene = useMemo(() => {
    const parsed = projectStateSchema.safeParse(snapshot);
    return parsed.success ? parsed.data.scene : [];
  }, [snapshot]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [places, setPlaces] = useState<BasemapPlaces>({ parks: [], stops: [] });
  const playbackScene = useMemo(() => new PlaybackScene(), []);

  const runId = run?.runId;
  useEffect(() => {
    if (!runId || !url) return;
    let current = true;
    cachedTimeline(runId, url, frame).then(
      (timeline) => current && setLoaded({ runId, timeline }),
      (error) =>
        current &&
        setLoaded({
          runId,
          error:
            error instanceof UnsupportedTimelineError
              ? "unsupported"
              : "load-error",
        }),
    );
    return () => {
      current = false;
    };
  }, [runId, url, frame]);

  const shown = loaded && run && loaded.runId === run.runId ? loaded : null;
  const timeline = shown && "timeline" in shown ? shown.timeline : null;
  const clock = useMemo(
    () => (timeline ? new PlaybackClock(timeline.duration) : null),
    [timeline],
  );

  useEffect(() => {
    playbackScene.play(timeline, clock);
    if (!clock || !map) return;
    map.triggerRepaint();
    return clock.subscribe(() => map.triggerRepaint());
  }, [playbackScene, timeline, clock, map]);

  // Only a recorded run that is being viewed brings the streets to life.
  const active = Boolean(mapReady && map && clock);
  useEffect(() => {
    if (!active || !map) return;
    const style = map.getStyle();
    // The editor may replace its map during development or remounting.
    if (!style) return;
    const layer = new StreetLifeLayer(frame, playbackScene.source, () =>
      Boolean(playbackScene.clock?.playing),
    );
    const firstLabel = style.layers.find((l) => l.type === "symbol")?.id;
    map.addLayer(layer, firstLabel);
    // Parks and bus stops come from whichever basemap tiles are loaded.
    const refresh = () => {
      const next = basemapPlaces(map);
      setPlaces((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    refresh();
    map.on("idle", refresh);
    return () => {
      map.off("idle", refresh);
      if (map.getLayer(STREET_LIFE_LAYER)) map.removeLayer(STREET_LIFE_LAYER);
    };
  }, [active, map, frame, playbackScene]);

  useEffect(() => {
    playbackScene.setResting(
      active ? restingPeople(savedScene, places, frame) : [],
    );
    map?.triggerRepaint();
  }, [active, savedScene, places, frame, map, playbackScene]);

  // Colour imported roads by simulated speed relative to free flow.
  useEffect(() => {
    if (!active || !map || !timeline || !clock) return;
    let painted = new Map<string, number>();
    let sample: unknown = null;
    let frameId = 0;
    const update = () => {
      const next = congestionAt(timeline, clock.current());
      if (next !== sample && map.getSource(NETWORK_SOURCE)) {
        sample = next;
        const flows = new Map<string, number>();
        if (next)
          next.edges.forEach((edge, i) => {
            const free = timeline.freeFlow[edge];
            flows.set(
              timeline.edgeIds[edge],
              free > 0 ? Math.min(1, next.meanSpeed[i] / free) : 1,
            );
          });
        for (const id of painted.keys())
          if (!flows.has(id))
            map.removeFeatureState({ source: NETWORK_SOURCE, id }, "flow");
        for (const [id, flow] of flows)
          if (painted.get(id) !== flow)
            map.setFeatureState({ source: NETWORK_SOURCE, id }, { flow });
        painted = flows;
      }
    };
    // Follow every frame while playing; seeks and pauses repaint at once.
    const loop = () => {
      update();
      frameId = clock.playing ? requestAnimationFrame(loop) : 0;
    };
    const onClock = () => {
      update();
      if (clock.playing && !frameId) frameId = requestAnimationFrame(loop);
    };
    onClock();
    const unsubscribe = clock.subscribe(onClock);
    return () => {
      unsubscribe();
      cancelAnimationFrame(frameId);
      if (map.getSource(NETWORK_SOURCE))
        for (const id of painted.keys())
          map.removeFeatureState({ source: NETWORK_SOURCE, id }, "flow");
    };
  }, [active, map, timeline, clock]);

  const status = !run
    ? "off"
    : run.status === "queued" || run.status === "running"
      ? "simulating"
      : run.status === "failed"
        ? "failed"
        : !run.recorded
          ? "unrecorded"
          : url === null
            ? "load-error"
            : shown && "error" in shown
              ? shown.error
              : clock
                ? "ready"
                : "loading";
  return { status, clock, timeline, scene: playbackScene } as const;
}
