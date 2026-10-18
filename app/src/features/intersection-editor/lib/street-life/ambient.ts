// People at rest during playback: on benches, under trees, in green areas
// and parks, and waiting at transit shelters and bus stops. They don't
// travel, so SUMO doesn't model them. Each spot lists everyone it can hold,
// placed by the spot itself (never by time); how many of them show at a
// moment follows the simulated pedestrians nearby, so a busy street fills
// its benches and stops and a quiet one empties them.

import type { Map as MapLibreMap } from "maplibre-gl";
import {
  CIRCLE_BENCH_DIAMETER,
  circleSeatCount,
  circleSeatRadius,
  type SceneComponent,
} from "../components";
import { GRID_BEARING, place, rect, toLngLat, type Vec2 } from "../geometry";
import { toFrame, type Frame } from "./frame";
import type { FigureKind } from "./models";

export interface Resting {
  kind: FigureKind;
  x: number;
  y: number;
  heading: number;
  look: number;
  /** In [0, 1): shown while the local crowd level exceeds it. */
  share: number;
}

type Placed = Omit<Resting, "share">;

/** Basemap features, in longitude/latitude. */
export interface BasemapPlaces {
  parks: Vec2[][];
  stops: Vec2[];
}

/** Cell size of the grid people in parks are placed on, in metres. */
const CELL = 9;
/** Share of park cells that can hold a group of people. */
const PARK_OCCUPANCY = 0.3;
/** Grid "north" leans this far west of true north. */
const GRID_TURN = (-GRID_BEARING * Math.PI) / 180;

function hash(...values: number[]) {
  let h = 2166136261;
  for (const v of values) {
    h ^= Math.floor(v) | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

/** Deterministic pseudo-random numbers for one place. */
function stream(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function textSeed(text: string) {
  return hash(...Array.from(text, (c) => c.charCodeAt(0)));
}

function insideRing(x: number, y: number, ring: Vec2[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

/**
 * Groups of people relaxing in open space: each grid cell that falls in a
 * park decides from its own coordinates whether a group is there, so parks
 * split across map tiles never double up.
 */
function parkPeople(parks: Vec2[][], out: Placed[]) {
  const seen = new Set<string>();
  for (const ring of parks) {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    const x0 = Math.floor(Math.min(...xs) / CELL);
    const x1 = Math.floor(Math.max(...xs) / CELL);
    const y0 = Math.floor(Math.min(...ys) / CELL);
    const y1 = Math.floor(Math.max(...ys) / CELL);
    if ((x1 - x0) * (y1 - y0) > 40_000) continue;
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = `${cx},${cy}`;
        if (seen.has(key)) continue;
        const random = stream(hash(cx, cy, 7));
        if (random() >= PARK_OCCUPANCY) continue;
        const x = (cx + 0.2 + random() * 0.6) * CELL;
        const y = (cy + 0.2 + random() * 0.6) * CELL;
        if (!insideRing(x, y, ring)) continue;
        seen.add(key);
        const size = 1 + Math.floor(random() * 4);
        const facing = random() * Math.PI * 2;
        for (let i = 0; i < size; i++) {
          // A small circle of friends, facing each other.
          const around = facing + (i / size) * Math.PI * 2;
          const r = size > 1 ? 0.8 : 0;
          const pose = random();
          out.push({
            kind:
              pose < 0.55 ? "lounging" : pose < 0.75 ? "seated" : "standing",
            x: x + Math.cos(around) * r,
            y: y + Math.sin(around) * r,
            heading: around + Math.PI,
            look: Math.floor(random() * 2 ** 30),
          });
        }
      }
    }
  }
}

/** Most resting people drawn at once; parks are thinned evenly beyond it. */
export const MAX_RESTING = 4000;

/** Resting people for the scene and the loaded basemap tiles. */
export function restingPeople(
  scene: SceneComponent[],
  places: BasemapPlaces,
  frame: Frame,
): Resting[] {
  const out: Placed[] = [];
  const project = (p: Vec2) => {
    const [lng, lat] = toLngLat(p);
    return toFrame(frame, lng, lat);
  };
  const parks = places.parks.map((ring) =>
    ring.map(([lng, lat]) => toFrame(frame, lng, lat)),
  );
  for (const c of scene) {
    const random = stream(textSeed(c.id));
    // Grid-frame rotation to a frame heading (radians, CCW from east).
    const turn = (c.rotation * Math.PI) / 180 + GRID_TURN;
    const spot = (lx: number, ly: number) =>
      project(place([[lx, ly]], c.x, c.y, c.rotation)[0]);
    if (c.kind === "green_area") {
      parks.push(
        place(
          rect(0, 0, c.length ?? 20, c.width ?? 12),
          c.x,
          c.y,
          c.rotation,
        ).map(project),
      );
    } else if (c.kind === "tree") {
      // In the shade around the trunk, backs to it.
      const around = random() * Math.PI * 2;
      for (let i = 0; i < 4; i++) {
        const angle = around + (i / 4) * Math.PI * 2 + (random() - 0.5) * 0.6;
        const r = 0.7 + random() * 0.9;
        const [x, y] = spot(Math.cos(angle) * r, Math.sin(angle) * r);
        out.push({
          kind: random() < 0.6 ? "lounging" : "seated",
          x,
          y,
          heading: angle + turn,
          look: Math.floor(random() * 2 ** 30),
        });
      }
    } else if (c.kind === "bench") {
      // The back rests at +y, so sitters face −y.
      for (let i = 0; i < 2; i++) {
        const [x, y] = spot(i ? 0.45 : -0.45, 0.05);
        out.push({
          kind: "seated",
          x,
          y,
          heading: turn - Math.PI / 2,
          look: Math.floor(random() * 2 ** 30),
        });
      }
    } else if (c.kind === "circle_bench") {
      // Neighbours sit around the ring facing each other, in small clusters.
      const diameter = c.width ?? CIRCLE_BENCH_DIAMETER;
      const seats = circleSeatCount(diameter);
      const radius = circleSeatRadius(diameter) + 0.05;
      const start = Math.floor(random() * seats);
      for (let i = 0; i < seats; i++) {
        // Neighbouring seats fill first, so groups form as it gets busier.
        const seat = (start + i) % seats;
        const angle = (seat / seats) * Math.PI * 2;
        const [x, y] = spot(Math.cos(angle) * radius, Math.sin(angle) * radius);
        out.push({
          kind: "seated",
          x,
          y,
          heading: angle + turn + Math.PI,
          look: Math.floor(random() * 2 ** 30),
        });
      }
    } else if (c.kind === "transit_shelter") {
      for (let i = 0; i < 6; i++) {
        const [x, y] = spot(random() * 3.2 - 1.6, -0.3 - random());
        out.push({
          kind: i < 2 ? "seated" : "standing",
          x,
          y,
          heading: turn - Math.PI / 2 + (random() - 0.5) * 0.9,
          look: Math.floor(random() * 2 ** 30),
        });
      }
    }
  }
  const stops = new Set<string>();
  for (const [lng, lat] of places.stops) {
    const [sx, sy] = toFrame(frame, lng, lat);
    const key = `${Math.round(sx)},${Math.round(sy)}`;
    if (stops.has(key)) continue;
    stops.add(key);
    const random = stream(hash(Math.round(sx), Math.round(sy), 11));
    const facing = random() * Math.PI * 2;
    for (let i = 0; i < 6; i++) {
      out.push({
        kind: "standing",
        x: sx + (random() - 0.5) * 3,
        y: sy + (random() - 0.5) * 3,
        heading: facing + (random() - 0.5) * 0.9,
        look: Math.floor(random() * 2 ** 30),
      });
    }
  }
  const fixed = out.length;
  parkPeople(parks, out);
  // Within a spot, earlier people get lower shares, so seats fill in order.
  const resting = out.map((p, i): Resting => {
    const spotRandom = stream(
      hash(Math.round(p.x * 10), Math.round(p.y * 10), 3),
    );
    return { ...p, share: (spotRandom() + (i % 6) / 6) / 2 };
  });
  if (resting.length <= MAX_RESTING) return resting;
  // Keep every bench, tree, shelter and stop; thin park groups evenly.
  const keep = Math.max(0, MAX_RESTING - fixed);
  const parkCount = resting.length - fixed;
  return resting.filter(
    (_, i) => i < fixed || ((i - fixed) * keep) % parkCount < keep,
  );
}

/** Cell size for counting simulated pedestrians near a resting spot. */
export const CROWD_CELL = 150;
/** Simulated pedestrians within ~450 m that fill every resting spot. Busy
 * downtown blocks count 12–33 in a 200 s Toronto run, so spots range from a
 * third to most of the way full. */
export const CROWD_FULL = 40;

/**
 * How full resting spots are around (x, y), from the simulated pedestrians
 * counted per CROWD_CELL cell: 0 with nobody walking nearby, 1 when busy.
 */
export function crowdLevel(counts: Map<string, number>, x: number, y: number) {
  const cx = Math.floor(x / CROWD_CELL);
  const cy = Math.floor(y / CROWD_CELL);
  let nearby = 0;
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      nearby += counts.get(`${cx + dx},${cy + dy}`) ?? 0;
  return Math.min(1, nearby / CROWD_FULL);
}

const PARK_CLASSES = new Set([
  "park",
  "garden",
  "playground",
  "recreation_ground",
  "pitch",
  "grass",
  "village_green",
]);

/** Parks and bus stops from the basemap's vector tiles that are loaded now. */
export function basemapPlaces(map: MapLibreMap): BasemapPlaces {
  const parks: Vec2[][] = [];
  const stops: Vec2[] = [];
  const sources = Object.entries(map.getStyle().sources)
    .filter(([, source]) => source.type === "vector")
    .map(([id]) => id);
  for (const source of sources) {
    for (const sourceLayer of ["park", "landuse", "landcover"]) {
      for (const feature of map.querySourceFeatures(source, { sourceLayer })) {
        const kind = String(feature.properties?.class ?? "");
        const sub = String(feature.properties?.subclass ?? "");
        if (
          sourceLayer !== "park" &&
          !PARK_CLASSES.has(kind) &&
          !PARK_CLASSES.has(sub)
        )
          continue;
        const geometry = feature.geometry;
        if (geometry.type === "Polygon")
          parks.push(geometry.coordinates[0] as Vec2[]);
        else if (geometry.type === "MultiPolygon")
          for (const polygon of geometry.coordinates)
            parks.push(polygon[0] as Vec2[]);
      }
    }
    for (const feature of map.querySourceFeatures(source, {
      sourceLayer: "poi",
    })) {
      const p = feature.properties ?? {};
      if (
        feature.geometry.type === "Point" &&
        (p.subclass === "bus_stop" ||
          p.class === "bus" ||
          p.subclass === "tram_stop")
      )
        stops.push(feature.geometry.coordinates as Vec2);
    }
  }
  return { parks, stops };
}
