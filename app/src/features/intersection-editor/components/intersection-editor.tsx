"use client";

import "maplibre-gl/dist/maplibre-gl.css";
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
  type BasemapFeature,
  type HiddenBuilding,
  type PointerRay,
} from "../lib/osm";
import { renderScene, type SceneLayers } from "../lib/render";
import { checkScene, SOURCES, type Issue } from "../lib/rules";
import { componentFromDrop, describe } from "../lib/scene";
import { useRoadNetwork } from "../hooks/use-road-network";
import {
  NETWORK_LAYER,
  NETWORK_SOURCE,
  type LoadedNetwork,
} from "../lib/network";
import { loadEditorScene, SCENE_STORAGE_KEY } from "../lib/scene-storage";
import { addNetworkLayer, showNetwork } from "../lib/network-layer";
import { componentsOverlap, gapBetween } from "../lib/spatial";
import { ComponentMenu } from "./component-menu";
import { ToolIcon } from "./tool-icon";
import { NetworkPanel } from "./network-panel";

const MEASURE_KEY = "traffic-thing:measurements:v1";
const TOOL_MIME = "application/x-traffic-thing-tool";
const LAYER_IDS = ["solid", "marking", "ground"] as const;
const HIGHLIGHT = "#ffc94d";
const MEASURE_COLOUR = "#e8338b";
const GROW_MS = 380;
const SIDEWALK_RULE = "Sidewalks can't overlap roads or lanes.";

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

function load<T>(key: string, fallback: () => T): T {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "null");
    if (Array.isArray(saved) && saved.length) return saved as T;
  } catch {
    // Corrupt or unavailable storage: fall back to the default.
  }
  return fallback();
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or disabled; editing still works for this session.
  }
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
  const cosLat = Math.cos((center.lat * Math.PI) / 180);
  // Camera distance to the map centre, in screen pixels and then metres.
  const pixels = (0.5 / Math.tan(fov / 2)) * map.getContainer().clientHeight;
  const metres =
    pixels * ((40_075_016.686 * cosLat) / (512 * 2 ** map.getZoom()));
  const back = metres * Math.sin(pitch);
  return {
    ground: toLocal(ground.lng, ground.lat),
    camera: toLocal(
      center.lng - (back * Math.sin(bearing)) / (111_320 * cosLat),
      center.lat - (back * Math.cos(bearing)) / 111_320,
    ),
    altitude: Math.max(1, metres * Math.cos(pitch)),
  };
}

interface MenuState {
  id: string;
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

export function IntersectionEditor() {
  const [scene, setScene] = useState<SceneComponent[]>(loadEditorScene);
  const network = useRoadNetwork();
  const [roadSelection, setRoadSelection] = useState<{
    networkId: string;
    edgeId: string;
  } | null>(null);
  const [measurements, setMeasurements] = useState<Measurement[]>(() =>
    load(MEASURE_KEY, () => []),
  );
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draggingTool, setDraggingTool] = useState<ComponentKind | null>(null);
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
  const historyRef = useRef<SceneComponent[][]>([]);
  const futureRef = useRef<SceneComponent[][]>([]);
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
    (before: SceneComponent[]) => {
      historyRef.current = [...historyRef.current.slice(-49), before];
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

  /** Step through history: undo moves back, redo moves forward again. */
  const travel = useCallback(
    (direction: "undo" | "redo") => {
      const [from, to] =
        direction === "undo"
          ? [historyRef, futureRef]
          : [futureRef, historyRef];
      const target = from.current.pop();
      if (!target) return;
      to.current.push(sceneRef.current);
      sceneRef.current = target;
      setScene(target);
      setMenu(null);
      setIssuePopup(null);
      syncHistory();
    },
    [syncHistory],
  );
  const undo = useCallback(() => travel("undo"), [travel]);
  const redo = useCallback(() => travel("redo"), [travel]);

  const select = useCallback((id: string | null) => {
    setRoadSelection(null);
    selectedRef.current = id;
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
      drawMeasurements();
      if (growingRef.current.size)
        frameRef.current = requestAnimationFrame(frame);
    },
    [drawMeasurements],
  );

  /** Apply a live (uncommitted) change during a drag, unless it breaks the sidewalk rule. */
  const preview = useCallback(
    (component: SceneComponent): boolean => {
      const next = sceneRef.current.map((c) =>
        c.id === component.id ? component : c,
      );
      if (breaksSidewalkRule(next, new Set([component.id]))) return false;
      sceneRef.current = next;
      markersRef.current
        .get(component.id)
        ?.setLngLat(toLngLat([component.x, component.y]));
      for (const [handle, marker] of handlesRef.current) {
        marker.setLngLat(toLngLat(handlePosition(component, handle)));
      }
      if (frameRef.current === null) draw();
      return true;
    },
    [draw],
  );

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
        center: [ORIGIN.lng, ORIGIN.lat],
        zoom: 17,
        pitch: 58,
        bearing: GRID_BEARING - 25,
        maxPitch: 80,
        minZoom: 13,
        maxZoom: 20,
        maxBounds: DOWNTOWN_BOUNDS,
        canvasContextAttributes: { antialias: true },
      });
      mapRef.current = map;
      map.on("error", (e) => {
        // Only a missing style is fatal; a failed icon or tile is not.
        const url = (e.error as { url?: string } | undefined)?.url ?? "";
        if (url.includes("style.json")) setBasemapFailed(true);
      });
      map.on("load", () => {
        basemapRef.current = addSceneLayers(map!);
        setMapReady(true);
      });
      const hitAt = (point: { x: number; y: number }) =>
        map!.queryRenderedFeatures([point.x, point.y], {
          layers: [...LAYER_IDS],
        })[0]?.properties?.cid as string | undefined;

      /** Basemap buildings remain visual components; roads use the SUMO layer. */
      const basemapAt = (point: {
        x: number;
        y: number;
      }): BasemapFeature | null => {
        const layers = ["osm-buildings", "osm-remainder"].filter((id) =>
          map!.getLayer(id),
        );
        if (!layers.length) return null;
        const [hit] = map!.queryRenderedFeatures([point.x, point.y], {
          layers,
        });
        if (!hit) return null;
        const properties = hit.properties ?? {};
        return {
          id: hit.layer.id === "osm-remainder" ? properties.osmId : hit.id,
          geometry: hit.geometry,
          properties,
          layer: hit.layer.type === "fill-extrusion" ? "building" : "road",
        };
      };

      const endDrag = () => {
        if (!drag) return;
        if (drag.moved) {
          remember(drag.before);
          setScene(sceneRef.current);
          // Swallow the click that follows this mouseup, but no later one
          // (there is none when the drag ends outside the map).
          justDragged = true;
          setTimeout(() => (justDragged = false), 0);
        }
        drag = null;
        map!.dragPan.enable();
        map!.getCanvas().style.cursor = "";
      };

      map.on("mousedown", (e) => {
        if (e.originalEvent.button === 2) {
          rightDown = { x: e.point.x, y: e.point.y };
          return;
        }
        if (e.originalEvent.button !== 0 || measuringRef.current) return;
        const id = hitAt(e.point);
        const component = sceneRef.current.find((c) => c.id === id);
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
          const id = hitAt(e.point);
          map!.getCanvas().style.cursor = measuringRef.current
            ? "crosshair"
            : id && id === selectedRef.current
              ? "move"
              : id
                ? "pointer"
                : map!.getLayer(NETWORK_LAYER) &&
                    map!.queryRenderedFeatures(e.point, {
                      layers: [NETWORK_LAYER],
                    }).length
                  ? "pointer"
                  : "";
          return;
        }
        const [x, y] = toLocal(e.lngLat.lng, e.lngLat.lat);
        const round = (v: number) => Math.round(v * 10) / 10;
        const id = drag.id;
        const component = sceneRef.current.find((c) => c.id === id);
        if (!component) return;
        const moved = {
          ...component,
          x: round(drag.origin[0] + x - drag.grab[0]),
          y: round(drag.origin[1] + y - drag.grab[1]),
        };
        if (preview(moved)) {
          drag.moved = true;
        } else if (!drag.blocked) {
          drag.blocked = true;
          setNotice(SIDEWALK_RULE);
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
        const id = hitAt(e.point);
        setMenu(id ? menuAt(e.target, id, e.point.x, e.point.y) : null);
      });
      map.on("click", (e) => {
        setMenu(null);
        setIssuePopup(null);
        if (justDragged) {
          justDragged = false;
          return;
        }
        let id = hitAt(e.point) ?? null;

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

        // Imported roads retain their SUMO identity instead of becoming scenery.
        if (!id) {
          const layers = [
            "osm-buildings",
            "osm-remainder",
            NETWORK_LAYER,
          ].filter((layer) => map!.getLayer(layer));
          const hit = layers.length
            ? map!.queryRenderedFeatures(e.point, { layers })[0]
            : null;
          if (hit?.layer.id === NETWORK_LAYER && networkRef.current) {
            const edgeId = hit.properties?.edge_id;
            if (typeof edgeId === "string") {
              select(null);
              setRoadSelection({ networkId: networkRef.current.id, edgeId });
              return;
            }
          }
          const feature = basemapAt(e.point);
          const converted =
            feature &&
            componentFromBasemap(feature, pointerRay(map!, e.lngLat));
          if (converted) {
            commit([...sceneRef.current, converted]);
            id = converted.id;
            setNotice(
              `This ${converted.kind} from the map is now editable. Drag, resize or right-click it.`,
            );
            select(id);
            return;
          }
        }
        select(id);
        if (id)
          setNotice(
            "Selected. Drag it to move, or drag the white handles to resize.",
          );
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
  }, [commit, draw, preview, remember, select]);

  // Redraw and persist whenever the scene changes.
  useEffect(() => {
    if (mapReady && frameRef.current === null) draw();
    save(SCENE_STORAGE_KEY, scene);
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
    showNetwork(map, data);
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
    save(MEASURE_KEY, measurements);
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
          "cursor-context-menu rounded-[3px] border border-neutral-900 bg-white px-1 py-px text-center font-sans text-[8px] leading-tight font-bold text-neutral-900 shadow-sm select-none";
        element.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          const point = map.project(marker!.getLngLat());
          setMenu(menuAt(map, sign.id, point.x, point.y));
        });
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
  }, [scene, mapReady]);

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
        if (!preview(next)) {
          setNotice(SIDEWALK_RULE);
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
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const point = map.project(toLngLat([component.x, component.y]));
        setIssuePopup({ issue, x: point.x, y: point.y });
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
    () => (menu ? scene.find((c) => c.id === menu.id) : undefined),
    [menu, scene],
  );

  const update = useCallback(
    (id: string, patch: Partial<SceneComponent>) => {
      const next = sceneRef.current.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      );
      if (breaksSidewalkRule(next, new Set([id]))) {
        setNotice(SIDEWALK_RULE);
        return;
      }
      commit(next);
    },
    [commit],
  );

  const remove = useCallback(
    (id: string) => {
      // A deleted map feature leaves a placeholder so the basemap keeps it hidden.
      commit(
        sceneRef.current.flatMap((c) =>
          c.id !== id
            ? [c]
            : c.osmId === undefined
              ? []
              : [
                  {
                    id: c.id,
                    kind: "removed_osm" as const,
                    x: c.x,
                    y: c.y,
                    rotation: 0,
                    osmId: c.osmId,
                    footprint: c.footprint,
                    osmAt: c.osmAt ?? (c.footprint ? [c.x, c.y] : undefined),
                  },
                ],
        ),
      );
      setMenu(null);
      setIssuePopup(null);
      if (selectedRef.current === id) select(null);
    },
    [commit, select],
  );

  const toggleMeasuring = useCallback(() => {
    const next = !measuringRef.current;
    measuringRef.current = next;
    measureStartRef.current = null;
    setMeasuring(next);
    select(null);
    setNotice(next ? "Measure: click one component, then another." : null);
  }, [select]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === "Escape") {
        setMenu(null);
        setIssuePopup(null);
        select(null);
        if (measuringRef.current) toggleMeasuring();
      }
      const target = menu?.id ?? selected;
      if ((event.key === "Delete" || event.key === "Backspace") && target)
        remove(target);
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
  }, [menu, selected, remove, undo, redo, select, toggleMeasuring]);

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    const kind = event.dataTransfer.getData(TOOL_MIME) as ComponentKind;
    setDraggingTool(null);
    const map = mapRef.current;
    const container = containerRef.current;
    if (!kind || !TOOL_BY_KIND[kind] || !map || !container) return;
    if ((event.target as HTMLElement).closest("[data-toolbox]")) return;
    event.preventDefault();
    const box = container.getBoundingClientRect();
    const { lng, lat } = map.unproject([
      event.clientX - box.left,
      event.clientY - box.top,
    ]);
    const [x, y] = toLocal(lng, lat);
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
      `Added ${describe(created).toLowerCase()}. Drag the handles to resize it.`,
    );
  }

  const groups = useMemo(
    () => [...new Set(TOOLS.map((tool) => tool.group))],
    [],
  );

  return (
    <div
      className="relative h-full min-h-[560px] overflow-clip rounded-xl border bg-muted"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(TOOL_MIME)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={onDrop}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div
        ref={containerRef}
        // Inline, because maplibre-gl.css sets .maplibregl-map { position: relative }
        // and would override a utility class, collapsing the map to zero height.
        style={{ position: "absolute", inset: 0 }}
        aria-label="3D intersection map"
      />

      <aside
        data-toolbox
        aria-label="Component tools"
        className="absolute top-3 left-3 z-10 max-h-[calc(100%-1.5rem)] w-[172px] overflow-y-auto rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur"
      >
        <p className="px-1 pb-1 text-xs font-semibold">Tools</p>
        {groups.map((group) => (
          <div key={group} className="pb-2">
            <p className="px-1 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {group}
            </p>
            <div className="grid grid-cols-3 gap-1">
              {TOOLS.filter((tool) => tool.group === group).map((tool) => (
                <div
                  key={tool.kind}
                  draggable
                  title={`${tool.label}: ${tool.hint}`}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(TOOL_MIME, tool.kind);
                    event.dataTransfer.effectAllowed = "copy";
                    const icon = event.currentTarget.querySelector("svg");
                    if (icon) event.dataTransfer.setDragImage(icon, 14, 14);
                    setDraggingTool(tool.kind);
                    setMenu(null);
                  }}
                  onDragEnd={() => setDraggingTool(null)}
                  className="flex cursor-grab flex-col items-center gap-0.5 rounded-md border border-transparent p-1 text-center transition hover:border-border hover:bg-muted active:cursor-grabbing"
                >
                  <ToolIcon kind={tool.kind} className="size-7" />
                  <span className="text-[9px] leading-tight">{tool.label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="px-1 pt-1 text-[10px] leading-snug text-muted-foreground">
          Select a highlighted road to inspect it. Click a building to edit its
          appearance.
        </p>
      </aside>

      <NetworkPanel
        network={network}
        selectedRoad={selectedRoad}
        onClearSelection={() => setRoadSelection(null)}
      />

      <div
        role="toolbar"
        aria-label="Planning tools"
        className="absolute top-3 right-3 z-10 flex flex-col gap-1.5"
      >
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            className="flex-1 bg-background shadow-lg dark:bg-background"
            disabled={!history.undo}
            title="Undo (Ctrl+Z)"
            onClick={undo}
          >
            ↶ Undo
          </Button>
          <Button
            variant="outline"
            className="flex-1 bg-background shadow-lg dark:bg-background"
            disabled={!history.redo}
            title="Redo (Ctrl+Y)"
            onClick={redo}
          >
            ↷ Redo
          </Button>
        </div>
        <Button
          variant={measuring ? "default" : "outline"}
          className="justify-start shadow-lg not-aria-pressed:bg-background dark:not-aria-pressed:bg-background"
          aria-pressed={measuring}
          onClick={toggleMeasuring}
        >
          📏 Measure
        </Button>
        {measurements.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="justify-start shadow-lg not-aria-pressed:bg-background dark:not-aria-pressed:bg-background"
            onClick={() => setMeasurements([])}
          >
            Clear measurements
          </Button>
        )}
        <Button
          variant={checking ? "default" : "outline"}
          className="justify-start shadow-lg not-aria-pressed:bg-background dark:not-aria-pressed:bg-background"
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
          ⚠ Check
        </Button>
      </div>

      {draggingTool && (
        <div className="pointer-events-none absolute inset-2 rounded-lg border-2 border-dashed border-white/80" />
      )}

      {menu && menuComponent && (
        <ComponentMenu
          component={menuComponent}
          x={menu.x}
          y={menu.y}
          bounds={menu.bounds}
          onUpdate={(patch) => update(menuComponent.id, patch)}
          onDelete={() => remove(menuComponent.id)}
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

      <div
        role="group"
        aria-label="Zoom"
        className="absolute right-3 bottom-8 z-10 flex flex-col overflow-hidden rounded-lg border bg-background/95 shadow-lg backdrop-blur"
      >
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label="Zoom in"
          className="rounded-none text-lg"
          onClick={() => mapRef.current?.zoomIn()}
        >
          +
        </Button>
        <div className="h-px bg-border" />
        <Button
          variant="ghost"
          size="icon-lg"
          aria-label="Zoom out"
          className="rounded-none text-lg"
          onClick={() => mapRef.current?.zoomOut()}
        >
          −
        </Button>
        <div className="h-px bg-border" />
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
