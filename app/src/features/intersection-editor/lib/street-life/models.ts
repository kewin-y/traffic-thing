// Low-poly figures built from boxes. Each box is one GPU instance of a unit
// cube; the agent frame has x forward, y to the left and z up, in metres.

/** Simulated agents, plus people who stay put in parks, on benches and at stops. */
export type FigureKind =
  | "car"
  | "pedestrian"
  | "bicycle"
  | "scooter"
  | "standing"
  | "seated"
  | "lounging";

type Role = "shirt" | "pants" | "skin" | "frame" | "helmet" | "paint";

export interface ModelPart {
  offset: [number, number, number];
  size: [number, number, number];
  colour: Role | string;
  /** Gait swing amplitude along x and z, scaled by sin(phase). */
  swing?: [number, number];
}

const PALETTES: Record<Role, string[]> = {
  shirt: [
    "#e4572e",
    "#2e86ab",
    "#f3a712",
    "#3b8b5a",
    "#8e5ea2",
    "#f2f2f2",
    "#30343f",
    "#c44569",
    "#4f6d7a",
    "#d9bf77",
  ],
  pants: ["#2b2d42", "#3d405b", "#5c4d3c", "#1f3b57", "#6b705c", "#222222"],
  skin: ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"],
  frame: ["#1f1f1f", "#c0392b", "#2c7be5", "#2a9d8f", "#9aa3a8"],
  helmet: ["#f2f2f2", "#1f1f1f", "#f3a712", "#2e86ab"],
  // Common car colours, weighted toward white, black and grey.
  paint: [
    "#f4f4f2",
    "#f4f4f2",
    "#1c1d21",
    "#1c1d21",
    "#8d939a",
    "#b9bec4",
    "#5b6067",
    "#a8272d",
    "#244a8f",
    "#3d5f4a",
  ],
};
const ROLE_SHIFT: Record<Role, number> = {
  shirt: 0,
  pants: 4,
  skin: 8,
  frame: 12,
  helmet: 16,
  paint: 20,
};

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const rgbCache = new Map<string, [number, number, number]>();

/** The part's colour for an agent with the given random `look` bits. */
export function partColour(part: ModelPart, look: number) {
  const role = part.colour as Role;
  const palette = PALETTES[role];
  const hex = palette
    ? palette[(look >>> ROLE_SHIFT[role]) % palette.length]
    : part.colour;
  let rgb = rgbCache.get(hex);
  if (!rgb) rgbCache.set(hex, (rgb = hexToRgb(hex)));
  return rgb;
}

/** Move a model along its forward axis. */
function shift(parts: ModelPart[], dx: number): ModelPart[] {
  return parts.map((part) => ({
    ...part,
    offset: [part.offset[0] + dx, part.offset[1], part.offset[2]],
  }));
}

const person = (lift: number, legSwing: number): ModelPart[] => [
  {
    offset: [0, 0.1, lift],
    size: [0.17, 0.14, 0.82],
    colour: "pants",
    swing: [legSwing, 0],
  },
  {
    offset: [0, -0.1, lift],
    size: [0.17, 0.14, 0.82],
    colour: "pants",
    swing: [-legSwing, 0],
  },
  { offset: [0, 0, lift + 0.82], size: [0.26, 0.42, 0.6], colour: "shirt" },
  { offset: [0, 0, lift + 1.45], size: [0.21, 0.2, 0.24], colour: "skin" },
];

/** Sitting on a seat `seat` metres high, facing +x. */
const seated = (seat: number): ModelPart[] => [
  {
    offset: [0.2, 0.1, seat - 0.14],
    size: [0.44, 0.15, 0.14],
    colour: "pants",
  },
  {
    offset: [0.2, -0.1, seat - 0.14],
    size: [0.44, 0.15, 0.14],
    colour: "pants",
  },
  { offset: [0.4, 0.1, 0], size: [0.13, 0.13, seat - 0.14], colour: "pants" },
  { offset: [0.4, -0.1, 0], size: [0.13, 0.13, seat - 0.14], colour: "pants" },
  { offset: [-0.02, 0, seat], size: [0.26, 0.42, 0.6], colour: "shirt" },
  { offset: [-0.02, 0, seat + 0.63], size: [0.21, 0.2, 0.24], colour: "skin" },
];

const TTC_DARK = "#1d2733";

export const MODELS: Record<FigureKind, ModelPart[]> = {
  pedestrian: person(0, 0.22),
  standing: person(0, 0),
  seated: seated(0.5),
  // Sitting on the grass with legs stretched out.
  lounging: [
    { offset: [0.42, 0.1, 0], size: [0.78, 0.15, 0.14], colour: "pants" },
    { offset: [0.42, -0.1, 0], size: [0.78, 0.15, 0.14], colour: "pants" },
    { offset: [-0.02, 0, 0], size: [0.26, 0.42, 0.6], colour: "shirt" },
    { offset: [-0.02, 0, 0.63], size: [0.21, 0.2, 0.24], colour: "skin" },
  ],
  // SUMO positions vehicles at their front bumper, so models sit behind it.
  car: shift(
    [
      { offset: [0, 0, 0.18], size: [4.5, 1.8, 0.78], colour: "paint" },
      { offset: [-0.25, 0, 0.96], size: [2.4, 1.62, 0.56], colour: "paint" },
      { offset: [-0.25, 0, 1.0], size: [2.46, 1.66, 0.38], colour: TTC_DARK },
      { offset: [1.4, 0, 0], size: [0.66, 1.86, 0.62], colour: "#141414" },
      { offset: [-1.4, 0, 0], size: [0.66, 1.86, 0.62], colour: "#141414" },
      {
        offset: [2.26, 0.62, 0.62],
        size: [0.04, 0.3, 0.14],
        colour: "#fff6c8",
      },
      {
        offset: [2.26, -0.62, 0.62],
        size: [0.04, 0.3, 0.14],
        colour: "#fff6c8",
      },
      {
        offset: [-2.26, 0.62, 0.66],
        size: [0.04, 0.3, 0.12],
        colour: "#c0161d",
      },
      {
        offset: [-2.26, -0.62, 0.66],
        size: [0.04, 0.3, 0.12],
        colour: "#c0161d",
      },
    ],
    -2.25,
  ),
  bicycle: shift(
    [
      { offset: [0.55, 0, 0], size: [0.66, 0.05, 0.66], colour: "#1a1a1a" },
      { offset: [-0.55, 0, 0], size: [0.66, 0.05, 0.66], colour: "#1a1a1a" },
      { offset: [0, 0, 0.5], size: [1.05, 0.07, 0.08], colour: "frame" },
      { offset: [0.48, 0, 0.5], size: [0.07, 0.07, 0.5], colour: "frame" },
      { offset: [0.48, 0, 1.0], size: [0.06, 0.52, 0.05], colour: "#1a1a1a" },
      {
        offset: [-0.08, 0.13, 0.3],
        size: [0.14, 0.12, 0.62],
        colour: "pants",
        swing: [0, 0.12],
      },
      {
        offset: [-0.08, -0.13, 0.3],
        size: [0.14, 0.12, 0.62],
        colour: "pants",
        swing: [0, -0.12],
      },
      { offset: [-0.05, 0, 0.92], size: [0.46, 0.38, 0.52], colour: "shirt" },
      { offset: [0.12, 0, 1.44], size: [0.24, 0.23, 0.22], colour: "helmet" },
    ],
    -0.9,
  ),
  scooter: shift(
    [
      { offset: [0, 0, 0.07], size: [0.95, 0.18, 0.07], colour: "#1a1a1a" },
      { offset: [0.42, 0, 0], size: [0.22, 0.06, 0.22], colour: "#1a1a1a" },
      { offset: [-0.42, 0, 0], size: [0.22, 0.06, 0.22], colour: "#1a1a1a" },
      { offset: [0.42, 0, 0.14], size: [0.05, 0.05, 0.98], colour: "frame" },
      { offset: [0.42, 0, 1.1], size: [0.05, 0.48, 0.04], colour: "#1a1a1a" },
      ...shift(person(0.14, 0), -0.05),
    ],
    -0.6,
  ),
};

/**
 * How strongly the zoom-dependent enlargement applies. People and bikes
 * grow most so they stay visible; cars only slightly, so queues still fit
 * their lanes.
 */
export const ENLARGE: Record<FigureKind, number> = {
  car: 0.08,
  pedestrian: 1,
  bicycle: 1,
  scooter: 1,
  standing: 1,
  seated: 1,
  lounging: 1,
};

/** Metres travelled per gait cycle. */
export const STRIDE: Partial<Record<FigureKind, number>> = {
  pedestrian: 1.4,
  bicycle: 2.2,
};
