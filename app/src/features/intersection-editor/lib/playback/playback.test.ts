import { expect, test } from "vitest";
import { ORIGIN, toLngLat } from "../geometry";
import { restingPeople } from "../street-life/ambient";
import { makeFrame, toFrame } from "../street-life/frame";
import { componentParts, outlines } from "../components";
import { PlaybackClock } from "./clock";
import { PlaybackScene } from "./scene";
import {
  agentsAt,
  congestionAt,
  parseTimeline,
  UnsupportedTimelineError,
} from "./timeline";

const frame = makeFrame(ORIGIN.lng, ORIGIN.lat);
const { lng, lat } = ORIGIN;
// About 10 m of longitude here.
const D10 = 10 / (111_320 * Math.cos((lat * Math.PI) / 180));

function recording() {
  return {
    format: "traffic-worker-timeline-v2",
    frame_interval_seconds: 1,
    kinds: ["car", "pedestrian", "bicycle", "scooter"],
    frames: [
      {
        time_seconds: 1,
        // Rows out of index order on purpose.
        agents: [2, lng, lat, 0, 1.2, 0, lng, lat, 90, 10],
        edges: [0, 5, 2],
      },
      {
        time_seconds: 2,
        agents: [0, lng + D10, lat, 90, 12, 1, lng, lat, 180, 4],
      },
    ],
    agents: [
      ["car-1", 0],
      ["bike-1", 2],
      ["ped-1", 1],
    ],
    edges: [["e1", 10]],
  };
}

test("parsing sorts agents and converts SUMO angles", () => {
  const timeline = parseTimeline(recording(), frame);
  expect(timeline.duration).toBe(2);
  expect(Array.from(timeline.frames[0].ids)).toEqual([0, 2]);
  // 90° clockwise from north is east: 0 radians.
  expect(timeline.frames[0].heading[0]).toBeCloseTo(0);
  expect(timeline.frames[0].heading[1]).toBeCloseTo(Math.PI / 2);
  expect(congestionAt(timeline, 1.5)?.meanSpeed[0]).toBe(5);
});

test("playback retains the demand source and unmeasured warm-up", () => {
  const timeline = parseTimeline(
    { ...recording(), demand_source: "model", warmup_seconds: 600 },
    frame,
  );
  expect(timeline.demandSource).toBe("model");
  expect(timeline.warmupSeconds).toBe(600);
  expect(parseTimeline(recording(), frame).demandSource).toBeNull();
});

test("malformed recording positions and time order are rejected", () => {
  for (const frames of [
    [{ time_seconds: 1, agents: [0, Infinity, lat, 0, 1] }],
    [{ time_seconds: 1, agents: [0, lng, 90, 0, 1] }],
    [{ time_seconds: 1, agents: [0, lng, lat, 0, -1] }],
    [{ time_seconds: 1, agents: [0, lng, lat, 0, 1, 0, lng, lat, 0, 1] }],
    [
      { time_seconds: 2, agents: [] },
      { time_seconds: 1, agents: [] },
    ],
  ]) {
    expect(() => parseTimeline({ ...recording(), frames }, frame)).toThrow();
  }
});

test("older recordings are reported as unsupported", () => {
  expect(() =>
    parseTimeline({ format: "traffic-worker-timeline-v1", samples: [] }, frame),
  ).toThrow(UnsupportedTimelineError);
  expect(() =>
    parseTimeline(
      {
        ...recording(),
        frames: [{ time_seconds: 1, agents: [9, 0, 0, 0, 0] }],
      },
      frame,
    ),
  ).toThrow();
});

test("agents interpolate between frames and appear or leave at the midpoint", () => {
  const timeline = parseTimeline(recording(), frame);
  const at = (t: number) => {
    const seen: Record<string, number[]> = {};
    agentsAt(timeline, t, (id, kind, x, y, heading, speed) => {
      seen[`${kind}:${id}`] = [x, y, heading, speed];
    });
    return seen;
  };
  const early = at(1.25);
  expect(Object.keys(early).sort()).toEqual(["car:0", "pedestrian:2"]);
  expect(early["car:0"][0]).toBeCloseTo(2.5, 0);
  expect(early["car:0"][3]).toBeCloseTo(10.5);
  const late = at(1.75);
  expect(Object.keys(late).sort()).toEqual(["bicycle:1", "car:0"]);
});

test("the clock plays at its rate, seeks and stops at the end", () => {
  let now = 0;
  const clock = new PlaybackClock(100, () => now);
  clock.setRate(4);
  clock.play();
  now = 5000;
  expect(clock.current()).toBe(20);
  clock.seek(90);
  now = 10_000;
  expect(clock.current()).toBe(100);
  expect(clock.playing).toBe(false);
  clock.play();
  expect(clock.current()).toBe(0);
});

test("playback draws every simulated agent, editable area or not", () => {
  const timeline = parseTimeline(recording(), frame);
  const scene = new PlaybackScene();
  const clock = new PlaybackClock(timeline.duration, () => 0);
  clock.seek(1);
  scene.play(timeline, clock);
  const drawn: string[] = [];
  scene.source((kind) => drawn.push(kind));
  expect(drawn.sort()).toEqual(["car", "pedestrian"]);
  expect(scene.stats.car).toBe(1);
  expect(scene.stats.carSpeed).toBe(10);
  scene.play(null, null);
  drawn.length = 0;
  scene.source((kind) => drawn.push(kind));
  expect(drawn).toEqual([]);
});

test("benches, circle benches and shelters seat the same people every time", () => {
  const components = [
    { id: "bench-1", kind: "bench" as const, x: 0, y: 0, rotation: 0 },
    {
      id: "circle-1",
      kind: "circle_bench" as const,
      x: -20,
      y: 0,
      rotation: 0,
      width: 4.4,
    },
    {
      id: "shelter-1",
      kind: "transit_shelter" as const,
      x: 10,
      y: 0,
      rotation: 0,
    },
    {
      id: "green-1",
      kind: "green_area" as const,
      x: 0,
      y: 25,
      rotation: 0,
      length: 40,
      width: 30,
    },
  ];
  const places = { parks: [], stops: [] };
  const first = restingPeople(components, places, frame);
  expect(first).toEqual(restingPeople(components, places, frame));
  expect(first.some((p) => p.kind === "standing")).toBe(true);
  // At least three neighbours around the circle bench, all facing its centre.
  const [cx, cy] = toFrame(frame, ...toLngLat([-20, 0]));
  const circle = first.filter((p) => Math.hypot(p.x - cx, p.y - cy) < 2.5);
  expect(circle.length).toBeGreaterThanOrEqual(3);
  for (const p of circle) {
    const toCentre = Math.atan2(cy - p.y, cx - p.x);
    const off = Math.abs(
      ((p.heading - toCentre + 3 * Math.PI) % (2 * Math.PI)) - Math.PI,
    );
    expect(off).toBeLessThan(0.05);
  }
});

test("circle benches have a round footprint sized by their diameter", () => {
  const bench = {
    id: "c",
    kind: "circle_bench" as const,
    x: 0,
    y: 0,
    rotation: 0,
    width: 6,
  };
  const [ring] = outlines(bench);
  for (const [x, y] of ring) expect(Math.hypot(x, y)).toBeCloseTo(3);
  expect(
    componentParts(bench).filter((p) => p.layer === "solid").length,
  ).toBeGreaterThan(20);
});

test("resting people show only as the simulated crowd nearby allows", () => {
  const timeline = parseTimeline(recording(), frame);
  const scene = new PlaybackScene();
  const clock = new PlaybackClock(timeline.duration, () => 0);
  clock.seek(1);
  scene.play(timeline, clock);
  const near = { kind: "seated" as const, x: 0, y: 0, heading: 0, look: 1 };
  const far = { ...near, x: 5000 };
  // One pedestrian near the origin: a crowd level of 1/40.
  scene.setResting([
    { ...near, share: 0.01 },
    { ...near, share: 0.5 },
    { ...far, share: 0.01 },
  ]);
  scene.source(() => {});
  expect(scene.stats.resting).toBe(1);
  // No recording, no crowd: nobody rests.
  scene.play(null, null);
  scene.source(() => {});
  expect(scene.stats.resting).toBe(0);
});

test("trees shade up to four people around their trunk", () => {
  const tree = {
    id: "tree-1",
    kind: "tree" as const,
    x: 0,
    y: 0,
    rotation: 0,
    width: 6,
  };
  const people = restingPeople([tree], { parks: [], stops: [] }, frame);
  expect(people).toHaveLength(4);
  const [cx, cy] = toFrame(frame, ...toLngLat([0, 0]));
  for (const p of people) {
    expect(Math.hypot(p.x - cx, p.y - cy)).toBeLessThan(1.7);
    expect(p.share).toBeGreaterThanOrEqual(0);
    expect(p.share).toBeLessThan(1);
  }
  expect(outlines(tree)[0].every(([x, y]) => Math.hypot(x, y) < 0.5)).toBe(
    true,
  );
});
