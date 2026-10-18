"use client";

import type { Feature, LineString } from "geojson";
import { Button } from "@/components/ui/button";
import type { useRoadNetwork } from "../hooks/use-road-network";
import type { RoadProperties } from "../lib/network";

interface Props {
  network: ReturnType<typeof useRoadNetwork>;
  selectedRoad: Feature<LineString, RoadProperties> | null;
  onClearSelection: () => void;
  /** Pixels taken by the open side panel on the right, or null if closed. */
  panelInset: number | null;
}

export function NetworkPanel({
  network,
  selectedRoad,
  onClearSelection,
  panelInset,
}: Props) {
  return (
    <>
      <div
        role="status"
        aria-live="polite"
        style={{ right: panelInset ?? 144 }}
        className="absolute top-3 left-48 z-10 mx-auto max-w-sm rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
      >
        <p className="font-semibold">Toronto downtown roads</p>
        <p className="mt-1 text-muted-foreground">
          {network.status === "loading" && "Loading imported roads…"}
          {network.status === "signed-out" && "Sign in to load imported roads."}
          {network.status === "missing" &&
            "No road network has been published yet."}
          {network.status === "error" && "Imported roads could not load."}
          {network.data &&
            `${network.data.edgeCount.toLocaleString()} road segments · select a road to inspect it`}
        </p>
        {network.status === "error" && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={network.retry}
          >
            Try again
          </Button>
        )}
      </div>
      {selectedRoad && (
        <section
          aria-label="Selected road"
          style={{ right: panelInset ?? 12 }}
          className="absolute top-28 z-10 w-64 rounded-lg border bg-background/95 p-3 text-sm shadow-lg backdrop-blur"
        >
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-semibold">
              {selectedRoad.properties.name || "Unnamed road"}
            </h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Clear road selection"
              onClick={onClearSelection}
            >
              ×
            </Button>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
            <dt className="text-muted-foreground">Lanes</dt>
            <dd>{selectedRoad.properties.lane_count}</dd>
            <dt className="text-muted-foreground">Speed limit</dt>
            <dd>{Math.round(selectedRoad.properties.speed_mps * 3.6)} km/h</dd>
            <dt className="text-muted-foreground">Length</dt>
            <dd>{Math.round(selectedRoad.properties.length_metres)} m</dd>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            One direction of travel.
          </p>
        </section>
      )}
    </>
  );
}
