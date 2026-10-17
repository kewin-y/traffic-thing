"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { LaneKind, SceneComponent } from "../lib/components";
import { ARMS } from "../lib/scene";
import {
  buildScenario,
  scenarioWarnings,
  type Demand,
  type ScenarioLane,
} from "../lib/scenario";

const LANE_STYLE: Record<LaneKind, { label: string; className: string }> = {
  car_lane: { label: "C", className: "bg-[#4b5058] text-white" },
  bike_lane: { label: "B", className: "bg-[#4f8a5b] text-white" },
  streetcar_lane: { label: "S", className: "bg-[#d6281f] text-white" },
};

const CONTROL_LABEL = {
  traffic_light: "Signalized",
  allway_stop: "All-way stop",
  priority: "Uncontrolled",
};

const DEMAND_FIELDS: { key: keyof Demand; label: string; max: number }[] = [
  { key: "carsPerHour", label: "Cars / h per arm", max: 2000 },
  { key: "bikesPerHour", label: "Bikes / h per arm", max: 1000 },
  { key: "streetcarsPerHour", label: "Streetcars / h per direction", max: 40 },
  { key: "durationMinutes", label: "Simulated minutes", max: 60 },
];

function Lanes({ lanes }: { lanes: ScenarioLane[] }) {
  if (!lanes.length) return <span className="text-muted-foreground">none</span>;
  return (
    <span className="inline-flex gap-0.5">
      {lanes.map((lane, i) => (
        <span
          key={i}
          title={lane.kind.replace("_", " ")}
          className={`inline-flex size-4 items-center justify-center rounded-[3px] text-[9px] font-bold ${LANE_STYLE[lane.kind].className}`}
        >
          {LANE_STYLE[lane.kind].label}
        </span>
      ))}
    </span>
  );
}

export function ScenarioPanel({
  scene,
  demand,
  onDemandChange,
  canUndo,
  onUndo,
  onReset,
}: {
  scene: SceneComponent[];
  demand: Demand;
  onDemandChange: (demand: Demand) => void;
  canUndo: boolean;
  onUndo: () => void;
  onReset: () => void;
}) {
  const scenario = useMemo(() => buildScenario(scene, demand), [scene, demand]);
  const warnings = useMemo(() => scenarioWarnings(scenario), [scenario]);

  function exportScenario() {
    const blob = new Blob([JSON.stringify(scenario, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = Object.assign(document.createElement("a"), {
      href: url,
      download: "scenario.json",
    });
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <aside
      aria-label="Scenario"
      className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-xl border bg-card p-4 text-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Scenario</h2>
          <p className="text-xs text-muted-foreground">
            {scene.length} components
          </p>
        </div>
        <div className="flex gap-1">
          <Button
            size="xs"
            variant="outline"
            disabled={!canUndo}
            onClick={onUndo}
          >
            Undo
          </Button>
          <Button size="xs" variant="ghost" onClick={onReset}>
            Reset
          </Button>
        </div>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium">Junction</h3>
          <Badge variant="outline">{CONTROL_LABEL[scenario.control]}</Badge>
        </div>
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] text-muted-foreground uppercase">
            <tr>
              <th className="pb-1 font-medium">Arm</th>
              <th className="pb-1 font-medium">In</th>
              <th className="pb-1 font-medium">Out</th>
              <th className="pb-1 text-right font-medium">km/h</th>
            </tr>
          </thead>
          <tbody>
            {ARMS.map((arm) => (
              <tr key={arm} className="border-t">
                <td className="py-1.5 capitalize">{arm}</td>
                <td className="py-1.5">
                  <Lanes lanes={scenario.arms[arm].inbound} />
                </td>
                <td className="py-1.5">
                  <Lanes lanes={scenario.arms[arm].outbound} />
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {scenario.arms[arm].speed_kmh}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[11px] text-muted-foreground">
          Lanes are listed kerb-side first. C car · B bike · S streetcar.
        </p>
      </section>

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md bg-amber-500/10 p-2 text-[11px] text-amber-900 dark:text-amber-200">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <Separator />

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium">Demand</h3>
        {DEMAND_FIELDS.map(({ key, label, max }) => (
          <div key={key} className="flex items-center justify-between gap-2">
            <Label htmlFor={`demand-${key}`} className="text-xs font-normal">
              {label}
            </Label>
            <Input
              id={`demand-${key}`}
              type="number"
              min={key === "durationMinutes" ? 1 : 0}
              max={max}
              value={demand[key]}
              onChange={(event) => {
                const value = Math.min(
                  max,
                  Math.max(0, Number(event.target.value) || 0),
                );
                onDemandChange({ ...demand, [key]: value });
              }}
              className="h-7 w-20 text-right text-xs"
            />
          </div>
        ))}
      </section>

      <Separator />

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-medium">Simulate in SUMO</h3>
        <Button onClick={exportScenario}>Export scenario.json</Button>
        <p className="text-[11px] text-muted-foreground">
          Then, from <code>worker/</code>, run the scenario (add{" "}
          <code>--gui</code> to watch it):
        </p>
        <pre className="overflow-x-auto rounded-md bg-muted p-2 text-[10px] leading-relaxed">
          uv run python -m traffic_worker.scenario path/to/scenario.json
        </pre>
      </section>

      <p className="mt-auto text-[11px] text-muted-foreground">
        Drag tools onto the map to add components. Right-click any component to
        edit or delete it. Right-drag to rotate the view; Ctrl+Z undoes.
      </p>
    </aside>
  );
}
