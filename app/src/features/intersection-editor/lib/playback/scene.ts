import { CROWD_CELL, crowdLevel, type Resting } from "../street-life/ambient";
import type { EmitFigure, FigureSource } from "../street-life/layer";
import { STRIDE } from "../street-life/models";
import type { PlaybackClock } from "./clock";
import { agentsAt, type SimKind, type Timeline } from "./timeline";

export interface PlaybackStats {
  car: number;
  pedestrian: number;
  bicycle: number;
  scooter: number;
  resting: number;
  /** Mean speed of the cars shown, m/s; null with no cars. */
  carSpeed: number | null;
}

function look(id: number) {
  return Math.imul(id + 1, 2654435761) >>> 2;
}

/**
 * What playback draws each frame: every simulated agent at the clock's time,
 * across the whole network, and as many people at rest as the simulated
 * crowd around each spot supports.
 */
export class PlaybackScene {
  timeline: Timeline | null = null;
  clock: PlaybackClock | null = null;
  resting: Resting[] = [];
  stats: PlaybackStats = this.emptyStats();

  /** Show `timeline` at the time `clock` keeps, or nothing. */
  play(timeline: Timeline | null, clock: PlaybackClock | null) {
    this.timeline = timeline;
    this.clock = clock;
  }

  setResting(resting: Resting[]) {
    this.resting = resting;
  }

  private emptyStats(): PlaybackStats {
    return {
      car: 0,
      pedestrian: 0,
      bicycle: 0,
      scooter: 0,
      resting: 0,
      carSpeed: null,
    };
  }

  private crowd = new Map<string, number>();

  /** Figures for one frame; also refreshes `stats`. */
  source: FigureSource = (emit: EmitFigure) => {
    const stats = this.emptyStats();
    const crowd = this.crowd;
    crowd.clear();
    const { timeline, clock } = this;
    if (timeline && clock) {
      const t = clock.current();
      let speedSum = 0;
      agentsAt(timeline, t, (id, kind: SimKind, x, y, heading, speed) => {
        stats[kind]++;
        if (kind === "car") speedSum += speed;
        else if (kind === "pedestrian") {
          const cell = `${Math.floor(x / CROWD_CELL)},${Math.floor(y / CROWD_CELL)}`;
          crowd.set(cell, (crowd.get(cell) ?? 0) + 1);
        }
        const stride = STRIDE[kind];
        // Gait follows distance covered, so a waiting pedestrian stands still.
        const phase = stride ? ((t * speed) / stride) * Math.PI * 2 + id : 0;
        emit(kind, x, y, heading, look(id), phase);
      });
      stats.carSpeed = stats.car ? speedSum / stats.car : null;
      // Benches, parks and stops fill with the simulated crowd around them.
      for (const r of this.resting) {
        if (r.share >= crowdLevel(crowd, r.x, r.y)) continue;
        emit(r.kind, r.x, r.y, r.heading, r.look);
        stats.resting++;
      }
    }
    this.stats = stats;
  };
}
