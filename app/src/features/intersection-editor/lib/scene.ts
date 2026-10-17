import {
  isLane,
  LANE_WIDTHS,
  TOOL_BY_KIND,
  type ComponentKind,
  type LaneKind,
  type SceneComponent,
} from "./components";

// Cross-section of each street, measured from its centreline: streetcar track,
// general traffic lane, then painted bike lane, mirrored on both sides.
export const ROAD_HALF_WIDTH =
  LANE_WIDTHS.streetcar_lane + LANE_WIDTHS.car_lane + LANE_WIDTHS.bike_lane;
export const SIDEWALK_WIDTH = 4;
/** Distance from the junction centre to the end of each street arm. */
export const ARM_LENGTH = 110;

export type Arm = "north" | "south" | "east" | "west";
export const ARMS: Arm[] = ["north", "east", "south", "west"];

export interface LanePlacement {
  arm: Arm;
  direction: "inbound" | "outbound";
  /** Distance from the street centreline; larger is further right for drivers. */
  offset: number;
}

function isNorthSouth(rotation: number) {
  const r = ((rotation % 180) + 180) % 180;
  return Math.abs(r - 90) < 45;
}

/** Which street arm and travel direction a lane serves (right-hand traffic). */
export function lanePlacement(c: SceneComponent): LanePlacement {
  if (isNorthSouth(c.rotation)) {
    const arm = c.y >= 0 ? "north" : "south";
    const inbound = arm === "north" ? c.x < 0 : c.x > 0;
    return {
      arm,
      direction: inbound ? "inbound" : "outbound",
      offset: Math.abs(c.x),
    };
  }
  const arm = c.x >= 0 ? "east" : "west";
  const inbound = arm === "east" ? c.y > 0 : c.y < 0;
  return {
    arm,
    direction: inbound ? "inbound" : "outbound",
    offset: Math.abs(c.y),
  };
}

/** The arm a free-standing object (such as a speed sign) belongs to. */
export function armAt(x: number, y: number): Arm {
  if (Math.abs(x) > Math.abs(y)) return x >= 0 ? "east" : "west";
  return y >= 0 ? "north" : "south";
}

const ARM_LABEL: Record<Arm, string> = {
  north: "North arm",
  south: "South arm",
  east: "East arm",
  west: "West arm",
};

export function describe(c: SceneComponent): string {
  const label = TOOL_BY_KIND[c.kind].label;
  if (isLane(c.kind) && onIntersectionArm(c.x, c.y)) {
    const { arm, direction } = lanePlacement(c);
    return `${label} · ${ARM_LABEL[arm]}, ${direction}`;
  }
  if (c.kind === "speed_sign") {
    return `${label} ${c.speedKmh ?? 40} km/h · ${ARM_LABEL[armAt(c.x, c.y)]}`;
  }
  return c.osmId !== undefined ? `${label} (from the map)` : label;
}

export function newId(kind: ComponentKind) {
  return `${kind}-${crypto.randomUUID().slice(0, 8)}`;
}

function insideJunction(x: number, y: number) {
  const limit = ROAD_HALF_WIDTH + 1;
  return Math.abs(x) < limit && Math.abs(y) < limit;
}

/** Whether a point is on one of the sample intersection's four street arms. */
export function onIntersectionArm(x: number, y: number) {
  const lateral = Math.min(Math.abs(x), Math.abs(y));
  const along = Math.max(Math.abs(x), Math.abs(y));
  return lateral <= ROAD_HALF_WIDTH + 1 && along <= ARM_LENGTH;
}

const FREE_LANE_LENGTH = 30;

/**
 * Build the component for a toolbox drop at local (x, y). On the sample
 * intersection, lanes and crosswalks snap to the street arm under the cursor;
 * anywhere else they are placed freely (rotate or resize them afterwards).
 * Returns an error message instead when the drop does not make sense.
 */
export function componentFromDrop(
  kind: ComponentKind,
  x: number,
  y: number,
): SceneComponent | string {
  const base = { ...TOOL_BY_KIND[kind].defaults, id: newId(kind), kind };
  const northSouth = Math.abs(y) > Math.abs(x);
  const round = (v: number) => Math.round(v * 10) / 10;

  const snaps = onIntersectionArm(x, y);
  if ((isLane(kind) || kind === "crosswalk") && !snaps) {
    if (insideJunction(x, y)) return "Drop lanes onto one of the street arms.";
    const length = kind === "crosswalk" ? 10 : FREE_LANE_LENGTH;
    return { ...base, x: round(x), y: round(y), rotation: 0, length };
  }
  if (isLane(kind)) {
    if (insideJunction(x, y)) return "Drop lanes onto one of the street arms.";
    const span = ARM_LENGTH - ROAD_HALF_WIDTH;
    const along = (ROAD_HALF_WIDTH + ARM_LENGTH) / 2;
    return northSouth
      ? {
          ...base,
          x: round(x),
          y: Math.sign(y) * along,
          rotation: 90,
          length: span,
        }
      : {
          ...base,
          x: Math.sign(x) * along,
          y: round(y),
          rotation: 0,
          length: span,
        };
  }
  if (kind === "crosswalk") {
    if (insideJunction(x, y)) return "Drop crosswalks across a street arm.";
    return northSouth
      ? { ...base, x: 0, y: round(y), rotation: 0 }
      : { ...base, x: round(x), y: 0, rotation: 90 };
  }
  if (kind === "streetcar" || kind === "sidewalk" || kind === "road") {
    return { ...base, x: round(x), y: round(y), rotation: northSouth ? 90 : 0 };
  }
  return { ...base, x: round(x), y: round(y), rotation: 0 };
}

// --- Default scene ---------------------------------------------------------
// Street-level components only; buildings come from the OpenStreetMap basemap.

export function defaultScene(): SceneComponent[] {
  const scene: SceneComponent[] = [];
  const add = (c: Omit<SceneComponent, "id">, id: string) =>
    scene.push({ ...c, id });
  const H = ROAD_HALF_WIDTH;
  const along = (H + ARM_LENGTH) / 2;
  const span = ARM_LENGTH - H;

  add(
    {
      kind: "intersection",
      x: 0,
      y: 0,
      rotation: 0,
      length: 2 * H,
      width: 2 * H,
    },
    "intersection",
  );

  // Lanes: each side of each arm gets streetcar, car and bike lanes.
  const sequence: LaneKind[] = ["streetcar_lane", "car_lane", "bike_lane"];
  for (const arm of ARMS) {
    for (const side of [-1, 1]) {
      let offset = 0;
      for (const kind of sequence) {
        const width = LANE_WIDTHS[kind];
        const lateral = side * (offset + width / 2);
        offset += width;
        const vertical = arm === "north" || arm === "south";
        const sign = arm === "north" || arm === "east" ? 1 : -1;
        const lane: Omit<SceneComponent, "id"> = vertical
          ? {
              kind,
              x: lateral,
              y: sign * along,
              rotation: 90,
              length: span,
              width,
            }
          : {
              kind,
              x: sign * along,
              y: lateral,
              rotation: 0,
              length: span,
              width,
            };
        add(lane, `${kind}-${arm}-${side > 0 ? "a" : "b"}`);
      }
      // Sidewalk alongside the arm.
      const swOffset = side * (H + SIDEWALK_WIDTH / 2);
      const vertical = arm === "north" || arm === "south";
      const sign = arm === "north" || arm === "east" ? 1 : -1;
      add(
        vertical
          ? {
              kind: "sidewalk",
              x: swOffset,
              y: sign * along,
              rotation: 90,
              length: span,
              width: SIDEWALK_WIDTH,
            }
          : {
              kind: "sidewalk",
              x: sign * along,
              y: swOffset,
              rotation: 0,
              length: span,
              width: SIDEWALK_WIDTH,
            },
        `sidewalk-${arm}-${side > 0 ? "a" : "b"}`,
      );
    }
    const vertical = arm === "north" || arm === "south";
    const sign = arm === "north" || arm === "east" ? 1 : -1;
    add(
      vertical
        ? {
            kind: "crosswalk",
            x: 0,
            y: sign * (H + 2),
            rotation: 0,
            length: 2 * H,
            width: 3,
          }
        : {
            kind: "crosswalk",
            x: sign * (H + 2),
            y: 0,
            rotation: 90,
            length: 2 * H,
            width: 3,
          },
      `crosswalk-${arm}`,
    );
  }

  // Corner plazas and signals. Each mast arm hangs over the far-side approach.
  const corner = H + SIDEWALK_WIDTH / 2;
  const signalRotation: Record<string, number> = {
    "1,1": 180,
    "-1,1": 270,
    "-1,-1": 0,
    "1,-1": 90,
  };
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      add(
        {
          kind: "sidewalk",
          x: sx * corner,
          y: sy * corner,
          rotation: 0,
          length: SIDEWALK_WIDTH,
          width: SIDEWALK_WIDTH,
        },
        `sidewalk-corner-${sx}${sy}`,
      );
      add(
        {
          kind: "traffic_light",
          x: sx * (H + 1.8),
          y: sy * (H + 1.8),
          rotation: signalRotation[`${sx},${sy}`],
        },
        `traffic_light-${sx}${sy}`,
      );
    }
  }

  // Street trees and benches along every sidewalk.
  const kerbside = H + 3.2;
  for (const arm of ARMS) {
    const vertical = arm === "north" || arm === "south";
    const sign = arm === "north" || arm === "east" ? 1 : -1;
    for (const side of [-1, 1]) {
      for (const d of [22, 38, 54, 70, 86, 102]) {
        const [x, y] = vertical
          ? [side * kerbside, sign * d]
          : [sign * d, side * kerbside];
        add({ kind: "tree", x, y, rotation: 0 }, `tree-${arm}-${side}-${d}`);
      }
      for (const d of [46, 78]) {
        const offset = H + 2.6;
        const [x, y] = vertical
          ? [side * offset, sign * d]
          : [sign * d, side * offset];
        // Benches face the street: backrest (local +y) away from it.
        const rotation = vertical ? (side > 0 ? -90 : 90) : side > 0 ? 0 : 180;
        add({ kind: "bench", x, y, rotation }, `bench-${arm}-${side}-${d}`);
      }
    }
  }

  // Speed limits: 50 km/h on the north–south avenue, 40 km/h on the cross street.
  add(
    { kind: "speed_sign", x: kerbside, y: 30, rotation: 0, speedKmh: 50 },
    "speed_sign-north",
  );
  add(
    { kind: "speed_sign", x: -kerbside, y: -30, rotation: 0, speedKmh: 50 },
    "speed_sign-south",
  );
  add(
    { kind: "speed_sign", x: 30, y: -kerbside, rotation: 90, speedKmh: 40 },
    "speed_sign-east",
  );
  add(
    { kind: "speed_sign", x: -30, y: kerbside, rotation: 90, speedKmh: 40 },
    "speed_sign-west",
  );

  add(
    { kind: "transit_shelter", x: -(H + 2.4), y: 30, rotation: 90 },
    "transit_shelter-north",
  );
  add(
    {
      kind: "streetcar",
      x: -LANE_WIDTHS.streetcar_lane / 2,
      y: 52,
      rotation: 90,
      length: 30,
      width: 2.6,
    },
    "streetcar-north",
  );
  add(
    {
      kind: "streetcar",
      x: -60,
      y: -LANE_WIDTHS.streetcar_lane / 2,
      rotation: 0,
      length: 30,
      width: 2.6,
    },
    "streetcar-west",
  );

  return scene;
}
