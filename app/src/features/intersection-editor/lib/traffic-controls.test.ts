import { readFileSync } from "node:fs";
import { afterEach, expect, test, vi } from "vitest";
import { toLngLat } from "./geometry";
import {
  bearingNear,
  componentFromControl,
  describeControl,
  loadControls,
} from "./traffic-controls";

afterEach(() => vi.unstubAllGlobals());

test("the extracted Toronto data loads in full", async () => {
  const text = readFileSync(
    "public/data/toronto-traffic-controls.geojson",
    "utf8",
  );
  const raw = JSON.parse(text) as { features: unknown[] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(text, { status: 200 })),
  );
  const data = await loadControls(new AbortController().signal);
  expect(data.features).toHaveLength(raw.features.length);
  const kinds = new Set(data.features.map((f) => f.properties.kind));
  for (const kind of [
    "traffic_light",
    "stop_sign",
    "no_left_turn",
    "speed_limit",
  ])
    expect(kinds).toContain(kind);
});

test("a converted sign faces the traffic it governs", () => {
  const [lng, lat] = toLngLat([0, 0]);
  // Traffic heading due east in true terms.
  const sign = componentFromControl(
    { kind: "stop_sign", ref: "node/1", heading: 90 },
    { lng, lat },
  );
  expect(sign.kind).toBe("stop_sign");
  expect(sign.osmId).toBe("node/1");
  // Local +y (the sign face) points back west, against the traffic.
  const r = (sign.rotation * Math.PI) / 180;
  const face = [-Math.sin(r), Math.cos(r)];
  expect(face[0]).toBeLessThan(-0.9);
});

test("a signal pole stands at the right-hand kerb", () => {
  const [lng, lat] = toLngLat([0, 0]);
  const signal = componentFromControl(
    { kind: "traffic_light", ref: "node/2", heading: 0 },
    { lng, lat },
  );
  // Northbound traffic: the kerb is to the east, about 5 m out.
  expect(Math.hypot(signal.x, signal.y)).toBeCloseTo(5, 0);
  expect(signal.x).toBeGreaterThan(4);
});

test("timed turn bans keep their hours and posted limits their speed", () => {
  const [lng, lat] = toLngLat([0, 0]);
  const ban = componentFromControl(
    { kind: "no_left_turn", ref: "relation/3", hours: "Mo-Fr 07:00-10:00" },
    { lng, lat },
  );
  expect(ban.hours).toBe("Mo-Fr 07:00-10:00");
  const limit = componentFromControl(
    { kind: "speed_limit", ref: "way/4", speedKmh: 30 },
    { lng, lat },
    45,
  );
  expect(limit).toMatchObject({ kind: "speed_sign", speedKmh: 30 });
  // A speed limit stays on the road; only the new sign is editable.
  expect(limit.osmId).toBeUndefined();
  expect(
    describeControl({ kind: "stop_sign", ref: "node/5", allWay: true }),
  ).toBe("All-way stop sign");
});

test("the bearing of a road is taken from the segment nearest the click", () => {
  const line = [
    [-79.4, 43.65],
    [-79.4, 43.651], // northward
    [-79.399, 43.651], // then eastward
  ];
  expect(bearingNear(line, { lng: -79.4, lat: 43.6503 })).toBeCloseTo(0, 0);
  expect(bearingNear(line, { lng: -79.3993, lat: 43.651 })).toBeCloseTo(90, 0);
});
