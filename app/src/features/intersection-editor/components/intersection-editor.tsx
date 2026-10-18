"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ExpressionSpecification,
  FillExtrusionLayerSpecification,
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
  Marker,
} from "maplibre-gl";
import { Button } from "@/components/ui/button";
import {
  isResizable,
  outlines,
  ROADWAY_KINDS,
  TOOL_BY_KIND,
  TOOLS,
  type ComponentKind,
  type SceneComponent,
} from "../lib/components";
import {
  GRID_BEARING,
  ORIGIN,
  toLngLat,
  toLocal,
  type Vec2,
} from "../lib/geometry";
import { BUILDING_COLOUR, themeBasemap } from "../lib/basemap-theme";
import {
  componentFromBasemap,
  remainingBuildings,
  type HiddenBuilding,
  type PointerRay,
} from "../lib/osm";
import { renderScene, type SceneLayers } from "../lib/render";
import { PICK_LAYERS, resolveMapPick, type MapPick } from "../lib/picking";
import { checkScene, SOURCES, type Issue } from "../lib/rules";
import { componentFromDrop, describe } from "../lib/scene";
import {
  findSceneComponent,
  updateSceneComponent,
  removeSceneComponent,
} from "../lib/scene-edits";
import { useRoadNetwork } from "../hooks/use-road-network";
import {
  NETWORK_LAYER,
  NETWORK_SOURCE,
  type LoadedNetwork,
} from "../lib/network";
import type { ProjectState } from "../../../../shared/projects";
import {
  addArea,
  dominantBearing,
  fitEdges,
  holeMask,
  isEditable,
  unionPath,
  type EditArea,
} from "../lib/edit-areas";
import {
  addControlLayers,
  addEditableControlLayer,
  drawEditableControls,
  bearingNear,
  resolveControl,
  hideControls,
  loadControls,
  type ControlProperties,
} from "../lib/traffic-controls";
import { addNetworkLayer, showNetwork } from "../lib/network-layer";
import { componentsOverlap, gapBetween } from "../lib/spatial";
import { ComponentMenu } from "./component-menu";
import { ToolIcon } from "./tool-icon";
import { NetworkPanel } from "./network-panel";
import { PANEL_DEFAULT_WIDTH, SidePanel, type PanelTab } from "./side-panel";

const LAYER_IDS = ["solid", "marking", "ground"] as const;
const HIGHLIGHT = "#ffc94d";
const MEASURE_COLOUR = "#e8338b";
const GROW_MS = 380;
const SIDEWALK_RULE = "Sidewalks can't overlap roads or lanes.";
const READ_ONLY =
  "This part of the map is greyed out. Use Select area to make it editable.";
const AREA_COLOUR = "#2f80ed";
/** Kinds that run along streets; a selection edge may cut them freely. */
const UNSNAPPED_KINDS: readonly ComponentKind[] = [
  ...ROADWAY_KINDS,
  "crosswalk",
  "streetcar",
  "removed_osm",
];
/** OpenMapTiles road classes that define a street grid's direction. */
const STREET_CLASSES = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
];
/** Smallest selection, in screen pixels, that counts as an area. */
const MIN_SNIP = 12;
/** Farthest a selection corner may land from the camera's centre, in metres. */
const MAX_SNIP_REACH = 4000;

// Downtown Toronto: Bathurst St to the Don Valley, the waterfront to Bloor St.
const DOWNTOWN_BOUNDS: [[number, number], [number, number]] = [
  [-79.425, 43.633],
  [-79.35, 43.674],
];

// MapTiler is fetched through our own API route, which holds the key server-side.
function basemapStyleUrl() {
  return `${window.location.origin}/api/maptiler/maps/openstreetmap/style.json`;
}

const EMPTY: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

interface RoadLayer {
  id: string;
  filter: FilterSpecification | undefined;
}

interface BasemapLayers {
  roads: RoadLayer[];
  /** Vector source holding the basemap buildings, if the style has any. */
  buildingSource: string | null;
}

const BUILDING_PAINT: FillExtrusionLayerSpecification["paint"] = {
  "fill-extrusion-color": BUILDING_COLOUR,
  "fill-extrusion-vertical-gradient": true,
  "fill-extrusion-height": ["coalesce", ["get", "render_height"], 10],
  "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
  "fill-extrusion-opacity": 1,
};

/**
 * Add the editable scene on top of the basemap: road-level parts above the
 * basemap's roads but under its labels, plus 3D extrusions for OSM buildings.
 * Returns the basemap layers that converted features are hidden from.
 */
function addSceneLayers(map: MapLibreMap): BasemapLayers {
  themeBasemap(map);
  const layers = map.getStyle().layers;
  const firstLabel = layers.find((layer) => layer.type === "symbol")?.id;
  const buildings = layers.find(
    (layer) => "source-layer" in layer && layer["source-layer"] === "building",
  );
  if (buildings && "source" in buildings) {
    for (const layer of layers) {
      if ("source-layer" in layer && layer["source-layer"] === "building") {
        map.setLayoutProperty(layer.id, "visibility", "none");
      }
    }
    map.addLayer(
      {
        id: "osm-buildings",
        type: "fill-extrusion",
        source: buildings.source,
        "source-layer": "building",
        minzoom: 14,
        paint: BUILDING_PAINT,
      },
      firstLabel,
    );
    // Buildings that share a basemap feature with a converted one.
    map.addSource("osm-remainder", { type: "geojson", data: EMPTY });
    map.addLayer(
      {
        id: "osm-remainder",
        type: "fill-extrusion",
        source: "osm-remainder",
        minzoom: 14,
        paint: BUILDING_PAINT,
      },
      firstLabel,
    );
  }
  const roadLayers = layers
    .filter(
      (layer) =>
        layer.type === "line" &&
        "source-layer" in layer &&
        layer["source-layer"] === "transportation",
    )
    .map((layer) => ({
      id: layer.id,
      filter: "filter" in layer ? layer.filter : undefined,
    }));

  for (const id of LAYER_IDS)
    map.addSource(id, { type: "geojson", data: EMPTY });
  map.addSource("measure", { type: "geojson", data: EMPTY });
  map.addLayer(
    {
      id: "ground",
      type: "fill",
      source: "ground",
      paint: { "fill-color": ["get", "colour"] },
    },
    map.getLayer("osm-buildings") ? "osm-buildings" : firstLabel,
  );
  map.addLayer(
    {
      id: "marking",
      type: "fill",
      source: "marking",
      paint: { "fill-color": ["get", "colour"] },
    },
    map.getLayer("osm-buildings") ? "osm-buildings" : firstLabel,
  );
  map.addLayer(
    {
      id: "solid",
      type: "fill-extrusion",
      source: "solid",
      paint: {
        "fill-extrusion-color": ["get", "colour"],
        "fill-extrusion-base": ["get", "base"],
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-vertical-gradient": true,
      },
    },
    firstLabel,
  );
  // Translucent copies of the scene layers for the placement ghost.
  for (const id of ["ghost", "ghost-solid"] as const)
    map.addSource(id, { type: "geojson", data: EMPTY });
  map.addLayer(
    {
      id: "ghost-fill",
      type: "fill",
      source: "ghost",
      paint: { "fill-color": ["get", "colour"], "fill-opacity": 0.45 },
    },
    "solid",
  );
  map.addLayer(
    {
      id: "ghost-solid",
      type: "fill-extrusion",
      source: "ghost-solid",
      paint: {
        "fill-extrusion-color": ["get", "colour"],
        "fill-extrusion-base": ["get", "base"],
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-opacity": 0.45,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    firstLabel,
  );
  addEditableControlLayer(map);
  // Measurement lines sit above everything so they are always readable.
  map.addLayer({
    id: "measure",
    type: "line",
    source: "measure",
    layout: { "line-cap": "round" },
    paint: {
      "line-color": MEASURE_COLOUR,
      "line-width": 3,
      "line-dasharray": [2, 1.5],
    },
  });
  map.setLight({
    anchor: "viewport",
    color: "#ffffff",
    intensity: 0.32,
    position: [1.4, 200, 35],
  });
  return {
    roads: roadLayers,
    buildingSource:
      buildings && "source" in buildings ? buildings.source : null,
  };
}

/** Basemap buildings the scene has converted or deleted. */
function hiddenBuildings(scene: SceneComponent[]): HiddenBuilding[] {
  return scene.flatMap((c) => {
    if (c.osmId === undefined || !c.footprint) return [];
    const [ox, oy] = c.osmAt ?? [c.x, c.y];
    return [
      {
        osmId: c.osmId,
        outline: c.footprint.map(([x, y]): Vec2 => [ox + x, oy + y]),
      },
    ];
  });
}

function easeOutBack(t: number) {
  const c = 1.6;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

function colourFor(selected: string | null): ExpressionSpecification {
  return selected
    ? ["case", ["==", ["get", "cid"], selected], HIGHLIGHT, ["get", "colour"]]
    : ["get", "colour"];
}

const LEGACY_COMPARISONS = [
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "in",
  "!in",
  "has",
  "!has",
];

/**
 * Whether a filter uses MapLibre's legacy syntax (["==", "class", "x"]), which
 * cannot be combined with expression syntax in one filter.
 */
function isLegacyFilter(filter: unknown): boolean {
  if (!Array.isArray(filter)) return false;
  const [op, ...args] = filter;
  if (op === "all" || op === "any" || op === "none")
    return args.some(isLegacyFilter);
  return LEGACY_COMPARISONS.includes(op) && typeof args[0] === "string";
}

/** Whether `next` puts a changed sidewalk on a roadway, or a changed roadway under a sidewalk. */
function breaksSidewalkRule(next: SceneComponent[], changed: Set<string>) {
  const sidewalks = next.filter((c) => c.kind === "sidewalk");
  const roadway = next.filter(
    (c) => ROADWAY_KINDS.includes(c.kind) && !c.osmId,
  );
  return sidewalks.some((s) =>
    roadway.some(
      (r) =>
        (changed.has(s.id) || changed.has(r.id)) &&
        componentsOverlap(s, r, 0.05),
    ),
  );
}

/** The pointer's ray into the scene, from the camera through `ground`. */
function pointerRay(
  map: MapLibreMap,
  ground: { lng: number; lat: number },
): PointerRay {
  const center = map.getCenter();
  const fov = (map.getVerticalFieldOfView() * Math.PI) / 180;
  const pitch = (map.getPitch() * Math.PI) / 180;
  const bearing = (map.getBearing() * Math.PI) / 180;
  const lat = (center.lat * Math.PI) / 180;
  const pixels = (0.5 / Math.tan(fov / 2)) * map.getContainer().clientHeight;
  const worldSize = 512 * 2 ** map.getZoom();
  const back = (pixels * Math.sin(pitch)) / worldSize;
  const centerY = (1 - Math.log(Math.tan(Math.PI / 4 + lat / 2)) / Math.PI) / 2;
  const cameraY = centerY + back * Math.cos(bearing);
  return {
    ground: toLocal(ground.lng, ground.lat),
    camera: toLocal(
      center.lng - back * Math.sin(bearing) * 360,
      (Math.atan(Math.sinh(Math.PI * (1 - 2 * cameraY))) * 180) / Math.PI,
    ),
    altitude: Math.max(
      1,
      (pixels * Math.cos(pitch) * 40_075_016.686 * Math.cos(lat)) / worldSize,
    ),
  };
}

/** One undo step: the scene and the editable areas together. */
interface Snapshot {
  scene: SceneComponent[];
  areas: EditArea[];
}

interface MenuState {
  id: string;
  sourceComponent?: SceneComponent;
  x: number;
  y: number;
  /** Map size when opened, so the menu can stay inside it. */
  bounds: { width: number; height: number };
}

function menuAt(map: MapLibreMap, id: string, x: number, y: number): MenuState {
  const container = map.getContainer();
  return {
    id,
    x,
    y,
    bounds: { width: container.clientWidth, height: container.clientHeight },
  };
}

interface Measurement {
  id: string;
  a: string;
  b: string;
}

type Handle = "end+" | "end-" | "side+" | "side-";
const HANDLES: Handle[] = ["end+", "end-", "side+", "side-"];

/** Where each resize handle sits, in world metres, for a component. */
function handlePosition(c: SceneComponent, handle: Handle): Vec2 {
  const r = (c.rotation * Math.PI) / 180;
  const along = handle.startsWith("end");
  const sign = handle.endsWith("+") ? 1 : -1;
  const half = ((along ? c.length : c.width) ?? 0) / 2;
  const [lx, ly] = along ? [sign * half, 0] : [0, sign * half];
  return [
    c.x + lx * Math.cos(r) - ly * Math.sin(r),
    c.y + lx * Math.sin(r) + ly * Math.cos(r),
  ];
}

/** Resize `c` by dragging one handle to `point`, keeping the opposite edge fixed. */
function resized(
  c: SceneComponent,
  handle: Handle,
  [px, py]: Vec2,
): SceneComponent {
  const r = (c.rotation * Math.PI) / 180;
  const dx = px - c.x;
  const dy = py - c.y;
  const local = handle.startsWith("end")
    ? dx * Math.cos(r) + dy * Math.sin(r)
    : -dx * Math.sin(r) + dy * Math.cos(r);
  const along = handle.startsWith("end");
  const sign = handle.endsWith("+") ? 1 : -1;
  const size = (along ? c.length : c.width) ?? 1;
  const min = along ? 1 : 0.3;
  const round = (v: number) => Math.round(v * 10) / 10;
  const next = Math.max(min, round(sign * local + size / 2));
  const shift = (sign * (next - size)) / 2;
  const [sx, sy] = along
    ? [shift * Math.cos(r), shift * Math.sin(r)]
    : [-shift * Math.sin(r), shift * Math.cos(r)];
  return {
    ...c,
    x: round(c.x + sx),
    y: round(c.y + sy),
    ...(along ? { length: next } : { width: next }),
  };
}

export function IntersectionEditor({
  initialState,
  networkReference,
  onStateChange,
  historyToolbar,
  componentsTarget,
  leftPanelInset = 12,
}: {
  initialState: ProjectState;
  networkReference: { name: string; version: string } | null;
  onStateChange: (state: ProjectState) => void;
  historyToolbar?: HTMLElement | null;
  componentsTarget?: HTMLElement | null;
  leftPanelInset?: number;
}) {
  const [scene, setScene] = useState<SceneComponent[]>(initialState.scene);
  const [areas, setAreas] = useState<EditArea[]>(initialState.areas);
  const [camera, setCamera] = useState(initialState.camera);
  const initialCamera = useRef(initialState.camera);

  const [selectingArea, setSelectingArea] = useState(false);
  const [controlsReady, setControlsReady] = useState(false);
  const [panelOpen, setPanelOpen] = useState(
    () => window.matchMedia("(min-width: 1024px)").matches,
  );
  const [panelTab, setPanelTab] = useState<PanelTab>("tools");
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  const [snip, setSnip] = useState<{
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  } | null>(null);
  const network = useRoadNetwork(networkReference);
  const [roadSelection, setRoadSelection] = useState<{
    networkId: string;
    edgeId: string;
  } | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>(
    initialState.measurements,
  );
  useEffect(() => {
    onStateChange({ ...initialState, scene, areas, measurements, camera });
  }, [initialState, scene, areas, measurements, camera, onStateChange]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ComponentKind | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [basemapFailed, setBasemapFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [checking, setChecking] = useState(false);
  const [issuePopup, setIssuePopup] = useState<{
    issue: Issue;
    x: number;
    y: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const networkRef = useRef<LoadedNetwork | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const sceneRef = useRef(scene);
  const areasRef = useRef(areas);
  const greyRef = useRef<HTMLDivElement>(null);
  const outlineRef = useRef<SVGPathElement>(null);
  const outlineMaskRef = useRef<SVGPathElement>(null);
  const historyRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const [history, setHistory] = useState({ undo: 0, redo: 0 });
  const growingRef = useRef(new Map<string, number>());
  const markersRef = useRef(new Map<string, Marker>());
  const handlesRef = useRef(new Map<Handle, Marker>());
  const issueMarkersRef = useRef(new Map<string, Marker>());
  const measureLabelsRef = useRef(new Map<string, Marker>());
  const measurementsRef = useRef(measurements);
  const basemapRef = useRef<BasemapLayers>({ roads: [], buildingSource: null });
  const frameRef = useRef<number | null>(null);
  const selectedRef = useRef<string | null>(null);
  const sourceSelectionRef = useRef<SceneComponent | null>(null);
  const activeToolRef = useRef<ComponentKind | null>(null);
  const ghostRef = useRef<SceneComponent | null>(null);
  const measuringRef = useRef(false);
  const measureStartRef = useRef<string | null>(null);

  const syncHistory = useCallback(
    () =>
      setHistory({
        undo: historyRef.current.length,
        redo: futureRef.current.length,
      }),
    [],
  );

  /** Record `before` as an undo step; a new edit discards anything to redo. */
  const remember = useCallback(
    (before: SceneComponent[], areasBefore: EditArea[] = areasRef.current) => {
      historyRef.current = [
        ...historyRef.current.slice(-49),
        { scene: before, areas: areasBefore },
      ];
      futureRef.current = [];
      syncHistory();
    },
    [syncHistory],
  );

  const commit = useCallback(
    (next: SceneComponent[]) => {
      remember(sceneRef.current);
      sceneRef.current = next;
      setScene(next);
    },
    [remember],
  );

  const commitAreas = useCallback(
    (next: EditArea[]) => {
      remember(sceneRef.current, areasRef.current);
      areasRef.current = next;
      setAreas(next);
    },
    [remember],
  );

  /** Step through history: undo moves back, redo moves forward again. */
  const travel = useCallback(
    (direction: "undo" | "redo") => {
      const [from, to] =
        direction === "undo"
          ? [historyRef, futureRef]
          : [futureRef, historyRef];
      const target = from.current.pop();
      if (!target) return;
      to.current.push({ scene: sceneRef.current, areas: areasRef.current });
      sceneRef.current = target.scene;
      areasRef.current = target.areas;
      setScene(target.scene);
      setAreas(target.areas);
      setMenu(null);
      setIssuePopup(null);
      syncHistory();
    },
    [syncHistory],
  );
  const undo = useCallback(() => travel("undo"), [travel]);
  const redo = useCallback(() => travel("redo"), [travel]);

  useEffect(() => {
    const container = containerRef.current;
    const map = mapRef.current;
    if (!mapReady || !container || !map) return;
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [mapReady]);

  const select = useCallback((id: string | null) => {
    setRoadSelection(null);
    selectedRef.current = id;
    sourceSelectionRef.current = null;
    setSelected(id);
  }, []);

  /** Move measurement lines and labels to follow the current scene. */
  const drawMeasurements = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const byId = new Map(sceneRef.current.map((c) => [c.id, c]));
    const features: GeoJSON.Feature[] = [];
    for (const m of measurementsRef.current) {
      const a = byId.get(m.a);
      const b = byId.get(m.b);
      const gap = a && b ? gapBetween(a, b) : null;
      const label = measureLabelsRef.current.get(m.id);
      if (!gap) {
        label?.getElement().classList.add("hidden");
        continue;
      }
      features.push({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [toLngLat(gap.from), toLngLat(gap.to)],
        },
      });
      if (label) {
        label.getElement().classList.remove("hidden");
        label.setLngLat(
          toLngLat([
            (gap.from[0] + gap.to[0]) / 2,
            (gap.from[1] + gap.to[1]) / 2,
          ]),
        );
        const text = label.getElement().querySelector("[data-distance]");
        if (text) text.textContent = `${gap.distance.toFixed(1)} m`;
      }
    }
    map
      .getSource<GeoJSONSource>("measure")
      ?.setData({ type: "FeatureCollection", features });
  }, []);

  /** Push the scene to MapLibre; keeps animating while components grow in. */
  const draw = useCallback(
    function frame() {
      frameRef.current = null;
      const map = mapRef.current;
      if (!map) return;
      const now = performance.now();
      const scales = new Map<string, number>();
      for (const [id, start] of growingRef.current) {
        const t = (now - start) / GROW_MS;
        if (t >= 1) growingRef.current.delete(id);
        else scales.set(id, 0.15 + 0.85 * easeOutBack(Math.max(t, 0)));
      }
      const layers = renderScene(sceneRef.current, scales);
      for (const key of Object.keys(layers) as (keyof SceneLayers)[]) {
        map.getSource<GeoJSONSource>(key)?.setData(layers[key]);
      }
      drawEditableControls(map, sceneRef.current);
      drawMeasurements();
      if (growingRef.current.size)
        frameRef.current = requestAnimationFrame(frame);
    },
    [drawMeasurements],
  );

  /** Show the armed tool's component under the pointer, or clear it. */
  const drawGhost = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const ghost = ghostRef.current;
    const layers = ghost ? renderScene([ghost], new Map()) : null;
    const flat = layers
      ? {
          type: "FeatureCollection" as const,
          features: [...layers.ground.features, ...layers.marking.features],
        }
      : EMPTY;
    map.getSource<GeoJSONSource>("ghost")?.setData(flat);
    map.getSource<GeoJSONSource>("ghost-solid")?.setData(
      layers ? layers.solid : EMPTY,
    );
  }, []);

  /**
   * Apply a live (uncommitted) change during a drag. Returns why the change
   * was refused, or null when it was applied.
   */
  const preview = useCallback(
    (component: SceneComponent): string | null => {
      if (!isEditable(areasRef.current, [component.x, component.y]))
        return READ_ONLY;
      const isNewOverride = !sceneRef.current.some(
        (c) => c.id === component.id,
      );
      const next = updateSceneComponent(sceneRef.current, component, component);
      if (breaksSidewalkRule(next, new Set([component.id])))
        return SIDEWALK_RULE;
      sceneRef.current = next;
      if (isNewOverride && mapRef.current)
        hideControls(
          mapRef.current,
          next.flatMap((c) =>
            typeof c.osmId === "string" &&
            /^(node|way|relation)\//.test(c.osmId)
              ? [c.osmId]
              : [],
          ),
        );
      markersRef.current
        .get(component.id)
        ?.setLngLat(toLngLat([component.x, component.y]));
      for (const [handle, marker] of handlesRef.current) {
        marker.setLngLat(toLngLat(handlePosition(component, handle)));
      }
      if (frameRef.current === null) draw();
      return null;
    },
    [draw],
  );

  const toggleMeasuring = useCallback(() => {
    const next = !measuringRef.current;
    measuringRef.current = next;
    measureStartRef.current = null;
    setMeasuring(next);
    select(null);
    setNotice(next ? "Measure: click one component, then another." : null);
  }, [select]);

  /** Arm a toolbox tool for click-to-place, or disarm with null. */
  const armTool = useCallback(
    (kind: ComponentKind | null) => {
      activeToolRef.current = kind;
      setActiveTool(kind);
      setMenu(null);
      setIssuePopup(null);
      ghostRef.current = null;
      drawGhost();
      if (!kind) return;
      select(null);
      if (measuringRef.current) toggleMeasuring();
      setSelectingArea(false);
      setSnip(null);
      setNotice(
        `${TOOL_BY_KIND[kind].label}: click the map to place it. Esc to cancel.`,
      );
    },
    [drawGhost, select, toggleMeasuring],
  );

  /** Place the armed tool's component at the clicked map position. */
  const placeComponent = useCallback(
    (kind: ComponentKind, lngLat: { lng: number; lat: number }) => {
      const [x, y] = toLocal(lngLat.lng, lngLat.lat);
      if (!isEditable(areasRef.current, [x, y])) {
        setNotice(READ_ONLY);
        return;
      }
      const created = componentFromDrop(kind, x, y);
      const next = [...sceneRef.current, created];
      if (breaksSidewalkRule(next, new Set([created.id]))) {
        setNotice(SIDEWALK_RULE);
        return;
      }
      growingRef.current.set(created.id, performance.now());
      commit(next);
      select(created.id);
      setNotice(
        `Added ${describe(created).toLowerCase()}. Click again to place another, or press Esc to finish.`,
      );
    },
    [commit, select],
  );

  /**
   * Cut the editable areas out of the grey overlay and outline them, following
   * the camera. Overlapping areas merge: only the outer edge is outlined.
   */
  const drawGrey = useCallback(() => {
    const map = mapRef.current;
    const grey = greyRef.current;
    if (!map || !grey) return;
    const holes = areasRef.current.flatMap((area) =>
      area.rings.map((ring) =>
        ring.map((p) => {
          const { x, y } = map.project(toLngLat(p));
          return [x, y] as const;
        }),
      ),
    );
    const mask = holes.length
      ? holeMask(grey.clientWidth, grey.clientHeight, holes)
      : "none";
    grey.style.maskImage = mask;
    grey.style.webkitMaskImage = mask;
    const path = unionPath(holes);
    outlineRef.current?.setAttribute("d", path);
    outlineMaskRef.current?.setAttribute("d", path);
  }, []);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let map: MapLibreMap | undefined;
    let rightDown: { x: number; y: number } | null = null;
    // Moving the selected component: where the pointer grabbed it, in local metres.
    let drag: {
      id: string;
      grab: Vec2;
      origin: Vec2;
      before: SceneComponent[];
      moved: boolean;
      blocked: boolean;
    } | null = null;
    let justDragged = false;
    const markers = markersRef.current;
    let removeWindowListener = () => {};
    import("maplibre-gl").then((maplibregl) => {
      if (cancelled || !containerRef.current) return;
      libRef.current = maplibregl;
      // MapLibre resolves its worker relative to its own module at runtime, which
      // bundlers do not follow; hand it a URL the bundler emits as an asset.
      maplibregl.setWorkerUrl(
        new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url)
          .href,
      );
      map = new maplibregl.Map({
        container: containerRef.current,
        style: basemapStyleUrl(),
        center: [initialCamera.current.lng, initialCamera.current.lat],
        zoom: initialCamera.current.zoom,
        pitch: initialCamera.current.pitch,
        bearing: initialCamera.current.bearing,
        maxPitch: 80,
        minZoom: 13,
        maxZoom: 20,
        // A saved camera may lie in the imported network's wider buffer.
        // Keep it intact until the exact network bounds have loaded.
        maxBounds: [
          [
            Math.min(DOWNTOWN_BOUNDS[0][0], initialCamera.current.lng - 0.001),
            Math.min(DOWNTOWN_BOUNDS[0][1], initialCamera.current.lat - 0.001),
          ],
          [
            Math.max(DOWNTOWN_BOUNDS[1][0], initialCamera.current.lng + 0.001),
            Math.max(DOWNTOWN_BOUNDS[1][1], initialCamera.current.lat + 0.001),
          ],
        ],
        canvasContextAttributes: { antialias: true },
      });
      mapRef.current = map;
      map.on("moveend", () => {
        if (!map) return;
        const center = map.getCenter();
        setCamera({
          lng: center.lng,
          lat: center.lat,
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing(),
        });
      });
      map.on("error", (e) => {
        // Only a missing style is fatal; a failed icon or tile is not.
        const url = (e.error as { url?: string } | undefined)?.url ?? "";
        if (url.includes("style.json")) setBasemapFailed(true);
      });
      map.on("load", () => {
        basemapRef.current = addSceneLayers(map!);
        setMapReady(true);
      });
      map.on("render", drawGrey);
      const pickAt = (point: { x: number; y: number }) => {
        const layers = PICK_LAYERS.filter((layer) => map!.getLayer(layer));
        if (!layers.length) return null;
        return resolveMapPick(
          map!.queryRenderedFeatures([point.x, point.y], { layers }),
          sceneRef.current,
          pointerRay(map!, map!.unproject([point.x, point.y])),
        );
      };

      const inspect = (
        pick: MapPick | null,
        point: { x: number; y: number },
      ) => {
        setMenu(null);
        setIssuePopup(null);
        if (!pick) {
          select(null);
          return;
        }
        if (pick.kind === "road") {
          select(null);
          if (networkRef.current)
            setRoadSelection({
              networkId: networkRef.current.id,
              edgeId: pick.edgeId,
            });
          return;
        }
        let component: SceneComponent | undefined;
        if (pick.kind === "component")
          component = sceneRef.current.find((c) => c.id === pick.id);
        else if (pick.kind === "control") {
          const control = pick.feature;
          const props = control.properties as unknown as ControlProperties;
          const ground = map!.unproject([point.x, point.y]);
          const at =
            control.geometry.type === "Point"
              ? {
                  lng: control.geometry.coordinates[0],
                  lat: control.geometry.coordinates[1],
                }
              : ground;
          const along =
            control.geometry.type === "LineString"
              ? bearingNear(control.geometry.coordinates, ground)
              : undefined;
          component = resolveControl(sceneRef.current, props, at, along);
        } else if (pick.kind === "building") {
          const original = componentFromBasemap(
            pick.feature,
            pointerRay(map!, map!.unproject([point.x, point.y])),
          );
          if (original)
            component =
              findSceneComponent(sceneRef.current, original) ?? original;
        }
        if (!component || component.kind === "removed_osm") {
          select(null);
          return;
        }
        if (!isEditable(areasRef.current, [component.x, component.y])) {
          select(null);
          setNotice(READ_ONLY);
          return;
        }
        select(component.id);
        sourceSelectionRef.current = component;
        setMenu({
          ...menuAt(map!, component.id, point.x, point.y),
          sourceComponent: component,
        });
        setNotice("Edit its properties, or drag it to move.");
      };

      const endDrag = () => {
        if (!drag) return;
        if (drag.moved) {
          remember(drag.before);
          setScene(sceneRef.current);
          // Swallow the click that follows this mouseup, but no later one
          // (there is none when the drag ends outside the map).
          justDragged = true;
        }
        drag = null;
        map!.dragPan.enable();
        map!.getCanvas().style.cursor = "";
      };

      map.on("mousedown", (e) => {
        // An intentional new press clears suppression; a drag-generated click does not.
        justDragged = false;
        if (e.originalEvent.button === 2) {
          rightDown = { x: e.point.x, y: e.point.y };
          return;
        }
        if (e.originalEvent.button !== 0 || measuringRef.current) return;
        const pick = pickAt(e.point);
        const sourceSelection = sourceSelectionRef.current;
        const component =
          pick?.kind === "component"
            ? sceneRef.current.find((c) => c.id === pick.id)
            : sourceSelection &&
                ((pick?.kind === "control" &&
                  pick.feature.properties?.ref === sourceSelection.osmId) ||
                  (pick?.kind === "building" &&
                    sourceSelection.kind === "building" &&
                    componentFromBasemap(
                      pick.feature,
                      pointerRay(map!, e.lngLat),
                    )?.osmAt?.every(
                      (v, i) =>
                        Math.abs(
                          v -
                            (sourceSelection.osmAt ?? [
                              sourceSelection.x,
                              sourceSelection.y,
                            ])[i],
                        ) < 0.15,
                    )))
              ? sourceSelection
              : undefined;
        const id = component?.id;
        // Only an already-selected component drags; elsewhere the map pans.
        if (!component || id !== selectedRef.current) return;
        e.preventDefault();
        map!.dragPan.disable();
        drag = {
          id: component.id,
          grab: toLocal(e.lngLat.lng, e.lngLat.lat),
          origin: [component.x, component.y],
          before: sceneRef.current,
          moved: false,
          blocked: false,
        };
        map!.getCanvas().style.cursor = "grabbing";
      });

      map.on("mousemove", (e) => {
        if (!drag) {
          if (activeToolRef.current) {
            const [x, y] = toLocal(e.lngLat.lng, e.lngLat.lat);
            ghostRef.current = componentFromDrop(activeToolRef.current, x, y);
            drawGhost();
            map!.getCanvas().style.cursor = "crosshair";
            return;
          }
          const pick = pickAt(e.point);
          const id =
            pick?.kind === "component"
              ? pick.id
              : pick?.kind === "control" &&
                  pick.feature.properties?.ref ===
                    sourceSelectionRef.current?.osmId
                ? sourceSelectionRef.current?.id
                : null;
          map!.getCanvas().style.cursor = measuringRef.current
            ? "crosshair"
            : id && id === selectedRef.current
              ? "move"
              : pick
                ? "pointer"
                : "";
          return;
        }
        const [x, y] = toLocal(e.lngLat.lng, e.lngLat.lat);
        const round = (v: number) => Math.round(v * 10) / 10;
        const id = drag.id;
        const component =
          sceneRef.current.find((c) => c.id === id) ??
          (sourceSelectionRef.current?.id === id
            ? sourceSelectionRef.current
            : undefined);
        if (!component) return;
        const grabbedAt = map!.project(toLngLat(drag.grab));
        if (
          !drag.moved &&
          Math.hypot(e.point.x - grabbedAt.x, e.point.y - grabbedAt.y) < 3
        )
          return;
        const moved = {
          ...component,
          x: round(drag.origin[0] + x - drag.grab[0]),
          y: round(drag.origin[1] + y - drag.grab[1]),
        };
        const problem = preview(moved);
        if (!problem) {
          drag.moved = true;
        } else if (!drag.blocked) {
          drag.blocked = true;
          setNotice(problem);
        }
      });

      map.on("mouseup", endDrag);
      window.addEventListener("mouseup", endDrag);
      removeWindowListener = () =>
        window.removeEventListener("mouseup", endDrag);
      map.on("contextmenu", (e) => {
        // Right-drag rotates the camera; only a stationary right-click opens the menu.
        if (
          rightDown &&
          Math.hypot(e.point.x - rightDown.x, e.point.y - rightDown.y) > 5
        ) {
          return;
        }
        inspect(pickAt(e.point), e.point);
      });
      map.on("click", (e) => {
        setMenu(null);
        setIssuePopup(null);
        if (justDragged) {
          justDragged = false;
          return;
        }
        const pick = pickAt(e.point);
        const id = pick?.kind === "component" ? pick.id : null;

        if (measuringRef.current) {
          if (!id) {
            setNotice("Click a component to measure from it.");
            return;
          }
          const start = measureStartRef.current;
          if (!start || start === id) {
            measureStartRef.current = id;
            select(id);
            setNotice("Now click the second component.");
            return;
          }
          const a = sceneRef.current.find((c) => c.id === start);
          const b = sceneRef.current.find((c) => c.id === id);
          measureStartRef.current = null;
          select(null);
          if (!a || !b) return;
          setMeasurements((current) => [
            ...current,
            { id: crypto.randomUUID(), a: a.id, b: b.id },
          ]);
          const gap = gapBetween(a, b);
          setNotice(
            `${describe(a)} to ${describe(b).toLowerCase()}: ${gap?.distance.toFixed(1) ?? "?"} m`,
          );
          return;
        }

        if (activeToolRef.current) {
          placeComponent(activeToolRef.current, e.lngLat);
          return;
        }

        inspect(pick, e.point);
      });
      map.on("dragstart", () => setMenu(null));
      map.on("zoomstart", () => setMenu(null));
    });
    return () => {
      cancelled = true;
      removeWindowListener();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      markers.forEach((marker) => marker.remove());
      markers.clear();
      map?.remove();
      mapRef.current = null;
    };
  }, [armTool, commit, draw, drawGhost, drawGrey, placeComponent, preview, remember, select]);

  // Real-world traffic controls, as a reference layer under the scene.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const controller = new AbortController();
    loadControls(controller.signal).then(
      (data) => {
        if (controller.signal.aborted || mapRef.current !== map) return;
        addControlLayers(map, data);
        setControlsReady(true);
      },
      () => {
        if (!controller.signal.aborted)
          setNotice("Toronto signals and signs could not be loaded.");
      },
    );
    return () => controller.abort();
  }, [mapReady]);

  // Hide real-world controls that were made editable or deleted.
  useEffect(() => {
    const map = mapRef.current;
    if (!controlsReady || !map) return;
    hideControls(
      map,
      scene.flatMap((c) =>
        typeof c.osmId === "string" && /^(node|way|relation)\//.test(c.osmId)
          ? [c.osmId]
          : [],
      ),
    );
  }, [scene, controlsReady]);

  // Outline and unmask the editable areas whenever they change.
  useEffect(() => {
    areasRef.current = areas;
    drawGrey();
  }, [areas, mapReady, drawGrey]);

  // Redraw whenever the scene changes.
  useEffect(() => {
    if (mapReady && frameRef.current === null) draw();
  }, [scene, mapReady, draw]);

  useEffect(() => {
    const map = mapRef.current;
    const data = network.data;
    if (!mapReady || !map || !data) return;
    networkRef.current = data;
    addNetworkLayer(map, data);
    // The import's buffer extends beyond the original editor camera limits.
    map.setMaxBounds([
      [
        Math.min(DOWNTOWN_BOUNDS[0][0], data.bounds[0][0] - 0.01),
        Math.min(DOWNTOWN_BOUNDS[0][1], data.bounds[0][1] - 0.01),
      ],
      [
        Math.max(DOWNTOWN_BOUNDS[1][0], data.bounds[1][0] + 0.01),
        Math.max(DOWNTOWN_BOUNDS[1][1], data.bounds[1][1] + 0.01),
      ],
    ]);
    return () => {
      networkRef.current = null;
      if (mapRef.current !== map) return;
      if (map.getLayer(NETWORK_LAYER)) map.removeLayer(NETWORK_LAYER);
      if (map.getSource(NETWORK_SOURCE)) map.removeSource(NETWORK_SOURCE);
    };
  }, [network.data, mapReady]);

  const selectedRoad = useMemo(() => {
    if (!network.data || roadSelection?.networkId !== network.data.id)
      return null;
    return (
      network.data.roads.features.find(
        (road) => road.properties.edge_id === roadSelection.edgeId,
      ) ?? null
    );
  }, [network.data, roadSelection]);

  useEffect(() => {
    const map = mapRef.current;
    const id = selectedRoad?.properties.edge_id;
    if (!mapReady || !map?.getSource(NETWORK_SOURCE) || !id) return;
    map.setFeatureState({ source: NETWORK_SOURCE, id }, { selected: true });
    return () => {
      if (mapRef.current === map && map.getSource(NETWORK_SOURCE)) {
        map.setFeatureState(
          { source: NETWORK_SOURCE, id },
          { selected: false },
        );
      }
    };
  }, [mapReady, selectedRoad]);

  // Hide basemap buildings and roads that were converted or deleted.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const buildings = hiddenBuildings(scene);
    const buildingIds = [...new Set(buildings.map((b) => b.osmId))];
    const ids = scene.flatMap((c) =>
      c.osmId === undefined || c.footprint ? [] : [c.osmId],
    );
    const notHidden: FilterSpecification = [
      "!",
      ["in", ["id"], ["literal", ids]],
    ];
    const { roads, buildingSource } = basemapRef.current;
    // One basemap feature can hold hundreds of buildings, so hide the whole
    // feature and redraw the ones the user has not touched.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const redrawRemainder = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const features =
          buildingSource && buildingIds.length
            ? map.querySourceFeatures(buildingSource, {
                sourceLayer: "building",
                filter: ["in", ["id"], ["literal", buildingIds]],
              })
            : [];
        map.getSource<GeoJSONSource>("osm-remainder")?.setData({
          type: "FeatureCollection",
          features: remainingBuildings(features, buildings),
        });
      }, 120);
    };
    if (map.getLayer("osm-buildings")) {
      map.setFilter("osm-buildings", [
        "!",
        ["in", ["id"], ["literal", buildingIds]],
      ]);
      redrawRemainder();
    }
    // Tiles stream in as the camera moves; pick up their buildings too.
    const onData = (e: { sourceId?: string; tile?: unknown }) => {
      if (e.sourceId === buildingSource && e.tile) redrawRemainder();
    };
    if (buildingIds.length) map.on("sourcedata", onData);
    for (const layer of roads) {
      const combined = (
        !layer.filter
          ? notHidden
          : isLegacyFilter(layer.filter)
            ? ["all", layer.filter, ["!in", "$id", ...ids]]
            : ["all", layer.filter, notHidden]
      ) as FilterSpecification;
      map.setFilter(layer.id, combined);
    }
    return () => {
      clearTimeout(timer);
      map.off("sourcedata", onData);
    };
  }, [scene, mapReady]);

  // Measurement lines and their labels.
  useEffect(() => {
    measurementsRef.current = measurements;
    const map = mapRef.current;
    const lib = libRef.current;
    if (!mapReady || !map || !lib) return;
    const labels = measureLabelsRef.current;
    const live = new Set(measurements.map((m) => m.id));
    for (const [id, marker] of labels) {
      if (!live.has(id)) {
        marker.remove();
        labels.delete(id);
      }
    }
    for (const m of measurements) {
      if (labels.has(m.id)) continue;
      const element = document.createElement("div");
      element.className =
        "flex items-center gap-1 rounded-full bg-[#e8338b] py-0.5 pr-0.5 pl-2 text-[11px] font-semibold text-white shadow tabular-nums";
      const text = document.createElement("span");
      text.dataset.distance = "";
      const close = document.createElement("button");
      close.type = "button";
      close.textContent = "×";
      close.title = "Remove measurement";
      close.className =
        "flex size-4 items-center justify-center rounded-full bg-white/25 leading-none hover:bg-white/40";
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        setMeasurements((current) => current.filter((x) => x.id !== m.id));
      });
      element.append(text, close);
      labels.set(
        m.id,
        new lib.Marker({ element })
          .setLngLat([ORIGIN.lng, ORIGIN.lat])
          .addTo(map),
      );
    }
    drawMeasurements();
  }, [measurements, mapReady, drawMeasurements]);

  // Speed-limit plates carry their number as an HTML label above the sign.
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!mapReady || !map || !lib) return;
    const markers = markersRef.current;
    const signs = scene.filter((c) => c.kind === "speed_sign");
    const live = new Set(signs.map((c) => c.id));
    for (const [id, marker] of markers) {
      if (!live.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }
    for (const sign of signs) {
      let marker = markers.get(sign.id);
      if (!marker) {
        const element = document.createElement("div");
        element.className =
          "cursor-pointer rounded-[3px] border border-neutral-900 bg-white px-1 py-px text-center font-sans text-[8px] leading-tight font-bold text-neutral-900 shadow-sm select-none";
        const openProperties = (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          const current = sceneRef.current.find((c) => c.id === sign.id);
          if (
            !current ||
            !isEditable(areasRef.current, [current.x, current.y])
          ) {
            setNotice(READ_ONLY);
            return;
          }
          const point = map.project(marker!.getLngLat());
          select(sign.id);
          setMenu(menuAt(map, sign.id, point.x, point.y));
        };
        element.addEventListener("click", openProperties);
        element.addEventListener("contextmenu", openProperties);
        marker = new lib.Marker({ element, anchor: "bottom", offset: [0, -22] })
          .setLngLat(toLngLat([sign.x, sign.y]))
          .addTo(map);
        markers.set(sign.id, marker);
      }
      const element = marker.getElement();
      element.replaceChildren(
        Object.assign(document.createElement("div"), { textContent: "MAX" }),
        Object.assign(document.createElement("div"), {
          textContent: String(sign.speedKmh ?? 40),
          className: "text-[11px]",
        }),
      );
      marker.setLngLat(toLngLat([sign.x, sign.y]));
    }
  }, [scene, mapReady, select]);

  // Resize handles on the selected component's ends and sides.
  const selectedComponent = useMemo(
    () => scene.find((c) => c.id === selected),
    [scene, selected],
  );
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    const handles = handlesRef.current;
    const clear = () => {
      handles.forEach((marker) => marker.remove());
      handles.clear();
    };
    if (!mapReady || !map || !lib || measuring) return clear;
    if (!selectedComponent || !isResizable(selectedComponent)) return clear;
    const id = selectedComponent.id;
    let before: SceneComponent[] | null = null;
    for (const handle of HANDLES) {
      const element = document.createElement("div");
      element.className = `size-3.5 rounded-[3px] border-2 border-neutral-900 bg-white shadow ${
        handle.startsWith("end") ? "cursor-ew-resize" : "cursor-ns-resize"
      }`;
      element.title = handle.startsWith("end")
        ? "Drag to change length"
        : "Drag to change width";
      const marker = new lib.Marker({ element, draggable: true })
        .setLngLat(toLngLat(handlePosition(selectedComponent, handle)))
        .addTo(map);
      marker.on("dragstart", () => {
        before = sceneRef.current;
      });
      marker.on("drag", () => {
        const current = sceneRef.current.find((c) => c.id === id);
        if (!current) return;
        const { lng, lat } = marker.getLngLat();
        const next = resized(current, handle, toLocal(lng, lat));
        const problem = preview(next);
        if (problem) {
          setNotice(problem);
          marker.setLngLat(toLngLat(handlePosition(current, handle)));
          return;
        }
        setNotice(`Length ${next.length} m · width ${next.width} m`);
      });
      marker.on("dragend", () => {
        if (before && before !== sceneRef.current) {
          remember(before);
          setScene(sceneRef.current);
        }
        before = null;
      });
      handles.set(handle, marker);
    }
    return clear;
    // Rebuild only when the selection or its size changes, not on every move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selected,
    mapReady,
    measuring,
    selectedComponent?.length,
    selectedComponent?.width,
    selectedComponent?.rotation,
    preview,
    remember,
  ]);

  // Guideline check: "!" markers on components that break a rule.
  const issues = useMemo(
    () => (checking ? checkScene(scene) : []),
    [checking, scene],
  );
  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    const markers = issueMarkersRef.current;
    markers.forEach((marker) => marker.remove());
    markers.clear();
    if (!mapReady || !map || !lib) return;
    const byId = new Map(scene.map((c) => [c.id, c]));
    for (const issue of issues) {
      const component = byId.get(issue.componentId);
      if (!component) continue;
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = "!";
      element.title = "Breaks a planning guideline; click for details";
      element.className =
        "flex size-11 items-center justify-center rounded-full border-[3px] border-white bg-red-600 text-2xl font-black text-white shadow-xl ring-4 ring-red-600/30 hover:bg-red-700";
      // Lift warnings above the grey read-only overlay so they stay red
      // everywhere; the panels and selection overlay still sit above them.
      element.style.zIndex = "2";
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const point = map.project(toLngLat([component.x, component.y]));
        setIssuePopup({ issue, x: point.x, y: point.y });
        if (isEditable(areasRef.current, [component.x, component.y]))
          select(component.id);
      });
      markers.set(
        issue.componentId,
        new lib.Marker({ element, anchor: "bottom", offset: [0, -24] })
          .setLngLat(toLngLat([component.x, component.y]))
          .addTo(map),
      );
    }
  }, [issues, scene, mapReady, select]);

  // Highlight the selected component, or the one whose menu is open.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const colour = colourFor(menu?.id ?? selected);
    map.setPaintProperty("solid", "fill-extrusion-color", colour);
    map.setPaintProperty("marking", "fill-color", colour);
    map.setPaintProperty("ground", "fill-color", colour);
  }, [menu, selected, mapReady]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3600);
    return () => clearTimeout(timer);
  }, [notice]);

  const menuComponent = useMemo(
    () =>
      menu
        ? (scene.find((c) => c.id === menu.id) ?? menu.sourceComponent)
        : undefined,
    [menu, scene],
  );

  const update = useCallback(
    (component: SceneComponent, patch: Partial<SceneComponent>) => {
      const next = updateSceneComponent(sceneRef.current, component, patch);
      if (breaksSidewalkRule(next, new Set([component.id]))) {
        setNotice(SIDEWALK_RULE);
        return;
      }
      commit(next);
    },
    [commit],
  );

  const remove = useCallback(
    (id: string, sourceComponent?: SceneComponent) => {
      const component =
        sceneRef.current.find((c) => c.id === id) ??
        sourceComponent ??
        (sourceSelectionRef.current?.id === id
          ? sourceSelectionRef.current
          : undefined);
      if (!component) return;
      commit(removeSceneComponent(sceneRef.current, component));
      setMenu(null);
      setIssuePopup(null);
      if (selectedRef.current === id) select(null);
    },
    [commit, select],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Typing in a field (such as the chat box) must not edit the map.
      const field = event.target;
      if (
        field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement ||
        (field instanceof HTMLElement && field.isContentEditable)
      )
        return;
      if (event.key === "Escape") {
        setMenu(null);
        setIssuePopup(null);
        select(null);
        armTool(null);
        if (measuringRef.current) toggleMeasuring();
        setSelectingArea(false);
        setSnip(null);
      }
      const target = menu?.id ?? selected;
      if ((event.key === "Delete" || event.key === "Backspace") && target)
        remove(target, menu?.sourceComponent);
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (key === "y" || (key === "z" && event.shiftKey)) {
          event.preventDefault();
          redo();
        } else if (key === "z") {
          event.preventDefault();
          undo();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armTool, menu, selected, remove, undo, redo, select, toggleMeasuring]);

  /** Look straight down on everything editable, or on downtown if nothing is. */
  function birdsEye() {
    const map = mapRef.current;
    const points = areasRef.current.flatMap((area) =>
      area.rings.flatMap((ring) => ring.map(toLngLat)),
    );
    if (!map) return;
    if (!points.length) {
      // Nothing to frame yet: look straight down on downtown.
      map.easeTo({
        center: [
          (DOWNTOWN_BOUNDS[0][0] + DOWNTOWN_BOUNDS[1][0]) / 2,
          (DOWNTOWN_BOUNDS[0][1] + DOWNTOWN_BOUNDS[1][1]) / 2,
        ],
        zoom: 15,
        pitch: 0,
        bearing: GRID_BEARING,
        duration: 900,
      });
      return;
    }
    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      {
        padding: { top: 70, right: 120, bottom: 70, left: 200 },
        pitch: 0,
        bearing: streetBearing(map) ?? GRID_BEARING,
        maxZoom: 19,
        duration: 900,
      },
    );
  }

  /** The bearing that runs the streets in the editable areas straight up. */
  function streetBearing(map: MapLibreMap): number | null {
    const source = basemapRef.current.buildingSource;
    if (!source) return null;
    const streets = map.querySourceFeatures(source, {
      sourceLayer: "transportation",
      filter: ["in", ["get", "class"], ["literal", STREET_CLASSES]],
    });
    const segments: number[][][] = [];
    for (const street of streets) {
      const geometry = street.geometry;
      const lines =
        geometry.type === "LineString"
          ? [geometry.coordinates]
          : geometry.type === "MultiLineString"
            ? geometry.coordinates
            : [];
      for (const line of lines) {
        for (let i = 1; i < line.length; i++) {
          const a = toLocal(line[i - 1][0], line[i - 1][1]);
          const b = toLocal(line[i][0], line[i][1]);
          const middle: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          if (isEditable(areasRef.current, middle))
            segments.push([line[i - 1], line[i]]);
        }
      }
    }
    return dominantBearing(segments);
  }

  function finishSnip() {
    const map = mapRef.current;
    const box = snip;
    setSnip(null);
    setSelectingArea(false);
    if (!map || !box) return;
    const left = Math.min(box.x0, box.x1);
    const right = Math.max(box.x0, box.x1);
    const top = Math.min(box.y0, box.y1);
    const bottom = Math.max(box.y0, box.y1);
    if (right - left < MIN_SNIP || bottom - top < MIN_SNIP) {
      setNotice("Drag out a larger area to make it editable.");
      return;
    }
    const centre = map.getCenter();
    const [cx, cy] = toLocal(centre.lng, centre.lat);
    const round = (v: number) => Math.round(v * 10) / 10;
    const ring = (
      [
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom],
      ] as const
    ).map(([x, y]): Vec2 => {
      const { lng, lat } = map.unproject([x, y]);
      const [lx, ly] = toLocal(lng, lat);
      return [round(lx), round(ly)];
    });
    // Corners near or above the horizon land absurdly far away.
    if (
      ring.some(
        ([x, y]) =>
          !Number.isFinite(x) || Math.hypot(x - cx, y - cy) > MAX_SNIP_REACH,
      )
    ) {
      setNotice("Keep the selection below the horizon.");
      return;
    }
    // Fit the area to buildings and components its edge cuts through, rather
    // than slicing them in two.
    const footprints: Vec2[][] = sceneRef.current
      .filter((c) => !UNSNAPPED_KINDS.includes(c.kind) && !c.path)
      .flatMap((c) => outlines(c));
    /** Outer rings of the polygons drawn by `layers` under the selection. */
    const ringsUnder = (layers: string[]): Vec2[][] =>
      layers.length
        ? map
            .queryRenderedFeatures(
              [
                [left, top],
                [right, bottom],
              ],
              { layers },
            )
            .flatMap((feature) => {
              const geometry = feature.geometry;
              const polygons =
                geometry.type === "Polygon"
                  ? [geometry.coordinates]
                  : geometry.type === "MultiPolygon"
                    ? geometry.coordinates
                    : [];
              return polygons.flatMap(([outer]) =>
                outer && outer.length >= 4
                  ? [outer.slice(0, -1).map(([lng, lat]) => toLocal(lng, lat))]
                  : [],
              );
            })
        : [];
    footprints.push(
      ...ringsUnder(
        ["osm-buildings", "osm-remainder"].filter((id) => map.getLayer(id)),
      ),
    );
    // Open ground (grass, parks, pitches) cut by the edge, from the basemap.
    const green = /cemetery|stadium|pitch|park/i;
    const ground = ringsUnder(
      map
        .getStyle()
        .layers.filter(
          (layer) =>
            layer.type === "fill" &&
            "source-layer" in layer &&
            (layer["source-layer"] === "landcover" ||
              (layer["source-layer"] === "landuse" && green.test(layer.id))),
        )
        .map((layer) => layer.id),
    );
    const snapped = fitEdges(ring, footprints, ground).map((r) =>
      r.map(([x, y]): Vec2 => [round(x), round(y)]),
    );
    const before = areasRef.current.length;
    const next = addArea(areasRef.current, {
      id: crypto.randomUUID(),
      rings: [ring, ...snapped],
    });
    commitAreas(next);
    setNotice(
      next.length <= before
        ? "Joined with the section next to it; they now form one editable area."
        : snapped.length
          ? "This area is now editable, widened to fit the buildings, components and green space on its edge."
          : "This area is now editable.",
    );
  }

  /**
   * Turn a quarter at a time between the four directions of Toronto's street
   * grid (whose "north" runs up Yonge Street), so streets stay parallel to
   * the screen. From an in-between angle, the first turn snaps to the grid.
   */
  function turn(direction: 1 | -1) {
    const map = mapRef.current;
    if (!map) return;
    const quarters = (map.getBearing() - GRID_BEARING) / 90;
    const nearest = Math.round(quarters);
    const next =
      Math.abs(quarters - nearest) > 0.01 &&
      Math.sign(nearest - quarters) === direction
        ? nearest
        : nearest + direction;
    map.easeTo({ bearing: GRID_BEARING + next * 90, duration: 600 });
  }

  const divider = <div aria-hidden className="w-px self-stretch bg-border" />;
  const viewControls = (
    <div
      role="toolbar"
      aria-label="Map view"
      className="absolute bottom-3 z-10 flex overflow-hidden rounded-lg border bg-background/95 shadow-lg backdrop-blur"
      style={{ left: leftPanelInset }}
    >
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Zoom in"
        title="Zoom in"
        className="rounded-none text-lg"
        onClick={() => mapRef.current?.zoomIn()}
      >
        +
      </Button>
      {divider}
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Zoom out"
        title="Zoom out"
        className="rounded-none text-lg"
        onClick={() => mapRef.current?.zoomOut()}
      >
        −
      </Button>
      {divider}
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Bird's-eye view"
        title="Bird's-eye view"
        className="rounded-none"
        onClick={birdsEye}
      >
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
          <path
            d="M2 9c2.6-1.6 5.6-1.2 8 1.6L12 13l2-2.4c2.4-2.8 5.4-3.2 8-1.6-2.8.2-4.6 1.6-6.2 3.8L12 18l-3.8-5.2C6.6 10.6 4.8 9.2 2 9z"
            fill="currentColor"
          />
        </svg>
      </Button>
      {divider}
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Turn left to the next street-grid direction"
        title="Turn left (N, W, S, E)"
        className="rounded-none text-lg"
        onClick={() => turn(-1)}
      >
        ⟲
      </Button>
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Turn right to the next street-grid direction"
        title="Turn right (N, E, S, W)"
        className="rounded-none text-lg"
        onClick={() => turn(1)}
      >
        ⟳
      </Button>
      {divider}
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label="Show imported network"
        title="Show imported network"
        className="rounded-none text-xs"
        onClick={() => {
          const map = mapRef.current;
          if (!map) return;
          if (network.data) showNetwork(map, network.data, true);
          else
            map.flyTo({
              center: [ORIGIN.lng, ORIGIN.lat],
              zoom: 17,
              pitch: 58,
              bearing: GRID_BEARING - 25,
            });
        }}
      >
        ⌖
      </Button>
    </div>
  );

  const groups = useMemo(
    () => [...new Set(TOOLS.map((tool) => tool.group))],
    [],
  );

  return (
    <div
      className="relative h-full min-h-0 overflow-clip bg-muted"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        ref={containerRef}
        // Inline, because maplibre-gl.css sets .maplibregl-map { position: relative }
        // and would override a utility class, collapsing the map to zero height.
        style={{ position: "absolute", inset: 0 }}
        aria-label="3D intersection map"
      />

      {/* Greys out the read-only map; editable areas are cut out of it. */}
      <div
        ref={greyRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-neutral-400/25 backdrop-grayscale"
        style={{ maskSize: "100% 100%", WebkitMaskSize: "100% 100%" }}
      />
      {/* Outer edge of the editable areas: a wide stroke with the areas'
          interior masked out, so overlaps show no inner boundaries. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full"
      >
        <defs>
          <mask id="edit-area-outline" maskUnits="userSpaceOnUse">
            <rect width="100%" height="100%" fill="white" />
            <path ref={outlineMaskRef} fill="black" />
          </mask>
        </defs>
        <path
          ref={outlineRef}
          fill="none"
          stroke={AREA_COLOUR}
          strokeWidth={6}
          strokeLinejoin="round"
          mask="url(#edit-area-outline)"
        />
      </svg>

      {selectingArea && (
        <div
          role="presentation"
          className="absolute inset-0 z-[5] cursor-crosshair touch-none select-none"
          onPointerDown={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - box.left;
            const y = event.clientY - box.top;
            event.currentTarget.setPointerCapture(event.pointerId);
            setSnip({ x0: x, y0: y, x1: x, y1: y });
          }}
          onPointerMove={(event) => {
            if (!snip) return;
            const box = event.currentTarget.getBoundingClientRect();
            setSnip({
              ...snip,
              x1: event.clientX - box.left,
              y1: event.clientY - box.top,
            });
          }}
          onPointerUp={finishSnip}
        >
          {!snip &&
            areas.map((area, index) => {
              const map = mapRef.current;
              if (!map) return null;
              // Pin the button to the area's top-most corner on screen.
              const corner = area.rings
                .flat()
                .map((p) => map.project(toLngLat(p)))
                .reduce((top, p) => (p.y < top.y ? p : top));
              return (
                <button
                  key={area.id}
                  type="button"
                  title="Remove this editable area"
                  aria-label={`Remove editable area ${index + 1}`}
                  className="absolute z-10 flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded-full bg-[#2f80ed] py-0.5 pr-1 pl-2 text-[11px] font-semibold text-white shadow-lg hover:bg-red-600"
                  style={{ left: corner.x, top: corner.y - 4 }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerUp={(event) => event.stopPropagation()}
                  onClick={() => {
                    commitAreas(
                      areasRef.current.filter((a) => a.id !== area.id),
                    );
                    setNotice(`Area ${index + 1} is read-only again.`);
                  }}
                >
                  Area {index + 1}
                  <span className="flex size-4 items-center justify-center rounded-full bg-white/25 leading-none">
                    ×
                  </span>
                </button>
              );
            })}
          {snip ? (
            <div
              className="absolute border-2 border-dashed border-white bg-white/10 shadow-[0_0_0_9999px_rgb(0_0_0/0.3)]"
              style={{
                left: Math.min(snip.x0, snip.x1),
                top: Math.min(snip.y0, snip.y1),
                width: Math.abs(snip.x1 - snip.x0),
                height: Math.abs(snip.y1 - snip.y0),
              }}
            />
          ) : (
            <div className="absolute inset-0 -z-10 bg-black/30" />
          )}
        </div>
      )}

      {componentsTarget &&
        createPortal(
          <div className="p-3">
            <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
              Pick a component, then click an editable area of the map to place
              it. Esc cancels.
            </p>
            {groups.map((group) => (
              <div key={group} className="pb-5">
                <p className="px-1 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                  {group}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {TOOLS.filter((tool) => tool.group === group).map((tool) => {
                    const armed = activeTool === tool.kind;
                    return (
                      <button
                        key={tool.kind}
                        type="button"
                        aria-pressed={armed}
                        title={`${tool.label}: ${tool.hint}`}
                        onClick={() => armTool(armed ? null : tool.kind)}
                        className={`flex flex-col items-center gap-0.5 rounded-md border p-1 text-center transition ${
                          armed
                            ? "border-border bg-muted"
                            : "border-transparent hover:border-border hover:bg-muted"
                        }`}
                      >
                        <ToolIcon kind={tool.kind} className="size-7" />
                        <span className="text-[11px] leading-tight">
                          {tool.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>,
          componentsTarget,
        )}

      <NetworkPanel
        network={network}
        leftInset={leftPanelInset}
        selectedRoad={selectedRoad}
        onClearSelection={() => setRoadSelection(null)}
        panelInset={panelOpen ? panelWidth + 12 : null}
      />

      <SidePanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        tab={panelTab}
        onTabChange={setPanelTab}
        width={panelWidth}
        onWidthChange={setPanelWidth}
        tools={
          <>
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                className="flex-1 bg-background dark:bg-background"
                disabled={!history.undo}
                title="Undo (Ctrl+Z)"
                onClick={undo}
              >
                ↶ Undo
              </Button>
              <Button
                variant="outline"
                className="flex-1 bg-background dark:bg-background"
                disabled={!history.redo}
                title="Redo (Ctrl+Y)"
                onClick={redo}
              >
                ↷ Redo
              </Button>
            </div>
            <Button
              variant={selectingArea ? "default" : "outline"}
              className="justify-start not-aria-pressed:bg-background dark:not-aria-pressed:bg-background"
              aria-pressed={selectingArea}
              title="Drag a rectangle on the map to make that section editable"
              onClick={() => {
                const next = !selectingArea;
                setSelectingArea(next);
                setSnip(null);
                setMenu(null);
                select(null);
                armTool(null);
                if (measuringRef.current) toggleMeasuring();
                setNotice(
                  next
                    ? areasRef.current.length
                      ? "Drag a rectangle to add an area, or click an area's × to remove it."
                      : "Drag a rectangle over the part of the map you want to edit."
                    : null,
                );
              }}
            >
              ⬚ Select area
            </Button>
            {areas.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="justify-start bg-background dark:bg-background"
                onClick={() => {
                  commitAreas([]);
                  select(null);
                  setNotice(
                    "All areas are read-only again. Undo to restore them.",
                  );
                }}
              >
                Clear editable areas
              </Button>
            )}
            <Button
              variant={measuring ? "default" : "outline"}
              className="justify-start not-aria-pressed:bg-background dark:not-aria-pressed:bg-background"
              aria-pressed={measuring}
              onClick={toggleMeasuring}
            >
              📏 Measure
            </Button>
            {measurements.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="justify-start not-aria-pressed:bg-background dark:not-aria-pressed:bg-background"
                onClick={() => setMeasurements([])}
              >
                Clear measurements
              </Button>
            )}
            <Button
              variant={checking ? "default" : "outline"}
              className="justify-start not-aria-pressed:bg-background dark:not-aria-pressed:bg-background"
              aria-pressed={checking}
              onClick={() => {
                const next = !checking;
                setChecking(next);
                setIssuePopup(null);
                if (next) {
                  const found = checkScene(sceneRef.current).length;
                  setNotice(
                    found
                      ? `${found} component${found === 1 ? "" : "s"} break a planning guideline. Click a ! for details.`
                      : "No guideline issues found.",
                  );
                }
              }}
            >
              <span
                aria-hidden
                className="flex size-4 items-center justify-center rounded-full border border-white bg-red-600 text-[10px] font-black text-white"
              >
                !
              </span>
              Check Policies
            </Button>
          </>
        }
      />

      {menu && menuComponent && (
        <ComponentMenu
          component={menuComponent}
          x={menu.x}
          y={menu.y}
          bounds={menu.bounds}
          onClose={() => setMenu(null)}
          onUpdate={(patch) => update(menuComponent, patch)}
          onDelete={() => remove(menuComponent.id, menuComponent)}
        />
      )}

      {issuePopup && (
        <div
          role="dialog"
          aria-label="Guideline issue"
          style={{
            left: Math.max(8, issuePopup.x - 140),
            top: Math.max(8, issuePopup.y - 170),
          }}
          className="absolute z-30 w-72 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-xl"
        >
          <div className="mb-1 flex items-start justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-red-600">
              <span className="flex size-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-black text-white">
                !
              </span>
              Guideline issue
            </span>
            <button
              type="button"
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setIssuePopup(null)}
            >
              ×
            </button>
          </div>
          <a
            href={SOURCES[issuePopup.issue.source].url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm leading-snug underline decoration-red-600/50 underline-offset-2 hover:decoration-red-600"
          >
            {issuePopup.issue.message}
          </a>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Source: {SOURCES[issuePopup.issue.source].name}
          </p>
        </div>
      )}

      {historyToolbar &&
        createPortal(
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={!history.undo}
              onClick={undo}
              title="Undo (Ctrl+Z)"
            >
              Undo
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!history.redo}
              onClick={redo}
              title="Redo (Ctrl+Y)"
            >
              Redo
            </Button>
          </>,
          historyToolbar,
        )}
      {viewControls}

      {basemapFailed && !mapReady && (
        <div
          role="alert"
          className="absolute inset-x-0 top-1/2 z-20 mx-auto w-fit max-w-sm -translate-y-1/2 rounded-lg border bg-background p-4 text-center text-sm shadow-lg"
        >
          The Toronto basemap could not load. Check that{" "}
          <code>MAPTILER_API_KEY</code> is set in <code>app/.env.local</code>,
          then restart <code>pnpm dev</code>.
        </div>
      )}

      {mapReady && !areas.length && !selectingArea && (
        <div className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded-full bg-neutral-900/85 px-4 py-1.5 text-xs text-white shadow">
          The map is read-only. Use Select area to choose a section to edit.
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="absolute bottom-4 left-1/2 z-20 -translate-x-1/2 rounded-full bg-neutral-900/85 px-4 py-1.5 text-xs text-white shadow"
        >
          {notice}
        </div>
      )}
    </div>
  );
}
