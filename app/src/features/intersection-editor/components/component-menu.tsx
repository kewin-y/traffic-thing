"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CIRCLE_BENCH_DIAMETER,
  isResizable,
  THICKNESS,
  TREE_CROWN,
  type SceneComponent,
} from "../lib/components";
import { describe } from "../lib/scene";
import { ToolIcon } from "./tool-icon";

const SPEEDS = [30, 40, 50, 60];

export function ComponentMenu({
  component,
  x,
  y,
  bounds,
  onUpdate,
  onDelete,
  onClose,
}: {
  component: SceneComponent;
  x: number;
  y: number;
  bounds: { width: number; height: number };
  onUpdate: (patch: Partial<SceneComponent>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const width = 236;
  const left = Math.max(8, Math.min(x + 8, bounds.width - width - 8));
  const top = Math.max(8, Math.min(y + 8, bounds.height - 260));
  const rotatable = component.kind !== "intersection";
  const thickness = THICKNESS[component.kind];

  return (
    <div
      role="dialog"
      aria-label={`${describe(component)} properties`}
      style={{ left, top, width }}
      className="absolute z-30 max-h-[calc(100%-1rem)] overflow-y-auto rounded-lg border bg-popover p-1.5 text-sm text-popover-foreground shadow-xl"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex items-center gap-2 px-1.5 pt-0.5 pb-1.5">
        <ToolIcon kind={component.kind} className="size-6 shrink-0" />
        <span className="flex-1 text-xs leading-tight font-medium">
          {describe(component)}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="Close properties"
          onClick={onClose}
        >
          ×
        </Button>
      </div>

      {component.kind === "speed_sign" && (
        <div className="flex gap-1 px-1.5 pb-1.5">
          {SPEEDS.map((speed) => (
            <Button
              key={speed}
              size="xs"
              variant={
                (component.speedKmh ?? 40) === speed ? "default" : "outline"
              }
              onClick={() => onUpdate({ speedKmh: speed })}
            >
              {speed}
            </Button>
          ))}
        </div>
      )}

      {thickness && (
        <Thickness
          // Remount when another component or an undo changes the width.
          key={`${component.id}:${component.width}`}
          value={component.width ?? (component.path ? 7 : thickness.min)}
          {...thickness}
          onChange={(width) => onUpdate({ width })}
        />
      )}

      {isResizable(component) && (
        <div className="grid grid-cols-2 gap-1.5 px-1.5 pb-1.5">
          <Dimension
            label="Length"
            value={component.length!}
            min={1}
            onChange={(length) => onUpdate({ length })}
          />
          {!thickness && (
            <Dimension
              label="Width"
              value={component.width!}
              min={0.3}
              onChange={(width) => onUpdate({ width })}
            />
          )}
        </div>
      )}

      {component.path && !thickness && (
        <Stepper
          label="Width"
          value={component.width ?? 7}
          unit="m"
          step={0.5}
          min={2}
          max={40}
          onChange={(width) => onUpdate({ width })}
        />
      )}

      {component.kind === "tree" && (
        <Stepper
          label="Crown"
          value={component.width ?? TREE_CROWN}
          unit="m"
          step={1}
          min={2}
          max={16}
          onChange={(width) => onUpdate({ width })}
        />
      )}

      {component.kind === "circle_bench" && (
        <Stepper
          label="Diameter"
          value={component.width ?? CIRCLE_BENCH_DIAMETER}
          unit="m"
          step={0.4}
          min={3}
          max={8}
          onChange={(width) => onUpdate({ width: Math.round(width * 10) / 10 })}
        />
      )}

      {component.kind === "building" && (
        <Stepper
          label="Height"
          value={component.height ?? 12}
          unit="m"
          step={3}
          min={3}
          max={300}
          onChange={(height) => onUpdate({ height })}
        />
      )}

      {rotatable && (
        <div className="flex gap-1 px-1.5 pb-1">
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              onUpdate({ rotation: (component.rotation + 15) % 360 })
            }
          >
            Rotate 15°
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              onUpdate({ rotation: (component.rotation + 90) % 360 })
            }
          >
            Rotate 90°
          </Button>
        </div>
      )}
      <button
        type="button"
        onClick={onDelete}
        className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/10"
      >
        Delete component
      </button>
    </div>
  );
}

/**
 * Width across a lane, road, sidewalk or crosswalk. The slider previews the
 * value while dragging and commits once, so one drag is one undo step.
 */
function Thickness({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const round = (v: number) =>
    Math.round(Math.min(max, Math.max(min, v)) * 100) / 100;
  const commit = (v: number) => {
    const next = round(v);
    setDraft(next);
    if (next !== value) onChange(next);
  };
  return (
    <div className="px-1.5 pb-2">
      <div className="mb-1 flex items-center justify-between text-xs">
        <label htmlFor="component-thickness" className="text-muted-foreground">
          Thickness
        </label>
        <div className="flex items-center gap-1">
          <Button
            size="icon-xs"
            variant="outline"
            aria-label="Make thinner"
            disabled={draft <= min}
            onClick={() => commit(draft - step)}
          >
            −
          </Button>
          <input
            type="number"
            aria-label="Thickness in metres"
            step={step}
            min={min}
            max={max}
            value={draft}
            className="h-6 w-14 rounded-md border bg-background px-1 text-center text-xs tabular-nums"
            onChange={(event) => setDraft(Number(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            onBlur={() =>
              Number.isFinite(draft) ? commit(draft) : setDraft(value)
            }
          />
          <span className="text-muted-foreground">m</span>
          <Button
            size="icon-xs"
            variant="outline"
            aria-label="Make thicker"
            disabled={draft >= max}
            onClick={() => commit(draft + step)}
          >
            +
          </Button>
        </div>
      </div>
      <input
        id="component-thickness"
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        className="w-full cursor-pointer accent-primary"
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={() => commit(draft)}
        onKeyUp={() => commit(draft)}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{min} m</span>
        <span>{max} m</span>
      </div>
    </div>
  );
}

function Dimension({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
      {label} (m)
      <input
        type="number"
        step={0.1}
        min={min}
        defaultValue={value}
        key={value}
        className="h-7 rounded-md border bg-background px-1.5 text-xs text-foreground tabular-nums"
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        onBlur={(event) => {
          const next = Math.round(Number(event.target.value) * 10) / 10;
          if (Number.isFinite(next) && next >= min && next !== value)
            onChange(next);
        }}
      />
    </label>
  );
}

function Stepper({
  label,
  value,
  unit,
  step,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  step: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between px-1.5 pb-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <Button
          size="icon-xs"
          variant="outline"
          aria-label={`Decrease ${label.toLowerCase()}`}
          onClick={() => onChange(Math.max(min, value - step))}
        >
          −
        </Button>
        <span className="w-12 text-center tabular-nums">
          {value} {unit}
        </span>
        <Button
          size="icon-xs"
          variant="outline"
          aria-label={`Increase ${label.toLowerCase()}`}
          onClick={() => onChange(Math.min(max, value + step))}
        >
          +
        </Button>
      </div>
    </div>
  );
}
