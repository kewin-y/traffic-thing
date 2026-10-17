import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import { NETWORK_LAYER, NETWORK_SOURCE, type LoadedNetwork } from "./network";

export function showNetwork(
  map: MapLibreMap,
  data: LoadedNetwork,
  animate = false,
) {
  map.fitBounds(data.bounds, {
    padding: { top: 85, right: 100, bottom: 60, left: 200 },
    pitch: 35,
    bearing: 0,
    duration: animate ? 700 : 0,
  });
}

export function addNetworkLayer(map: MapLibreMap, data: LoadedNetwork) {
  map.addSource(NETWORK_SOURCE, {
    type: "geojson",
    data: data.roads,
    promoteId: "edge_id",
    attribution: data.attribution
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;"),
  });
  const selected: ExpressionSpecification = [
    "boolean",
    ["feature-state", "selected"],
    false,
  ];
  map.addLayer(
    {
      id: NETWORK_LAYER,
      type: "line",
      source: NETWORK_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["case", selected, "#ffc94d", "#20b8a6"],
        "line-width": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          ["case", selected, 4, 1.25],
          18,
          ["case", selected, 7, 3],
        ],
      },
    },
    map.getLayer("osm-buildings")
      ? "osm-buildings"
      : map.getStyle().layers.find((layer) => layer.type === "symbol")?.id,
  );
}
