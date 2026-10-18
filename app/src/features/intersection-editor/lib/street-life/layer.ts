import type {
  CustomLayerInterface,
  CustomRenderMethodInput,
  Map as MapLibreMap,
} from "maplibre-gl";
import type { Frame } from "./frame";
import { ENLARGE, MODELS, partColour, type FigureKind } from "./models";

export const STREET_LIFE_LAYER = "street-life";
/** Below this zoom people would be specks; nothing is drawn. */
const MIN_ZOOM = 14;
/** Always draw people and bikes at least this much larger than life. */
const BASE_ENLARGE = 1.35;
/** ...and at least this many pixels across. */
const MIN_PIXELS = 4.5;

export type EmitFigure = (
  kind: FigureKind,
  x: number,
  y: number,
  heading: number,
  look: number,
  phase?: number,
) => void;

/** Called every frame to list the figures to draw, in frame metres. */
export type FigureSource = (emit: EmitFigure) => void;

const VERTEX = `#version 300 es
uniform mat4 u_matrix;
uniform vec2 u_enlarge; // footprint, height
uniform vec3 u_light;
layout(location = 0) in vec3 a_corner;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec3 a_offset;
layout(location = 3) in vec3 a_size;
layout(location = 4) in vec3 a_colour;
layout(location = 5) in vec3 a_extra; // swing x, swing z, enlargement weight
layout(location = 6) in vec3 a_place; // x, y, heading
layout(location = 7) in float a_phase;
out vec3 v_colour;
void main() {
  float gait = sin(a_phase);
  vec3 p = a_corner * a_size + a_offset + vec3(a_extra.x * gait, 0.0, a_extra.y * gait);
  p *= mix(vec2(1.0), u_enlarge, a_extra.z).xxy;
  float c = cos(a_place.z);
  float s = sin(a_place.z);
  vec3 world = vec3(a_place.x + p.x * c - p.y * s, a_place.y + p.x * s + p.y * c, p.z);
  vec3 n = vec3(a_normal.x * c - a_normal.y * s, a_normal.x * s + a_normal.y * c, a_normal.z);
  v_colour = a_colour * (0.58 + 0.42 * max(dot(n, u_light), 0.0));
  gl_Position = u_matrix * vec4(world, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
in vec3 v_colour;
out vec4 colour;
void main() {
  colour = vec4(v_colour, 1.0);
}`;

/** Unit cube spanning x, y in [-0.5, 0.5] and z in [0, 1], with normals. */
function cube() {
  const faces: [number[], number[][]][] = [
    [
      [1, 0, 0],
      [
        [0.5, -0.5, 0],
        [0.5, 0.5, 0],
        [0.5, 0.5, 1],
        [0.5, -0.5, 1],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [-0.5, 0.5, 0],
        [-0.5, -0.5, 0],
        [-0.5, -0.5, 1],
        [-0.5, 0.5, 1],
      ],
    ],
    [
      [0, 1, 0],
      [
        [0.5, 0.5, 0],
        [-0.5, 0.5, 0],
        [-0.5, 0.5, 1],
        [0.5, 0.5, 1],
      ],
    ],
    [
      [0, -1, 0],
      [
        [-0.5, -0.5, 0],
        [0.5, -0.5, 0],
        [0.5, -0.5, 1],
        [-0.5, -0.5, 1],
      ],
    ],
    [
      [0, 0, 1],
      [
        [-0.5, -0.5, 1],
        [0.5, -0.5, 1],
        [0.5, 0.5, 1],
        [-0.5, 0.5, 1],
      ],
    ],
  ];
  const data: number[] = [];
  for (const [normal, [a, b, c, d]] of faces)
    for (const corner of [a, b, c, a, c, d]) data.push(...corner, ...normal);
  return new Float32Array(data);
}

/** Floats per box instance: offset, size, colour, extra, place, phase. */
const INSTANCE = 16;

/**
 * Pedestrians, cyclists, scooter riders, cars and people at rest, drawn as
 * instanced boxes in MapLibre's 3D pass so buildings hide them. The source
 * lists figures each frame; their boxes are packed into one buffer.
 */
export class StreetLifeLayer implements CustomLayerInterface {
  readonly id = STREET_LIFE_LAYER;
  readonly type = "custom";
  readonly renderingMode = "3d";
  private map: MapLibreMap | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private buffers: WebGLBuffer[] = [];
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private data = new Float32Array(INSTANCE * 4096);
  private count = 0;
  private readonly matrix = new Float32Array(16);

  constructor(
    private readonly frame: Frame,
    private readonly source: FigureSource,
    /** Keep repainting every frame, e.g. while playback runs. */
    private readonly animating: () => boolean,
  ) {}

  onAdd(map: MapLibreMap, gl: WebGL2RenderingContext) {
    this.map = map;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) ?? "Shader failed");
      return shader;
    };
    const program = gl.createProgram();
    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? "Program failed");
    this.program = program;
    for (const name of ["u_matrix", "u_enlarge", "u_light"])
      this.uniforms[name] = gl.getUniformLocation(program, name);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const mesh = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh);
    gl.bufferData(gl.ARRAY_BUFFER, cube(), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const instances = gl.createBuffer();
    this.buffers = [mesh, instances];
    gl.bindBuffer(gl.ARRAY_BUFFER, instances);
    for (let i = 0; i < 5; i++) {
      gl.enableVertexAttribArray(2 + i);
      gl.vertexAttribPointer(2 + i, 3, gl.FLOAT, false, INSTANCE * 4, i * 12);
      gl.vertexAttribDivisor(2 + i, 1);
    }
    gl.enableVertexAttribArray(7);
    gl.vertexAttribPointer(7, 1, gl.FLOAT, false, INSTANCE * 4, 60);
    gl.vertexAttribDivisor(7, 1);
    gl.bindVertexArray(null);
  }

  onRemove(_map: MapLibreMap, gl: WebGL2RenderingContext) {
    for (const buffer of this.buffers) gl.deleteBuffer(buffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.program) gl.deleteProgram(this.program);
    this.map = this.program = this.vao = null;
    this.buffers = [];
  }

  private emit: EmitFigure = (kind, x, y, heading, look, phase = 0) => {
    const parts = MODELS[kind];
    const needed = (this.count + parts.length) * INSTANCE;
    if (needed > this.data.length) {
      const grown = new Float32Array(Math.max(needed, this.data.length * 2));
      grown.set(this.data);
      this.data = grown;
    }
    const data = this.data;
    const enlarge = ENLARGE[kind];
    for (const part of parts) {
      const at = this.count++ * INSTANCE;
      data.set(part.offset, at);
      data.set(part.size, at + 3);
      data.set(partColour(part, look), at + 6);
      data[at + 9] = part.swing?.[0] ?? 0;
      data[at + 10] = part.swing?.[1] ?? 0;
      data[at + 11] = enlarge;
      data[at + 12] = x;
      data[at + 13] = y;
      data[at + 14] = heading;
      data[at + 15] = phase;
    }
  };

  render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
    const map = this.map;
    if (!map || !this.program) return;
    if (this.animating()) map.triggerRepaint();
    if (map.getZoom() < MIN_ZOOM) return;
    this.count = 0;
    this.source(this.emit);
    if (!this.count) return;

    // Frame metres (x east, y north) -> mercator, composed in float64 so the
    // large world-scale terms cancel before the matrix is narrowed to float32.
    const a = args.defaultProjectionData.mainMatrix;
    const { originX, originY, metre } = this.frame;
    for (let r = 0; r < 4; r++) {
      this.matrix[r] = a[r] * metre;
      this.matrix[4 + r] = -a[4 + r] * metre;
      this.matrix[8 + r] = a[8 + r] * metre;
      this.matrix[12 + r] = a[r] * originX + a[4 + r] * originY + a[12 + r];
    }
    const metresPerPixel =
      (40_075_016.686 * Math.cos((map.getCenter().lat * Math.PI) / 180)) /
      (512 * 2 ** map.getZoom());
    // Grow height less than footprint so figures read as dots from afar
    // and keep their proportions up close.
    const footprint = Math.min(
      12,
      Math.max(BASE_ENLARGE, (MIN_PIXELS * metresPerPixel) / 0.42),
    );

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.u_matrix, false, this.matrix);
    gl.uniform2f(
      this.uniforms.u_enlarge,
      footprint,
      Math.max(BASE_ENLARGE, Math.sqrt(footprint)),
    );
    gl.uniform3f(this.uniforms.u_light, 0.36, -0.48, 0.8);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[1]);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      this.data.subarray(0, this.count * INSTANCE),
      gl.STREAM_DRAW,
    );
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, this.count);
    gl.bindVertexArray(null);
  }
}
