import type {
  ExpressionSpecification,
  LayerSpecification,
  Map as MapLibreMap,
} from "maplibre-gl";
import { BUILDING_COLOURS, COLOURS } from "./components";
import { ORIGIN } from "./geometry";

// Restyle the MapTiler OpenStreetMap basemap so real streets, sidewalks,
// buildings and parks look like the editor's own components.

// Metres per pixel at zoom 0 for 512 px tiles, at the scene's latitude.
const METRES_PER_PIXEL_Z0 =
  (40_075_016.686 * Math.cos((ORIGIN.lat * Math.PI) / 180)) / 512;

/** A line width that stays a fixed number of metres on the ground at any zoom. */
function metres(
  width: number | ExpressionSpecification,
): ExpressionSpecification {
  return [
    "interpolate",
    ["exponential", 2],
    ["zoom"],
    10,
    ["*", width, 2 ** 10 / METRES_PER_PIXEL_Z0],
    22,
    ["*", width, 2 ** 22 / METRES_PER_PIXEL_Z0],
  ];
}

// Carriageway (kerb-to-kerb) widths by OpenMapTiles class, in metres.
const CARRIAGEWAY: ExpressionSpecification = [
  "match",
  ["get", "class"],
  "motorway",
  15,
  "trunk",
  14,
  "primary",
  13,
  "secondary",
  11,
  "tertiary",
  9,
  "minor",
  7,
  "service",
  4.5,
  "track",
  3,
  6,
];
const SIDEWALK_EACH_SIDE = 3;

const GROUND = "#d9d3c7";
const GRASS = "#a7c98a";
const WATER = "#8ec3dc";

type Layer = LayerSpecification & { "source-layer"?: string };

function isRoadLayer(layer: Layer) {
  return (
    layer.type === "line" &&
    layer["source-layer"] === "transportation" &&
    !/path|pedestrian|steps|track|rail|subway|cablecar|ferry|pier|raceway|dash|runway|taxiway/i.test(
      layer.id,
    )
  );
}

export function themeBasemap(map: MapLibreMap) {
  const layers = map.getStyle().layers as Layer[];
  const paint = (
    id: string,
    property: Parameters<MapLibreMap["setPaintProperty"]>[1],
    value: Parameters<MapLibreMap["setPaintProperty"]>[2],
  ) => map.setPaintProperty(id, property, value);
  const hide = (id: string) => map.setLayoutProperty(id, "visibility", "none");

  for (const layer of layers) {
    const id = layer.id;
    if (layer.type === "background") {
      paint(id, "background-color", GROUND);
    } else if (
      /pattern|hatching|outline/i.test(id) &&
      layer["source-layer"] !== "transportation"
    ) {
      hide(id);
    } else if (layer.type === "fill" && layer["source-layer"] === "landcover") {
      paint(id, "fill-color", GRASS);
      paint(id, "fill-opacity", 1);
    } else if (layer.type === "fill" && layer["source-layer"] === "landuse") {
      const green = /cemetery|stadium|pitch|park/i.test(id);
      paint(id, "fill-color", green ? GRASS : GROUND);
    } else if (layer.type === "fill" && layer["source-layer"] === "water") {
      paint(id, "fill-color", WATER);
    } else if (
      layer.type === "fill" &&
      /pedestrian|platform|bridge area/i.test(id)
    ) {
      paint(id, "fill-color", COLOURS.concrete);
    } else if (isRoadLayer(layer)) {
      // "... outline" layers are drawn first and wider: they become the sidewalks.
      const outline = /outline/i.test(id);
      paint(id, "line-color", outline ? COLOURS.concrete : COLOURS.asphalt);
      paint(
        id,
        "line-width",
        metres(
          outline ? ["+", CARRIAGEWAY, 2 * SIDEWALK_EACH_SIDE] : CARRIAGEWAY,
        ),
      );
      paint(id, "line-opacity", 1);
    } else if (layer.type === "line" && /path|pedestrian/i.test(id)) {
      paint(id, "line-color", COLOURS.concrete);
      paint(id, "line-width", metres(/outline/i.test(id) ? 2.6 : 2));
      if (/second outline/i.test(id)) hide(id);
    } else if (layer.type === "line" && /minor rail/i.test(id)) {
      // Two rails at standard gauge, like the streetcar track component.
      paint(id, "line-color", COLOURS.rail);
      paint(id, "line-width", metres(0.12));
      paint(id, "line-gap-width", metres(1.44));
    } else if (layer.type === "line" && /major rail/i.test(id)) {
      paint(id, "line-color", COLOURS.rail);
      paint(id, "line-width", metres(0.12));
      paint(id, "line-gap-width", metres(1.44));
    }
  }

  // Painted centre lines, as on the editor's roads: double yellow on arterials,
  // dashed white on local streets.
  const roads = layers.filter(isRoadLayer);
  const source = roads.find((layer) => "source" in layer);
  const above = layers[layers.indexOf(roads[roads.length - 1]) + 1]?.id;
  if (source && "source" in source) {
    map.addLayer(
      {
        id: "centre-lines",
        type: "line",
        source: source.source,
        "source-layer": "transportation",
        minzoom: 15,
        filter: [
          "all",
          [
            "in",
            ["get", "class"],
            ["literal", ["trunk", "primary", "secondary", "tertiary"]],
          ],
          ["!=", ["get", "oneway"], 1],
        ],
        paint: {
          "line-color": COLOURS.centreLine,
          "line-width": metres(0.1),
          "line-gap-width": metres(0.15),
        },
      },
      above,
    );
    map.addLayer(
      {
        id: "lane-dashes",
        type: "line",
        source: source.source,
        "source-layer": "transportation",
        minzoom: 16,
        filter: ["in", ["get", "class"], ["literal", ["minor"]]],
        paint: {
          "line-color": COLOURS.paint,
          "line-width": metres(0.12),
          "line-dasharray": [20, 40],
        },
      },
      above,
    );
  }
}

/** Fill-extrusion colour for OSM buildings: the component palette, varied by id. */
export const BUILDING_COLOUR: ExpressionSpecification = [
  "to-color",
  [
    "at",
    ["%", ["to-number", ["id"], 0], BUILDING_COLOURS.length],
    ["literal", BUILDING_COLOURS],
  ],
];
