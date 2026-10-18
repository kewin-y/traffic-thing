import { z } from "zod";
import { componentKinds } from "./projects";

const coordinate = z.number().finite().min(-10_000).max(10_000);
const point = z.tuple([coordinate, coordinate]);
export const chatOpSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("select_area"),
    rings: z.array(z.array(point).min(3).max(200)).min(1).max(10),
  }),
  z.object({
    type: z.literal("place_component"),
    id: z.string().min(1).max(200),
    kind: z.enum(componentKinds).exclude(["removed_osm"]),
    x: coordinate,
    y: coordinate,
    rotation: z.number().finite().min(-360).max(360),
  }),
  z.object({
    type: z.literal("delete_component"),
    id: z.string().min(1).max(200),
  }),
]);
export type ChatOp = z.infer<typeof chatOpSchema>;
