import { z } from "zod";

export const projectDetailsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a project name.")
    .max(100, "Use 100 characters or fewer."),
  description: z.string().trim().max(500, "Use 500 characters or fewer."),
});

export const componentKinds = [
  "car_lane",
  "bike_lane",
  "streetcar_lane",
  "road",
  "sidewalk",
  "intersection",
  "crosswalk",
  "building",
  "green_area",
  "bench",
  "traffic_light",
  "stop_sign",
  "yield_sign",
  "speed_sign",
  "speed_hump",
  "no_left_turn",
  "no_right_turn",
  "no_u_turn",
  "no_straight_on",
  "transit_shelter",
  "streetlight",
  "streetcar",
  "removed_osm",
] as const;
const point = z.tuple([z.number().finite(), z.number().finite()]);
export const sceneComponentSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(componentKinds),
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.number().finite(),
  length: z.number().positive().optional(),
  width: z.number().positive().optional(),
  laneCount: z.number().int().positive().max(8).optional(),
  height: z.number().nonnegative().optional(),
  speedKmh: z.number().nonnegative().optional(),
  hours: z.string().max(500).optional(),
  colour: z.string().max(100).optional(),
  footprint: z.array(point).max(8192).optional(),
  path: z.array(point).max(8192).optional(),
  osmId: z.union([z.string(), z.number().finite()]).optional(),
  osmAt: point.optional(),
});
export const projectStateSchema = z.object({
  schemaVersion: z.literal(1),
  // The editor currently projects all geometry relative to this fixed origin.
  origin: z.object({ lng: z.literal(-79.4003), lat: z.literal(43.6578) }),
  scene: z.array(sceneComponentSchema).max(4000),
  areas: z
    .array(
      z.object({
        id: z.string(),
        rings: z.array(z.array(point).min(3).max(8192)).max(500),
      }),
    )
    .max(500),
  measurements: z
    .array(z.object({ id: z.string(), a: z.string(), b: z.string() }))
    .max(4000),
  camera: z.object({
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-85).max(85),
    zoom: z.number().min(13).max(20),
    pitch: z.number().min(0).max(80),
    bearing: z.number().finite(),
  }),
});
export type ProjectState = z.infer<typeof projectStateSchema>;
export function emptyProjectState(): ProjectState {
  return {
    schemaVersion: 1,
    origin: { lng: -79.4003, lat: 43.6578 },
    scene: [],
    areas: [],
    measurements: [],
    camera: {
      lng: -79.4003,
      lat: 43.6578,
      zoom: 17,
      pitch: 58,
      bearing: -41.7,
    },
  };
}
