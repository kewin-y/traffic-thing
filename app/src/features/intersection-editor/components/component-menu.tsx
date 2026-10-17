"use client";

import { Button } from "@/components/ui/button";
import { isResizable, type SceneComponent } from "../lib/components";
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
}: {
  component: SceneComponent;
  x: number;
  y: number;
  bounds: { width: number; height: number };
  onUpdate: (patch: Partial<SceneComponent>) => void;
  onDelete: () => void;
}) {
  const width = 236;
  const left = Math.max(8, Math.min(x + 8, bounds.width - width - 8));
  const top = Math.max(8, Math.min(y + 8, bounds.height - 260));
  const rotatable = component.kind !== "intersection";

  return (
    <div
      role="menu"
      aria-label={describe(component)}
      style={{ left, top, width }}
      className="absolute z-30 rounded-lg border bg-popover p-1.5 text-sm text-popover-foreground shadow-xl"
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="flex items-center gap-2 px-1.5 pt-0.5 pb-1.5">
        <ToolIcon kind={component.kind} className="size-6 shrink-0" />
        <span className="text-xs leading-tight font-medium">
          {describe(component)}
        </span>
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

      {isResizable(component) && (
        <div className="grid grid-cols-2 gap-1.5 px-1.5 pb-1.5">
          <Dimension
            label="Length"
            value={component.length!}
            min={1}
            onChange={(length) => onUpdate({ length })}
          />
          <Dimension
            label="Width"
            value={component.width!}
            min={0.3}
            onChange={(width) => onUpdate({ width })}
          />
        </div>
      )}

      {component.path && (
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
        role="menuitem"
        onClick={onDelete}
        className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-xs text-destructive transition-colors hover:bg-destructive/10"
      >
        Delete component
      </button>
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
