import { place, polygon, rect, type Vec2 } from "./geometry";

export type LaneKind = "car_lane" | "bike_lane" | "streetcar_lane";

/** Regulatory turn-prohibition signs, as tagged in OpenStreetMap. */
export type TurnBanKind =
  "no_left_turn" | "no_right_turn" | "no_u_turn" | "no_straight_on";

export type ComponentKind =
  | LaneKind
  | "road"
  | "sidewalk"
  | "intersection"
  | "crosswalk"
  | "building"
  | "green_area"
  | "bench"
  | "circle_bench"
  | "tree"
  | "traffic_light"
  | "stop_sign"
  | "yield_sign"
  | "speed_sign"
  | "speed_hump"
  | TurnBanKind
  | "transit_shelter"
  | "streetlight"
  | "streetcar"
  // Placeholder left when an OpenStreetMap feature is deleted, so it stays hidden.
  | "removed_osm";

/**
 * One editable thing in the scene. Position is the centre in local metres;
 * rotation 0 lays the component's long axis along x (east–west).
 */
export interface SceneComponent {
  id: string;
  kind: ComponentKind;
  x: number;
  y: number;
  rotation: number;
  length?: number;
  width?: number;
  height?: number;
  speedKmh?: number;
  /** When a timed sign applies, in OpenStreetMap opening-hours syntax. */
  hours?: string;
  colour?: string;
  /** Building outline from OpenStreetMap, relative to (x, y). */
  footprint?: Vec2[];
  /** Road centreline from OpenStreetMap, relative to (x, y). */
  path?: Vec2[];
  /** Source feature id when the component was converted from the basemap. */
  osmId?: string | number;
  /**
   * Where a converted building first stood. Basemap features can merge many
   * buildings, so this (with the footprint) picks out the one to hide.
   */
  osmAt?: Vec2;
}

/** A single extruded or flat polygon that makes up part of a component. */
export interface Part {
  ring: Vec2[];
  layer: "ground" | "marking" | "solid";
  colour: string;
  base?: number;
  height?: number;
}

export type ToolGroup = "Road" | "Transit" | "Signals & signs" | "Streetscape";

export interface ToolDefinition {
  kind: ComponentKind;
  label: string;
  group: ToolGroup;
  hint: string;
  defaults: Partial<SceneComponent>;
}

export const LANE_KINDS: readonly ComponentKind[] = [
  "car_lane",
  "bike_lane",
  "streetcar_lane",
];

export function isLane(kind: ComponentKind): kind is LaneKind {
  return LANE_KINDS.includes(kind);
}

/** Surfaces vehicles drive on; sidewalks and street furniture may not overlap them. */
export const ROADWAY_KINDS: readonly ComponentKind[] = [
  ...LANE_KINDS,
  "road",
  "intersection",
];

/** Components whose length and width can be dragged with resize handles. */
export function isResizable(c: SceneComponent) {
  return (
    c.length !== undefined &&
    c.width !== undefined &&
    !c.path &&
    !c.footprint &&
    c.kind !== "streetcar"
  );
}

export const CIRCLE_BENCH_DIAMETER = 4.4;
/** Default crown diameter of a tree, in metres. */
export const TREE_CROWN = 6;

/**
 * Widths ("thickness") that can be set from a component's menu, in metres:
 * lanes and roads across the travelled way, sidewalks and crosswalks across
 * the walking way.
 */
export const THICKNESS: Partial<
  Record<ComponentKind, { min: number; max: number; step: number }>
> = {
  car_lane: { min: 2.5, max: 5, step: 0.1 },
  bike_lane: { min: 1.2, max: 3, step: 0.1 },
  streetcar_lane: { min: 3, max: 4.5, step: 0.1 },
  road: { min: 3, max: 40, step: 0.5 },
  sidewalk: { min: 1.5, max: 10, step: 0.25 },
  crosswalk: { min: 2, max: 8, step: 0.5 },
};

export const LANE_WIDTHS: Record<LaneKind, number> = {
  car_lane: 3.3,
  bike_lane: 1.8,
  streetcar_lane: 3.3,
};

export const TOOLS: ToolDefinition[] = [
  {
    kind: "car_lane",
    label: "Car lane",
    group: "Road",
    hint: "Snaps to the street arm it is dropped on",
    defaults: { width: LANE_WIDTHS.car_lane },
  },
  {
    kind: "bike_lane",
    label: "Bike lane",
    group: "Road",
    hint: "Snaps to the street arm it is dropped on",
    defaults: { width: LANE_WIDTHS.bike_lane },
  },
  {
    kind: "road",
    label: "Road",
    group: "Road",
    hint: "Two-lane street segment; drag its ends to extend it",
    defaults: { length: 40, width: 6.6 },
  },
  {
    kind: "sidewalk",
    label: "Sidewalk",
    group: "Road",
    hint: "4 m pedestrian strip",
    defaults: { length: 20, width: 4 },
  },
  {
    kind: "crosswalk",
    label: "Crosswalk",
    group: "Road",
    hint: "Zebra markings across a street",
    defaults: { length: 16.8, width: 3 },
  },
  {
    kind: "streetcar_lane",
    label: "Streetcar track",
    group: "Transit",
    hint: "Snaps to the street arm it is dropped on",
    defaults: { width: LANE_WIDTHS.streetcar_lane },
  },
  {
    kind: "streetcar",
    label: "Streetcar",
    group: "Transit",
    hint: "Low-floor streetcar, 30 m",
    defaults: { length: 30, width: 2.6 },
  },
  {
    kind: "transit_shelter",
    label: "Transit shelter",
    group: "Transit",
    hint: "Stop shelter with a canopy",
    defaults: {},
  },
  {
    kind: "traffic_light",
    label: "Traffic signal",
    group: "Signals & signs",
    hint: "Any signal makes the junction signalized",
    defaults: {},
  },
  {
    kind: "stop_sign",
    label: "Stop sign",
    group: "Signals & signs",
    hint: "All-way stop when there are no signals",
    defaults: {},
  },
  {
    kind: "yield_sign",
    label: "Yield sign",
    group: "Signals & signs",
    hint: "Drivers give way to cross traffic",
    defaults: {},
  },
  {
    kind: "speed_sign",
    label: "Speed limit",
    group: "Signals & signs",
    hint: "Sets the limit for the arm it stands on",
    defaults: { speedKmh: 40 },
  },
  {
    kind: "speed_hump",
    label: "Speed hump",
    group: "Signals & signs",
    hint: "Traffic calming across a street; drag its ends to fit",
    defaults: { length: 7, width: 3.7 },
  },
  {
    kind: "no_left_turn",
    label: "No left turn",
    group: "Signals & signs",
    hint: "Prohibits left turns from this approach",
    defaults: {},
  },
  {
    kind: "no_right_turn",
    label: "No right turn",
    group: "Signals & signs",
    hint: "Prohibits right turns from this approach",
    defaults: {},
  },
  {
    kind: "no_u_turn",
    label: "No U-turn",
    group: "Signals & signs",
    hint: "Prohibits U-turns from this approach",
    defaults: {},
  },
  {
    kind: "no_straight_on",
    label: "No straight",
    group: "Signals & signs",
    hint: "Traffic must turn; no through movement",
    defaults: {},
  },
  {
    kind: "streetlight",
    label: "Streetlight",
    group: "Streetscape",
    hint: "Street lighting pole",
    defaults: {},
  },
  {
    kind: "green_area",
    label: "Green area",
    group: "Streetscape",
    hint: "Grass or planting strip; drag its edges to resize",
    defaults: { length: 12, width: 4 },
  },
  {
    kind: "bench",
    label: "Bench",
    group: "Streetscape",
    hint: "Two-seat bench",
    defaults: {},
  },
  {
    kind: "tree",
    label: "Tree",
    group: "Streetscape",
    hint: "Street or park tree; people rest in its shade",
    defaults: { width: TREE_CROWN },
  },
  {
    kind: "circle_bench",
    label: "Circle bench",
    group: "Streetscape",
    hint: "Ring of seats around a planter, facing in for conversation",
    defaults: { width: CIRCLE_BENCH_DIAMETER },
  },
  {
    kind: "building",
    label: "Building",
    group: "Streetscape",
    hint: "Mid-rise block; adjust height after placing",
    defaults: { length: 18, width: 16, height: 15, colour: "#e8d8c3" },
  },
];

export const TOOL_BY_KIND = Object.fromEntries(
  TOOLS.map((tool) => [tool.kind, tool]),
) as Record<ComponentKind, ToolDefinition>;
TOOL_BY_KIND.intersection = {
  kind: "intersection",
  label: "Intersection",
  group: "Road",
  hint: "Junction box",
  defaults: {},
};
TOOL_BY_KIND.removed_osm = {
  kind: "removed_osm",
  label: "Removed map feature",
  group: "Streetscape",
  hint: "",
  defaults: {},
};

/** Pastel facade colours shared by placed and OpenStreetMap buildings. */
export const BUILDING_COLOURS = [
  "#e8d8c3",
  "#d9c2a7",
  "#c9d3dc",
  "#e3c9c0",
  "#d6dccb",
  "#efe6d8",
  "#bfc8d1",
  "#d8b9a0",
];

export const COLOURS = {
  asphalt: "#4b5058",
  track: "#585c63",
  bike: "#4f8a5b",
  paint: "#f4f1e8",
  rail: "#25272b",
  concrete: "#cdc7bb",
  wood: "#a8743f",
  metal: "#3a3d42",
  signalHead: "#1f2124",
  red: "#e5392f",
  amber: "#f2b134",
  green: "#3fcf6a",
  glass: "#a9cfe0",
  ttcRed: "#d6281f",
  window: "#2b3540",
  centreLine: "#f2c230",
  grass: "#7cb862",
  hump: "#6c7079",
  white: "#ffffff",
  lamp: "#fff3b0",
};

function dashes(
  length: number,
  y: number,
  dash: number,
  gap: number,
  thickness = 0.12,
): Part[] {
  const parts: Part[] = [];
  for (let x = -length / 2 + gap / 2; x + dash <= length / 2; x += dash + gap) {
    parts.push({
      ring: rect(x + dash / 2, y, dash, thickness),
      layer: "marking",
      colour: COLOURS.paint,
    });
  }
  return parts;
}

function box(
  cx: number,
  cy: number,
  w: number,
  d: number,
  base: number,
  height: number,
  colour: string,
): Part {
  return { ring: rect(cx, cy, w, d), layer: "solid", base, height, colour };
}

/** Radius of a circle bench's seat line, where people sit. */
export function circleSeatRadius(diameter: number) {
  return diameter / 2 - 0.3;
}

/** Seats per circle bench of the given diameter, about 0.9 m apart. */
export function circleSeatCount(diameter: number) {
  return Math.max(
    8,
    Math.round((2 * Math.PI * circleSeatRadius(diameter)) / 0.9),
  );
}

/** A ring of seats with a backrest outside and a planted centre. */
function circleBenchParts(diameter: number): Part[] {
  const seat = circleSeatRadius(diameter);
  const n = circleSeatCount(diameter);
  const chord = ((2 * Math.PI * seat) / n) * 1.04;
  const parts: Part[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (i / n) * Math.PI * 2;
    const degrees = (angle * 180) / Math.PI + 90;
    const at = (r: number): [number, number] => [
      Math.cos(angle) * r,
      Math.sin(angle) * r,
    ];
    const [sx, sy] = at(seat);
    parts.push({
      ring: place(rect(0, 0, chord, 0.45), sx, sy, degrees),
      layer: "solid",
      base: 0.42,
      height: 0.5,
      colour: COLOURS.wood,
    });
    const [bx, by] = at(seat + 0.26);
    parts.push({
      ring: place(rect(0, 0, chord * 1.05, 0.08), bx, by, degrees),
      layer: "solid",
      base: 0.5,
      height: 0.95,
      colour: shade(COLOURS.wood, -0.12),
    });
    if (i % 2 === 0)
      parts.push({
        ring: place(rect(0, 0, 0.1, 0.35), sx, sy, degrees),
        layer: "solid",
        base: 0,
        height: 0.42,
        colour: COLOURS.metal,
      });
  }
  const planter = seat - 0.55;
  if (planter > 0.4) {
    parts.push(
      {
        ring: polygon(0, 0, planter, 20),
        layer: "solid",
        base: 0,
        height: 0.45,
        colour: COLOURS.concrete,
      },
      {
        ring: polygon(0, 0, planter - 0.1, 20),
        layer: "solid",
        base: 0.45,
        height: 0.48,
        colour: COLOURS.grass,
      },
      box(0, 0, 0.24, 0.24, 0.48, 2.3, "#6b4a2b"),
      {
        ring: polygon(0, 0, Math.min(1.5, planter + 0.3), 9),
        layer: "solid",
        base: 2.1,
        height: 3.9,
        colour: "#4f9a4a",
      },
    );
  }
  return parts;
}

/** Geometry in the component's own frame, before rotation and translation. */
function localParts(c: SceneComponent): Part[] {
  const length = c.length ?? 0;
  const width = c.width ?? 0;
  switch (c.kind) {
    case "car_lane":
      return [
        {
          ring: rect(0, 0, length, width),
          layer: "ground",
          colour: COLOURS.asphalt,
        },
        ...dashes(length, width / 2 - 0.08, 3, 6),
        ...dashes(length, -width / 2 + 0.08, 3, 6),
      ];
    case "bike_lane": {
      const parts: Part[] = [
        {
          ring: rect(0, 0, length, width),
          layer: "ground",
          colour: COLOURS.bike,
        },
        {
          ring: rect(0, width / 2 - 0.08, length, 0.15),
          layer: "marking",
          colour: COLOURS.paint,
        },
        {
          ring: rect(0, -width / 2 + 0.08, length, 0.15),
          layer: "marking",
          colour: COLOURS.paint,
        },
      ];
      for (let x = -length / 2 + 12; x < length / 2 - 6; x += 25) {
        parts.push({
          ring: polygon(x, 0, 0.45, 4),
          layer: "marking",
          colour: COLOURS.paint,
        });
      }
      return parts;
    }
    case "streetcar_lane": {
      const parts: Part[] = [
        {
          ring: rect(0, 0, length, width),
          layer: "ground",
          colour: COLOURS.track,
        },
        {
          ring: rect(0, 0.72, length, 0.1),
          layer: "marking",
          colour: COLOURS.rail,
        },
        {
          ring: rect(0, -0.72, length, 0.1),
          layer: "marking",
          colour: COLOURS.rail,
        },
      ];
      return parts;
    }
    case "intersection":
      return [
        {
          ring: rect(0, 0, length, width),
          layer: "ground",
          colour: COLOURS.asphalt,
        },
      ];
    case "road": {
      if (c.path) {
        return pathRects(c.path, width).map((ring) => ({
          ring,
          layer: "ground" as const,
          colour: COLOURS.asphalt,
        }));
      }
      return [
        {
          ring: rect(0, 0, length, width),
          layer: "ground",
          colour: COLOURS.asphalt,
        },
        {
          ring: rect(0, 0.12, length, 0.1),
          layer: "marking",
          colour: COLOURS.centreLine,
        },
        {
          ring: rect(0, -0.12, length, 0.1),
          layer: "marking",
          colour: COLOURS.centreLine,
        },
        {
          ring: rect(0, width / 2 - 0.15, length, 0.12),
          layer: "marking",
          colour: COLOURS.paint,
        },
        {
          ring: rect(0, -width / 2 + 0.15, length, 0.12),
          layer: "marking",
          colour: COLOURS.paint,
        },
      ];
    }
    case "sidewalk":
      return [box(0, 0, length, width, 0, 0.15, COLOURS.concrete)];
    case "crosswalk": {
      const parts: Part[] = [];
      for (let x = -length / 2 + 0.5; x <= length / 2 - 0.5; x += 1.1) {
        parts.push({
          ring: rect(x, 0, 0.55, width),
          layer: "marking",
          colour: COLOURS.paint,
        });
      }
      return parts;
    }
    case "building": {
      const height = c.height ?? 12;
      const colour = c.colour ?? "#e8d8c3";
      if (c.footprint) {
        return [{ ring: c.footprint, layer: "solid", base: 0, height, colour }];
      }
      return [
        box(0, 0, length, width, 0, height, colour),
        box(
          0,
          0,
          Math.max(length - 2, 1),
          Math.max(width - 2, 1),
          height,
          height + 0.6,
          shade(colour, -0.18),
        ),
        box(length / 4, width / 5, 3, 2.5, height + 0.6, height + 2, "#9aa0a6"),
      ];
    }
    case "green_area":
      return [
        {
          ring: rect(0, 0, length, width),
          layer: "ground",
          colour: COLOURS.grass,
        },
      ];
    case "speed_hump": {
      // A low raised strip with white chevron bars across it.
      const parts: Part[] = [box(0, 0, length, width, 0, 0.08, COLOURS.hump)];
      for (let x = -length / 2 + 0.9; x <= length / 2 - 0.6; x += 1.5) {
        parts.push(box(x, 0, 0.35, width * 0.6, 0.08, 0.09, COLOURS.white));
      }
      return parts;
    }
    case "circle_bench":
      return circleBenchParts(c.width ?? CIRCLE_BENCH_DIAMETER);
    case "tree": {
      const crown = (c.width ?? TREE_CROWN) / 2;
      const base = 1.8 + crown * 0.25;
      return [
        box(0, 0, 0.35, 0.35, 0, base + 0.6, "#6b4a2b"),
        {
          ring: polygon(0, 0, crown, 10),
          layer: "solid",
          base,
          height: base + crown * 1.1,
          colour: "#4f9a4a",
        },
        {
          ring: polygon(0, 0, crown * 0.62, 8, 0.3),
          layer: "solid",
          base: base + crown * 1.1,
          height: base + crown * 1.6,
          colour: "#63ad57",
        },
      ];
    }
    case "bench":
      return [
        box(-0.75, 0, 0.12, 0.45, 0, 0.42, COLOURS.metal),
        box(0.75, 0, 0.12, 0.45, 0, 0.42, COLOURS.metal),
        box(0, 0, 1.8, 0.5, 0.42, 0.5, COLOURS.wood),
        box(0, 0.24, 1.8, 0.08, 0.5, 0.95, COLOURS.wood),
      ];
    case "traffic_light":
      return [
        box(0, 0, 0.25, 0.25, 0, 5.6, COLOURS.metal),
        box(2.4, 0, 4.8, 0.15, 5.3, 5.45, COLOURS.metal),
        box(4.4, 0, 0.45, 0.45, 4.1, 5.3, COLOURS.signalHead),
        // Lamps face local +y, towards the traffic the signal controls.
        box(4.4, 0.25, 0.28, 0.06, 4.95, 5.2, COLOURS.red),
        box(4.4, 0.25, 0.28, 0.06, 4.6, 4.85, COLOURS.amber),
        box(4.4, 0.25, 0.28, 0.06, 4.25, 4.5, COLOURS.green),
        box(0, 0.25, 0.3, 0.3, 2.4, 3.4, COLOURS.signalHead),
      ];
    case "stop_sign":
      return [
        box(0, 0, 0.08, 0.08, 0, 2.2, COLOURS.metal),
        box(0, -0.06, 0.75, 0.05, 2.2, 2.95, COLOURS.red),
      ];
    case "yield_sign":
      return [
        box(0, 0, 0.08, 0.08, 0, 2.2, COLOURS.metal),
        box(0, -0.06, 0.8, 0.05, 2.45, 2.95, COLOURS.red),
        box(0, -0.09, 0.5, 0.03, 2.55, 2.85, COLOURS.white),
        box(0, -0.06, 0.3, 0.05, 2.2, 2.45, COLOURS.red),
      ];
    case "no_left_turn":
    case "no_right_turn":
    case "no_u_turn":
    case "no_straight_on":
      return [
        box(0, 0, 0.08, 0.08, 0, 2.2, COLOURS.metal),
        box(0, -0.06, 0.6, 0.05, 2.2, 2.8, COLOURS.white),
        box(0, -0.09, 0.5, 0.03, 2.45, 2.55, COLOURS.red),
      ];
    case "speed_sign":
      return [
        box(0, 0, 0.08, 0.08, 0, 2.0, COLOURS.metal),
        box(0, -0.06, 0.6, 0.05, 2.0, 2.8, COLOURS.paint),
      ];
    case "streetlight":
      return [
        box(0, 0, 0.22, 0.22, 0, 8, COLOURS.metal),
        box(0.9, 0, 1.8, 0.1, 7.8, 7.95, COLOURS.metal),
        box(1.75, 0, 0.6, 0.3, 7.55, 7.8, COLOURS.lamp),
      ];
    case "removed_osm":
      return [];
    case "transit_shelter":
      return [
        box(0, 0.75, 4, 0.08, 0, 2.4, COLOURS.glass),
        box(-1.96, 0, 0.08, 1.5, 0, 2.4, COLOURS.glass),
        box(1.96, 0, 0.08, 1.5, 0, 2.4, COLOURS.metal),
        box(0, 0.1, 4.3, 1.8, 2.4, 2.55, COLOURS.metal),
        box(0, 0.5, 2.4, 0.4, 0.42, 0.5, COLOURS.wood),
      ];
    case "streetcar": {
      const parts: Part[] = [
        box(0, 0, length, width, 0.3, 1.4, COLOURS.ttcRed),
        box(0, 0, length - 0.4, width - 0.1, 1.4, 2.5, COLOURS.window),
        box(0, 0, length, width, 2.5, 3.3, COLOURS.ttcRed),
        box(0, 0, 4, 1.4, 3.3, 3.6, COLOURS.metal),
      ];
      // Section joints so it reads as an articulated vehicle.
      for (const x of [-length / 6, length / 6]) {
        parts.push(box(x, 0, 0.5, width + 0.02, 1.4, 2.5, "#8d1a14"));
      }
      return parts;
    }
  }
}

/** Rectangles covering a polyline of the given width, one per segment, with
 *  square joints so bends have no gaps. */
function pathRects(path: Vec2[], width: number): Vec2[][] {
  const rings: Vec2[][] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay] = path[i];
    const [bx, by] = path[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.01) continue;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const nx = (-uy * width) / 2;
    const ny = (ux * width) / 2;
    const ex = (ux * width) / 2;
    const ey = (uy * width) / 2;
    rings.push([
      [ax - ex + nx, ay - ey + ny],
      [bx + ex + nx, by + ey + ny],
      [bx + ex - nx, by + ey - ny],
      [ax - ex - nx, ay - ey - ny],
    ]);
  }
  return rings;
}

// Plan-view size used for clearance and measurement of small objects.
const POINT_SIZES: Partial<Record<ComponentKind, [number, number]>> = {
  bench: [1.8, 0.5],
  // Only the trunk claims ground; people and benches may sit under the crown.
  tree: [0.5, 0.5],
  traffic_light: [0.3, 0.3],
  stop_sign: [0.2, 0.2],
  yield_sign: [0.2, 0.2],
  speed_sign: [0.2, 0.2],
  no_left_turn: [0.2, 0.2],
  no_right_turn: [0.2, 0.2],
  no_u_turn: [0.2, 0.2],
  no_straight_on: [0.2, 0.2],
  streetlight: [0.3, 0.3],
  transit_shelter: [4.3, 1.8],
};

/**
 * The component's footprint on the ground as one or more convex polygons in
 * world (local-metre) coordinates. Used for measuring, collisions and rules.
 */
export function outlines(c: SceneComponent): Vec2[][] {
  if (c.kind === "removed_osm") return [];
  if (c.path) {
    return pathRects(c.path, c.width ?? 6).map((ring) =>
      place(ring, c.x, c.y, c.rotation),
    );
  }
  if (c.footprint) return [place(c.footprint, c.x, c.y, c.rotation)];
  if (c.kind === "circle_bench") {
    const d = c.width ?? CIRCLE_BENCH_DIAMETER;
    return [place(polygon(0, 0, d / 2, 12), c.x, c.y, c.rotation)];
  }
  const size =
    c.length !== undefined && c.width !== undefined
      ? [c.length, c.width]
      : (POINT_SIZES[c.kind] ?? [1, 1]);
  return [place(rect(0, 0, size[0], size[1]), c.x, c.y, c.rotation)];
}

/** World-frame parts; `scale` drives the grow-in animation for new drops. */
export function componentParts(c: SceneComponent, scale = 1): Part[] {
  return localParts(c).map((part) => ({
    ...part,
    ring: place(part.ring, c.x, c.y, c.rotation, scale),
    base: part.base === undefined ? undefined : part.base * scale,
    height: part.height === undefined ? undefined : part.height * scale,
  }));
}

function shade(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const c = (value >> shift) & 0xff;
    const mixed = amount < 0 ? c * (1 + amount) : c + (255 - c) * amount;
    return Math.round(mixed).toString(16).padStart(2, "0");
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}
