import { isLane, type LaneKind, type SceneComponent } from "./components";
import { ORIGIN } from "./geometry";
import {
  ARM_LENGTH,
  ARMS,
  armAt,
  lanePlacement,
  onIntersectionArm,
  ROAD_HALF_WIDTH,
  type Arm,
} from "./scene";

// Toronto's default where no sign is posted.
const DEFAULT_SPEED_KMH = 40;

export interface Demand {
  /** General traffic entering from each arm, vehicles/hour. */
  carsPerHour: number;
  /** Cyclists entering from each arm, per hour. */
  bikesPerHour: number;
  /** Streetcars per direction on each street, per hour. */
  streetcarsPerHour: number;
  durationMinutes: number;
}

export const DEFAULT_DEMAND: Demand = {
  carsPerHour: 450,
  bikesPerHour: 150,
  streetcarsPerHour: 10,
  durationMinutes: 30,
};

export interface ScenarioLane {
  kind: LaneKind;
  width: number;
}

export interface ScenarioArm {
  /** Ordered right-most (kerb) lane first, matching SUMO lane index 0. */
  inbound: ScenarioLane[];
  outbound: ScenarioLane[];
  speed_kmh: number;
}

export type JunctionControl = "traffic_light" | "allway_stop" | "priority";

export interface Scenario {
  format: "traffic-thing-scenario-v1";
  origin: { lng: number; lat: number };
  arm_length_m: number;
  road_half_width_m: number;
  control: JunctionControl;
  arms: Record<Arm, ScenarioArm>;
  demand: {
    cars_per_hour_per_arm: number;
    bikes_per_hour_per_arm: number;
    streetcars_per_hour_per_direction: number;
    duration_seconds: number;
  };
  /** Full scene, so non-traffic items (trees, benches…) round-trip too. */
  components: SceneComponent[];
}

/** Convert the 3D scene into the network description the SUMO script reads. */
export function buildScenario(
  scene: SceneComponent[],
  demand: Demand,
): Scenario {
  const arms = Object.fromEntries(
    ARMS.map((arm): [Arm, ScenarioArm] => [
      arm,
      { inbound: [], outbound: [], speed_kmh: DEFAULT_SPEED_KMH },
    ]),
  ) as Record<Arm, ScenarioArm>;

  const placed = scene
    .filter((c) => isLane(c.kind) && onIntersectionArm(c.x, c.y))
    .map((c) => ({ c, ...lanePlacement(c) }))
    .sort((a, b) => b.offset - a.offset);
  for (const { c, arm, direction } of placed) {
    arms[arm][direction].push({
      kind: c.kind as LaneKind,
      width: c.width ?? 3.3,
    });
  }

  // A sign governs its own arm; with several, the one nearest the junction wins.
  const signs = scene
    .filter((c) => c.kind === "speed_sign")
    .sort((a, b) => Math.hypot(b.x, b.y) - Math.hypot(a.x, a.y));
  for (const sign of signs) {
    arms[armAt(sign.x, sign.y)].speed_kmh = sign.speedKmh ?? DEFAULT_SPEED_KMH;
  }

  const control: JunctionControl = scene.some((c) => c.kind === "traffic_light")
    ? "traffic_light"
    : scene.some((c) => c.kind === "stop_sign")
      ? "allway_stop"
      : "priority";

  return {
    format: "traffic-thing-scenario-v1",
    origin: ORIGIN,
    arm_length_m: ARM_LENGTH,
    road_half_width_m: ROAD_HALF_WIDTH,
    control,
    arms,
    demand: {
      cars_per_hour_per_arm: demand.carsPerHour,
      bikes_per_hour_per_arm: demand.bikesPerHour,
      streetcars_per_hour_per_direction: demand.streetcarsPerHour,
      duration_seconds: demand.durationMinutes * 60,
    },
    components: scene,
  };
}

/** Plain-language problems a planner should know about before simulating. */
export function scenarioWarnings(scenario: Scenario): string[] {
  const warnings: string[] = [];
  const has = (lanes: ScenarioLane[], kind: LaneKind) =>
    lanes.some((lane) => lane.kind === kind);
  for (const arm of ARMS) {
    const { inbound, outbound } = scenario.arms[arm];
    const name = arm[0].toUpperCase() + arm.slice(1);
    if (!inbound.length && !outbound.length) {
      warnings.push(`${name} arm has no lanes; it is closed to all traffic.`);
      continue;
    }
    if (!has(inbound, "car_lane")) {
      warnings.push(
        `${name} arm has no inbound car lane; car demand from it is dropped.`,
      );
    }
    if (!has(outbound, "car_lane")) {
      warnings.push(
        `${name} arm has no outbound car lane; cars cannot turn into it.`,
      );
    }
    if (!has(inbound, "bike_lane") && !has(outbound, "bike_lane")) {
      warnings.push(
        `${name} arm has no bike lanes; cyclists share the car lanes.`,
      );
    }
    if (has(inbound, "streetcar_lane") !== has(outbound, "streetcar_lane")) {
      warnings.push(
        `${name} arm has track in one direction only; streetcars there are dropped.`,
      );
    }
  }
  if (scenario.control === "priority") {
    warnings.push(
      "No signals or stop signs: the junction runs as uncontrolled priority.",
    );
  }
  return warnings;
}
