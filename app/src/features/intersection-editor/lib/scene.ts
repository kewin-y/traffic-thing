import {
  isLane,
  LANE_WIDTHS,
  TOOL_BY_KIND,
  type ComponentKind,
  type SceneComponent,
} from "./components";

// Cross-section of each street, measured from its centreline: streetcar track,
// general traffic lane, then painted bike lane, mirrored on both sides.
export const ROAD_HALF_WIDTH =
  LANE_WIDTHS.streetcar_lane + LANE_WIDTHS.car_lane + LANE_WIDTHS.bike_lane;
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
  if (c.kind === "speed_sign") return `${label} ${c.speedKmh ?? 40} km/h`;
  if (c.hours) return `${label} (${c.hours})`;
  return c.osmId !== undefined ? `${label} (from the map)` : label;
}

export function newId(kind: ComponentKind) {
  return `${kind}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Whether a point is on one of the sample intersection's four street arms. */
export function onIntersectionArm(x: number, y: number) {
  const lateral = Math.min(Math.abs(x), Math.abs(y));
  const along = Math.max(Math.abs(x), Math.abs(y));
  return lateral <= ROAD_HALF_WIDTH + 1 && along <= ARM_LENGTH;
}

const FREE_LANE_LENGTH = 30;

/**
 * Build the component for a toolbox drop at local (x, y). Linear parts are
 * placed along the street grid; rotate or resize them afterwards.
 */
export function componentFromDrop(
  kind: ComponentKind,
  x: number,
  y: number,
): SceneComponent {
  const base = { ...TOOL_BY_KIND[kind].defaults, id: newId(kind), kind };
  const round = (v: number) => Math.round(v * 10) / 10;
  if (isLane(kind) || kind === "crosswalk") {
    const length = kind === "crosswalk" ? 10 : FREE_LANE_LENGTH;
    return { ...base, x: round(x), y: round(y), rotation: 0, length };
  }
  return { ...base, x: round(x), y: round(y), rotation: 0 };
}
