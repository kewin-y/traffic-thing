import {
  ROADWAY_KINDS,
  type ComponentKind,
  type SceneComponent,
} from "./components";
import { centreDistance, componentsOverlap, gapBetween } from "./spatial";

// Guidance the "Check" button tests against. Each rule cites where the number
// comes from; zone-specific zoning limits (height, density) are not modelled.
export const SOURCES = {
  laneWidths: {
    name: "City of Toronto Road Engineering Design Guidelines: Lane Widths (2018)",
    url: "https://www.toronto.ca/wp-content/uploads/2018/05/986b-Lane-Widths-Guideline-Version-2.0.1-May-2018.pdf",
  },
  clearway: {
    name: "City of Toronto standard T-310.010-10, pedestrian clearway widths",
    url: "https://www.toronto.ca/wp-content/uploads/2018/10/983b-ecs-specs-roadwd-T-310.010-10_Rev1_Sep2018.pdf",
  },
  stopSigns: {
    name: "Highway Traffic Act, R.R.O. 1990, Reg. 623: Stop Signs at Intersections",
    url: "https://www.ontario.ca/laws/regulation/900623",
  },
  signalSpacing: {
    name: "City of Toronto Transportation Services: Spacing of Traffic Signals",
    url: "https://www.toronto.ca/wp-content/uploads/2024/09/9769-TSClosely-Spaced-Signals-PolicyFinal.pdf",
  },
  speedLimits: {
    name: "City of Toronto Vision Zero: speed limit reductions",
    url: "https://www.toronto.ca/services-payments/streets-parking-transportation/road-safety/vision-zero/safety-initiatives/initiatives/speed-limit-reductions/",
  },
  separation: {
    name: "City of Toronto minimum separation distances (CaféTO, 2026)",
    url: "https://www.toronto.ca/wp-content/uploads/2026/07/8efa-Minimum-Separation-Distance.pdf",
  },
  streetUse: {
    name: "Toronto Municipal Code Chapter 743, Streets and Sidewalks, Use of",
    url: "https://www.toronto.ca/legdocs/municode/1184_743.pdf",
  },
  zoning: {
    name: "City of Toronto Zoning By-law 569-2013",
    url: "https://www.toronto.ca/city-government/planning-development/zoning-by-law-preliminary-zoning-reviews/zoning-by-law-569-2013-2/",
  },
} as const;

export type SourceKey = keyof typeof SOURCES;

export interface Issue {
  componentId: string;
  message: string;
  source: SourceKey;
}

const FURNITURE: ComponentKind[] = ["bench", "transit_shelter"];
const STREET_OBJECTS: ComponentKind[] = [
  "tree",
  "bench",
  "transit_shelter",
  "streetlight",
  "stop_sign",
  "speed_sign",
  "traffic_light",
];
// Signals closer than this are treated as the same intersection.
const SAME_INTERSECTION_M = 40;
const SIGNAL_SPACING_M = 215;

const metres = (value: number) => `${value.toFixed(1)} m`;

export function checkScene(scene: SceneComponent[]): Issue[] {
  const issues: Issue[] = [];
  const add = (c: SceneComponent, source: SourceKey, message: string) => {
    // One issue per component keeps the markers readable; the first found wins.
    if (!issues.some((issue) => issue.componentId === c.id)) {
      issues.push({ componentId: c.id, message, source });
    }
  };
  const live = scene.filter((c) => c.kind !== "removed_osm");
  const roadway = live.filter((c) => ROADWAY_KINDS.includes(c.kind));
  const ofKind = (...kinds: ComponentKind[]) =>
    live.filter((c) => kinds.includes(c.kind));

  // Widths of travel lanes and sidewalks.
  for (const c of live) {
    const width = c.width;
    if (width === undefined) continue;
    if (c.kind === "car_lane" && width < 3.0) {
      add(
        c,
        "laneWidths",
        `This ${metres(width)} lane is narrower than the 3.0 m minimum for a Toronto traffic lane.`,
      );
    } else if (c.kind === "car_lane" && width > 4.3) {
      add(
        c,
        "laneWidths",
        `At ${metres(width)}, this lane is wider than the 4.3 m maximum; wide lanes encourage speeding.`,
      );
    } else if (c.kind === "streetcar_lane" && width < 3.1) {
      add(
        c,
        "laneWidths",
        `Lanes used by TTC streetcars should be at least 3.1 m wide; this one is ${metres(width)}.`,
      );
    } else if (c.kind === "road" && !c.path && width / 2 < 3.0) {
      add(
        c,
        "laneWidths",
        `Each lane of this two-lane road is ${metres(width / 2)}, below the 3.0 m minimum lane width.`,
      );
    } else if (c.kind === "sidewalk" && width < 2.1) {
      add(
        c,
        "clearway",
        `This ${metres(width)} sidewalk is below the 2.1 m minimum pedestrian clearway on Toronto arterial streets.`,
      );
    }
  }

  // Sidewalks, furniture and buildings may not sit on the roadway.
  for (const c of ofKind("sidewalk", "building", ...STREET_OBJECTS)) {
    const blocking = roadway.find((r) => componentsOverlap(c, r, 0.05));
    if (!blocking) continue;
    if (c.kind === "building") {
      add(
        c,
        "zoning",
        "This building extends into the street; buildings must stay on their lot behind the street line.",
      );
    } else if (c.kind === "sidewalk") {
      add(
        c,
        "clearway",
        "This sidewalk overlaps the roadway; pedestrian clearways must be kept separate from traffic lanes.",
      );
    } else {
      add(
        c,
        "streetUse",
        "This object sits in a travel lane; nothing may be placed on a City street without a permit.",
      );
    }
  }

  // Stop signs belong at unsignalized intersections only.
  const signals = ofKind("traffic_light");
  for (const sign of ofKind("stop_sign")) {
    if (signals.some((s) => centreDistance(sign, s) < SAME_INTERSECTION_M)) {
      add(
        sign,
        "stopSigns",
        "Stop signs assign right-of-way where there are no traffic signals; this one is at a signalized intersection.",
      );
    }
  }

  // Signalized intersections need room between them.
  const clusters: SceneComponent[][] = [];
  for (const signal of signals) {
    const cluster = clusters.find((group) =>
      group.some((s) => centreDistance(s, signal) < SAME_INTERSECTION_M),
    );
    if (cluster) cluster.push(signal);
    else clusters.push([signal]);
  }
  const centre = (group: SceneComponent[]) => ({
    x: group.reduce((sum, c) => sum + c.x, 0) / group.length,
    y: group.reduce((sum, c) => sum + c.y, 0) / group.length,
  });
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const a = centre(clusters[i]);
      const b = centre(clusters[j]);
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance < SIGNAL_SPACING_M) {
        add(
          clusters[j][0],
          "signalSpacing",
          `This signal is ${Math.round(distance)} m from the next signalized intersection; spacing under 215 m needs a City spacing review.`,
        );
      }
    }
  }

  // Posted speeds above downtown Vision Zero limits.
  for (const sign of ofKind("speed_sign")) {
    if ((sign.speedKmh ?? 40) > 50) {
      add(
        sign,
        "speedLimits",
        `${sign.speedKmh} km/h is above Toronto's Vision Zero limits, which cap major arterials at 50 km/h.`,
      );
    }
  }

  // Clearances around street furniture, trees and crossings.
  const trees = ofKind("tree");
  const lights = ofKind("streetlight");
  const crossings = ofKind("crosswalk");
  for (const item of ofKind(...FURNITURE)) {
    const tree = trees.find(
      (t) => (gapBetween(item, t)?.distance ?? Infinity) < 1.0,
    );
    if (tree) {
      add(
        item,
        "separation",
        "Street furniture needs 1.0 m of clearance from street trees; move it further from the tree.",
      );
      continue;
    }
    const light = lights.find(
      (l) => (gapBetween(item, l)?.distance ?? Infinity) < 0.6,
    );
    if (light) {
      add(
        item,
        "separation",
        "Keep 0.6 m clear around street lighting poles so they can be reached and maintained.",
      );
    }
  }
  for (const item of ofKind(...FURNITURE, "tree", "streetlight")) {
    const crossing = crossings.find(
      (x) => (gapBetween(item, x)?.distance ?? Infinity) < 3.0,
    );
    if (crossing) {
      add(
        item,
        "separation",
        "Keep 3.0 m clear of crosswalks so people waiting to cross have room and drivers can see them.",
      );
    }
  }
  return issues;
}
