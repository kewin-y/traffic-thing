import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type {
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from "maplibre-gl";
import type { ComponentKind, SceneComponent, TurnBanKind } from "./components";
import { toLngLat, toLocal, type Vec2 } from "./geometry";
import { findSceneComponent } from "./scene-edits";
import { trimIconPadding } from "./icon-image";

// Real-world signals, signs and posted limits from the imported OpenStreetMap
// snapshot (scripts/extract-traffic-controls.py). Shown as a reference layer;
// clicking one inspects it; edits are saved as one source-linked override.

export const CONTROLS_URL = "/data/toronto-traffic-controls.geojson";
export const CONTROLS_SOURCE = "traffic-controls";
export const CONTROL_ICONS_LAYER = "traffic-control-icons";
export const SPEED_LIMITS_LAYER = "traffic-speed-limits";
export const SCENE_CONTROL_SOURCE = "editable-traffic-controls";
export const SCENE_CONTROL_LAYER = "editable-traffic-control-icons";

export type ControlKind =
  "traffic_light" | "stop_sign" | "yield_sign" | "speed_hump" | TurnBanKind;

const CONTROL_KINDS: readonly ControlKind[] = [
  "traffic_light",
  "stop_sign",
  "yield_sign",
  "speed_hump",
  "no_left_turn",
  "no_right_turn",
  "no_u_turn",
  "no_straight_on",
];

export interface ControlProperties {
  kind: ControlKind | "speed_limit";
  /** OpenStreetMap element, such as "node/123"; hides it once converted. */
  ref: string;
  /** Compass bearing of the traffic the control faces, when known. */
  heading?: number;
  allWay?: boolean;
  hours?: string;
  speedKmh?: number;
}

export type ControlFeature = Feature<Point | LineString, ControlProperties>;
export type TrafficControls = FeatureCollection<
  Point | LineString,
  ControlProperties
>;

const LABELS: Record<ControlKind | "speed_limit", string> = {
  traffic_light: "Traffic signal",
  stop_sign: "Stop sign",
  yield_sign: "Yield sign",
  speed_hump: "Speed hump",
  no_left_turn: "No left turn",
  no_right_turn: "No right turn",
  no_u_turn: "No U-turn",
  no_straight_on: "No straight through",
  speed_limit: "Posted speed limit",
};

function isControl(value: unknown): value is ControlFeature {
  const feature = value as ControlFeature | null;
  const props = feature?.properties;
  if (!props || typeof props.ref !== "string") return false;
  if (props.kind === "speed_limit")
    return (
      feature.geometry?.type === "LineString" && Number.isFinite(props.speedKmh)
    );
  return (
    CONTROL_KINDS.includes(props.kind) &&
    feature.geometry?.type === "Point" &&
    feature.geometry.coordinates.every(Number.isFinite)
  );
}

export async function loadControls(
  signal: AbortSignal,
): Promise<TrafficControls> {
  const response = await fetch(CONTROLS_URL, { signal });
  if (!response.ok) throw new Error("Traffic controls download failed");
  const data = (await response.json()) as { features?: unknown };
  if (!Array.isArray(data.features))
    throw new Error("Traffic controls are malformed");
  return {
    type: "FeatureCollection",
    features: data.features.filter(isControl),
  };
}

/** Plain-language description, for the read-only notice. */
export function describeControl(props: ControlProperties): string {
  const label =
    props.kind === "speed_limit"
      ? `${LABELS.speed_limit} ${props.speedKmh} km/h`
      : props.kind === "stop_sign" && props.allWay
        ? "All-way stop sign"
        : LABELS[props.kind];
  return props.hours ? `${label} (${props.hours})` : label;
}

/** Local-frame unit vector of traffic travelling on a compass heading. */
function travel(lng: number, lat: number, heading: number): Vec2 {
  const rad = (heading * Math.PI) / 180;
  const metres = 10;
  const [px, py] = toLocal(lng, lat);
  const [qx, qy] = toLocal(
    lng +
      (metres * Math.sin(rad)) / (111_320 * Math.cos((lat * Math.PI) / 180)),
    lat + (metres * Math.cos(rad)) / 110_574,
  );
  const length = Math.hypot(qx - px, qy - py);
  return [(qx - px) / length, (qy - py) / length];
}

const round = (v: number) => Math.round(v * 10) / 10;

/**
 * The editable component for a real-world control. Signs and signals face
 * the traffic they govern: their local +y points back along its travel.
 * Inspecting a source feature never relocates it or creates a new identity.
 */
export function componentFromControl(
  props: ControlProperties,
  at: { lng: number; lat: number },
  along?: number,
): SceneComponent {
  const kind: ComponentKind =
    props.kind === "speed_limit" ? "speed_sign" : props.kind;
  const [x, y] = toLocal(at.lng, at.lat);
  const heading = props.heading ?? along;
  let rotation = 0;
  if (heading !== undefined) {
    const [tx, ty] = travel(at.lng, at.lat, heading);
    rotation = Math.round((Math.atan2(tx, -ty) * 180) / Math.PI);
  }
  return {
    id: `map-control-${props.ref}`,
    kind,
    x: round(x),
    y: round(y),
    rotation,
    ...(kind === "speed_hump" ? { length: 7, width: 3.7 } : {}),
    ...(props.speedKmh !== undefined ? { speedKmh: props.speedKmh } : {}),
    ...(props.hours ? { hours: props.hours } : {}),
    osmId: props.ref,
  };
}

/** Resolve an existing edit before considering the original reference feature. */
export function resolveControl(
  scene: SceneComponent[],
  props: ControlProperties,
  at: { lng: number; lat: number },
  along?: number,
) {
  const original = componentFromControl(props, at, along);
  return findSceneComponent(scene, original) ?? original;
}

// --- Map icons ---------------------------------------------------------------

const ICON_PX = 64;

function canvas(width = ICON_PX, height = ICON_PX) {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  return element.getContext("2d")!;
}

function turnBan(
  g: CanvasRenderingContext2D,
  arrow: (g: CanvasRenderingContext2D) => void,
) {
  g.fillStyle = "#fff";
  g.strokeStyle = "#111";
  g.lineWidth = 2;
  g.beginPath();
  g.roundRect(6, 4, 52, 56, 5);
  g.fill();
  g.stroke();
  g.lineWidth = 5;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  arrow(g);
  g.stroke();
  g.strokeStyle = "#e5392f";
  g.lineWidth = 4.5;
  g.beginPath();
  g.arc(32, 32, 21, 0, Math.PI * 2);
  g.moveTo(17, 17);
  g.lineTo(47, 47);
  g.stroke();
}

const ICONS: Record<ControlKind, (g: CanvasRenderingContext2D) => void> = {
  traffic_light(g) {
    g.fillStyle = "#1f2124";
    g.strokeStyle = "#fff";
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(18, 2, 28, 60, 7);
    g.fill();
    g.stroke();
    for (const [y, colour] of [
      [14, "#e5392f"],
      [32, "#f2b134"],
      [50, "#3fcf6a"],
    ] as const) {
      g.fillStyle = colour;
      g.beginPath();
      g.arc(32, y, 7, 0, Math.PI * 2);
      g.fill();
    }
  },
  stop_sign(g) {
    g.fillStyle = "#e5392f";
    g.strokeStyle = "#fff";
    g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = Math.PI / 8 + (i * Math.PI) / 4;
      g.lineTo(32 + 29 * Math.cos(a), 32 + 29 * Math.sin(a));
    }
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = "#fff";
    g.font = "bold 17px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("STOP", 32, 33);
  },
  yield_sign(g) {
    g.fillStyle = "#e5392f";
    g.beginPath();
    g.moveTo(3, 6);
    g.lineTo(61, 6);
    g.lineTo(32, 60);
    g.closePath();
    g.fill();
    g.fillStyle = "#fff";
    g.beginPath();
    g.moveTo(16, 13);
    g.lineTo(48, 13);
    g.lineTo(32, 43);
    g.closePath();
    g.fill();
  },
  speed_hump(g) {
    g.fillStyle = "#f2c230";
    g.strokeStyle = "#111";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(32, 2);
    g.lineTo(62, 32);
    g.lineTo(32, 62);
    g.lineTo(2, 32);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = "#111";
    g.beginPath();
    g.moveTo(14, 40);
    g.quadraticCurveTo(32, 14, 50, 40);
    g.closePath();
    g.fill();
  },
  no_left_turn: (g) =>
    turnBan(g, (p) => {
      p.moveTo(38, 50);
      p.lineTo(38, 30);
      p.lineTo(22, 30);
      p.moveTo(28, 23);
      p.lineTo(21, 30);
      p.lineTo(28, 37);
    }),
  no_right_turn: (g) =>
    turnBan(g, (p) => {
      p.moveTo(26, 50);
      p.lineTo(26, 30);
      p.lineTo(42, 30);
      p.moveTo(36, 23);
      p.lineTo(43, 30);
      p.lineTo(36, 37);
    }),
  no_u_turn: (g) =>
    turnBan(g, (p) => {
      p.moveTo(24, 50);
      p.lineTo(24, 28);
      p.arc(32, 28, 8, Math.PI, 0);
      p.lineTo(40, 42);
      p.moveTo(34, 36);
      p.lineTo(40, 43);
      p.lineTo(46, 36);
    }),
  no_straight_on: (g) =>
    turnBan(g, (p) => {
      p.moveTo(32, 52);
      p.lineTo(32, 16);
      p.moveTo(25, 23);
      p.lineTo(32, 16);
      p.lineTo(39, 23);
    }),
};

function speedPlate(speed: number) {
  const g = canvas(48, 60);
  g.fillStyle = "#fff";
  g.strokeStyle = "#111";
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(2, 2, 44, 56, 4);
  g.fill();
  g.stroke();
  g.fillStyle = "#111";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = "bold 11px sans-serif";
  g.fillText("MAX", 24, 15);
  g.font = "bold 24px sans-serif";
  g.fillText(String(speed), 24, 38);
  return g.getImageData(0, 0, 48, 60);
}

function addControlImages(map: MapLibreMap) {
  for (const kind of CONTROL_KINDS) {
    if (map.hasImage(`control-${kind}`)) continue;
    const g = canvas();
    ICONS[kind](g);
    map.addImage(
      `control-${kind}`,
      trimIconPadding(g.getImageData(0, 0, ICON_PX, ICON_PX)),
      {
        pixelRatio: 2,
      },
    );
  }
}

/** Editable controls keep a visible target after their reference icon is hidden. */
export function sceneControlFeatures(
  scene: SceneComponent[],
): FeatureCollection<Point, { cid: string; kind: ControlKind }> {
  return {
    type: "FeatureCollection",
    features: scene.flatMap((component) => {
      if (!CONTROL_KINDS.includes(component.kind as ControlKind)) return [];
      return [
        {
          type: "Feature" as const,
          properties: {
            cid: component.id,
            kind: component.kind as ControlKind,
          },
          geometry: {
            type: "Point" as const,
            coordinates: toLngLat([component.x, component.y]),
          },
        },
      ];
    }),
  };
}

export function addEditableControlLayer(map: MapLibreMap) {
  addControlImages(map);
  map.addSource(SCENE_CONTROL_SOURCE, {
    type: "geojson",
    data: sceneControlFeatures([]),
  });
  map.addLayer({
    id: SCENE_CONTROL_LAYER,
    type: "symbol",
    source: SCENE_CONTROL_SOURCE,
    layout: {
      "icon-image": ["concat", "control-", ["get", "kind"]],
      "icon-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        14,
        0.55,
        17,
        0.8,
        19,
        1,
      ],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-pitch-alignment": "viewport",
    },
  });
}

export function drawEditableControls(
  map: MapLibreMap,
  scene: SceneComponent[],
) {
  map
    .getSource<GeoJSONSource>(SCENE_CONTROL_SOURCE)
    ?.setData(sceneControlFeatures(scene));
}

/** Add the icons, the source and the two reference layers to the map. */
export function addControlLayers(map: MapLibreMap, data: TrafficControls) {
  addControlImages(map);
  const speeds = new Set(
    data.features.flatMap((f) =>
      f.properties.kind === "speed_limit" ? [f.properties.speedKmh!] : [],
    ),
  );
  for (const speed of speeds) {
    if (!map.hasImage(`speed-${speed}`))
      map.addImage(`speed-${speed}`, speedPlate(speed), { pixelRatio: 2 });
  }
  map.addSource(CONTROLS_SOURCE, {
    type: "geojson",
    data,
    attribution: "© OpenStreetMap contributors",
  });
  map.addLayer({
    id: SPEED_LIMITS_LAYER,
    type: "symbol",
    source: CONTROLS_SOURCE,
    minzoom: 14,
    filter: ["==", ["get", "kind"], "speed_limit"],
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 320,
      "icon-image": ["concat", "speed-", ["to-string", ["get", "speedKmh"]]],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 14, 0.55, 18, 0.95],
      "icon-rotation-alignment": "viewport",
      "icon-pitch-alignment": "viewport",
    },
  });
  map.addLayer({
    id: CONTROL_ICONS_LAYER,
    type: "symbol",
    source: CONTROLS_SOURCE,
    minzoom: 14,
    filter: ["!=", ["get", "kind"], "speed_limit"],
    layout: {
      "icon-image": ["concat", "control-", ["get", "kind"]],
      "icon-size": [
        "interpolate",
        ["linear"],
        ["zoom"],
        14,
        0.45,
        17,
        0.75,
        19,
        1,
      ],
      "icon-padding": 0,
      // Signals first, then stops, when icons collide at lower zooms.
      "symbol-sort-key": [
        "match",
        ["get", "kind"],
        "traffic_light",
        0,
        "stop_sign",
        1,
        "yield_sign",
        1,
        2,
      ],
      "icon-pitch-alignment": "viewport",
    },
  });
}

/** Hide the real-world controls that have been converted or deleted. */
export function hideControls(map: MapLibreMap, refs: string[]) {
  const visible: FilterSpecification = [
    "!",
    ["in", ["get", "ref"], ["literal", refs]],
  ];
  if (map.getLayer(CONTROL_ICONS_LAYER))
    map.setFilter(CONTROL_ICONS_LAYER, [
      "all",
      ["!=", ["get", "kind"], "speed_limit"],
      visible,
    ]);
  if (map.getLayer(SPEED_LIMITS_LAYER))
    map.setFilter(SPEED_LIMITS_LAYER, [
      "all",
      ["==", ["get", "kind"], "speed_limit"],
      [...visible],
    ]);
}

/** Compass bearing of a line where it passes closest to `at`. */
export function bearingNear(
  line: number[][],
  at: { lng: number; lat: number },
): number | undefined {
  const cos = Math.cos((at.lat * Math.PI) / 180);
  let best: number | undefined;
  let bestDistance = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = [line[i - 1][0] * cos, line[i - 1][1]];
    const [bx, by] = [line[i][0] * cos, line[i][1]];
    const [px, py] = [at.lng * cos, at.lat];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(
      0,
      Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)),
    );
    const distance = Math.hypot(ax + t * dx - px, ay + t * dy - py);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    }
  }
  return best;
}
