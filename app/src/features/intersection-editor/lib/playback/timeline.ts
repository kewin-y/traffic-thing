// Recorded SUMO runs (traffic-worker-timeline-v2): every car, cyclist,
// e-scooter rider and pedestrian, sampled every frame interval, plus edge
// congestion every sample interval. Nothing here is invented; between frames
// agents are only interpolated.

import { toFrame, type Frame } from "../street-life/frame";

export const AGENT_KINDS = ["car", "pedestrian", "bicycle", "scooter"] as const;
export type SimKind = (typeof AGENT_KINDS)[number];

export interface TimelineFrame {
  time: number;
  /** Agent indices, ascending. */
  ids: Int32Array;
  /** Frame metres, x,y pairs. */
  xy: Float32Array;
  /** Radians counter-clockwise from east. */
  heading: Float32Array;
  speed: Float32Array;
}

export interface CongestionSample {
  time: number;
  edges: Int32Array;
  meanSpeed: Float32Array;
  count: Int32Array;
}

export interface Timeline {
  duration: number;
  frameInterval: number;
  frames: TimelineFrame[];
  /** Kind index into AGENT_KINDS, per agent. */
  kinds: Uint8Array;
  agentIds: string[];
  congestion: CongestionSample[];
  edgeIds: string[];
  freeFlow: Float32Array;
}

export class UnsupportedTimelineError extends Error {}

type Raw = {
  format?: unknown;
  frame_interval_seconds?: unknown;
  kinds?: unknown;
  frames?: unknown;
  agents?: unknown;
  edges?: unknown;
};

function isNumbers(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((n) => typeof n === "number");
}

/** Validate and index a parsed recording into typed arrays in `frame` metres. */
export function parseTimeline(raw: unknown, frame: Frame): Timeline {
  const data = raw as Raw;
  if (!data || typeof data !== "object")
    throw new UnsupportedTimelineError("Not a timeline");
  if (data.format !== "traffic-worker-timeline-v2")
    throw new UnsupportedTimelineError("Unsupported timeline format");
  const kindNames = data.kinds;
  if (
    !Array.isArray(kindNames) ||
    kindNames.some((k) => !AGENT_KINDS.includes(k as SimKind))
  )
    throw new Error("Invalid agent kinds");
  if (!Array.isArray(data.agents) || !Array.isArray(data.frames))
    throw new Error("Invalid timeline");
  const agentIds: string[] = [];
  const kinds = new Uint8Array(data.agents.length);
  data.agents.forEach((row: unknown, i) => {
    if (
      !Array.isArray(row) ||
      typeof row[0] !== "string" ||
      !Number.isInteger(row[1]) ||
      row[1] < 0 ||
      row[1] >= kindNames.length
    )
      throw new Error("Invalid agent");
    agentIds.push(row[0]);
    kinds[i] = AGENT_KINDS.indexOf(kindNames[row[1]] as SimKind);
  });
  const edgeIds: string[] = [];
  const edgeRows = Array.isArray(data.edges) ? data.edges : [];
  const freeFlow = new Float32Array(edgeRows.length);
  edgeRows.forEach((row: unknown, i) => {
    if (
      !Array.isArray(row) ||
      typeof row[0] !== "string" ||
      typeof row[1] !== "number"
    )
      throw new Error("Invalid edge");
    edgeIds.push(row[0]);
    freeFlow[i] = row[1];
  });

  const frames: TimelineFrame[] = [];
  const congestion: CongestionSample[] = [];
  for (const entry of data.frames as unknown[]) {
    const f = entry as {
      time_seconds?: unknown;
      agents?: unknown;
      edges?: unknown;
    };
    if (
      typeof f?.time_seconds !== "number" ||
      !isNumbers(f.agents) ||
      f.agents.length % 5
    )
      throw new Error("Invalid frame");
    const rows = f.agents;
    const n = rows.length / 5;
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => rows[a * 5] - rows[b * 5],
    );
    const ids = new Int32Array(n);
    const xy = new Float32Array(n * 2);
    const heading = new Float32Array(n);
    const speed = new Float32Array(n);
    order.forEach((row, i) => {
      const id = rows[row * 5];
      if (!Number.isInteger(id) || id < 0 || id >= kinds.length)
        throw new Error("Invalid agent index");
      ids[i] = id;
      const [x, y] = toFrame(frame, rows[row * 5 + 1], rows[row * 5 + 2]);
      xy[i * 2] = x;
      xy[i * 2 + 1] = y;
      // SUMO angles are degrees clockwise from north.
      heading[i] = ((90 - rows[row * 5 + 3]) * Math.PI) / 180;
      speed[i] = rows[row * 5 + 4];
    });
    frames.push({ time: f.time_seconds, ids, xy, heading, speed });
    if (f.edges !== undefined) {
      if (!isNumbers(f.edges) || f.edges.length % 3)
        throw new Error("Invalid edges");
      const e = f.edges;
      const m = e.length / 3;
      const sample: CongestionSample = {
        time: f.time_seconds,
        edges: new Int32Array(m),
        meanSpeed: new Float32Array(m),
        count: new Int32Array(m),
      };
      for (let i = 0; i < m; i++) {
        if (
          !Number.isInteger(e[i * 3]) ||
          e[i * 3] < 0 ||
          e[i * 3] >= edgeIds.length
        )
          throw new Error("Invalid edge index");
        sample.edges[i] = e[i * 3];
        sample.meanSpeed[i] = e[i * 3 + 1];
        sample.count[i] = e[i * 3 + 2];
      }
      congestion.push(sample);
    }
  }
  if (!frames.length) throw new Error("Empty timeline");
  return {
    duration: frames[frames.length - 1].time,
    frameInterval:
      typeof data.frame_interval_seconds === "number"
        ? data.frame_interval_seconds
        : 1,
    frames,
    kinds,
    agentIds,
    congestion,
    edgeIds,
    freeFlow,
  };
}

/** Download, gunzip and parse a recording. */
export async function loadTimeline(
  url: string,
  frame: Frame,
  signal: AbortSignal,
): Promise<Timeline> {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body)
    throw new Error("Recording download failed");
  const bytes = new Uint8Array(await response.arrayBuffer());
  // Storage serves the gzip file as-is; tolerate a transparent decode too.
  const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = gzipped
    ? await new Response(
        new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
      ).text()
    : new TextDecoder().decode(bytes);
  return parseTimeline(JSON.parse(text), frame);
}

/** Index of the last element of `times` at or before `t` (0 if none). */
function floorIndex<T extends { time: number }>(items: T[], t: number) {
  let lo = 0;
  let hi = items.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (items[mid].time <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export type EmitAgent = (
  id: number,
  kind: SimKind,
  x: number,
  y: number,
  heading: number,
  speed: number,
) => void;

function lerpAngle(a: number, b: number, f: number) {
  const d = ((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  return a + d * f;
}

/**
 * Every agent's state at time `t`, interpolated between the surrounding
 * frames. An agent present in only one of them (departing or arriving) is
 * shown for the half of the interval nearest that frame.
 */
export function agentsAt(timeline: Timeline, t: number, emit: EmitAgent) {
  const { frames, kinds } = timeline;
  const k = floorIndex(frames, t);
  const a = frames[k];
  const b = frames[Math.min(k + 1, frames.length - 1)];
  const span = b.time - a.time;
  const f = span > 0 ? Math.max(0, Math.min(1, (t - a.time) / span)) : 0;
  let i = 0;
  let j = 0;
  while (i < a.ids.length || j < b.ids.length) {
    const ia = i < a.ids.length ? a.ids[i] : Infinity;
    const jb = j < b.ids.length ? b.ids[j] : Infinity;
    if (ia === jb) {
      emit(
        ia,
        AGENT_KINDS[kinds[ia]],
        a.xy[i * 2] + (b.xy[j * 2] - a.xy[i * 2]) * f,
        a.xy[i * 2 + 1] + (b.xy[j * 2 + 1] - a.xy[i * 2 + 1]) * f,
        lerpAngle(a.heading[i], b.heading[j], f),
        a.speed[i] + (b.speed[j] - a.speed[i]) * f,
      );
      i++;
      j++;
    } else if (ia < jb) {
      if (f < 0.5 || a === b)
        emit(
          ia,
          AGENT_KINDS[kinds[ia]],
          a.xy[i * 2],
          a.xy[i * 2 + 1],
          a.heading[i],
          a.speed[i],
        );
      i++;
    } else {
      if (f >= 0.5)
        emit(
          jb,
          AGENT_KINDS[kinds[jb]],
          b.xy[j * 2],
          b.xy[j * 2 + 1],
          b.heading[j],
          b.speed[j],
        );
      j++;
    }
  }
}

/** The latest congestion sample at or before `t`. */
export function congestionAt(timeline: Timeline, t: number) {
  if (!timeline.congestion.length) return null;
  return timeline.congestion[floorIndex(timeline.congestion, t)];
}
