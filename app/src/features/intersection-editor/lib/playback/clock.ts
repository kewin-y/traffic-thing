/** Simulation time for playback, advanced by wall time while playing. */
export class PlaybackClock {
  private time = 0;
  private startedAt: number | null = null;
  private listeners = new Set<() => void>();
  rate = 1;

  constructor(
    public duration: number,
    private readonly now = () => performance.now(),
  ) {}

  get playing() {
    return this.startedAt !== null;
  }

  /** Current simulation time in seconds; stops at the end of the run. */
  current() {
    if (this.startedAt === null) return this.time;
    const t = this.time + ((this.now() - this.startedAt) / 1000) * this.rate;
    if (t >= this.duration) {
      this.time = this.duration;
      this.startedAt = null;
      this.notify();
    }
    return Math.min(t, this.duration);
  }

  play() {
    if (this.playing) return;
    if (this.time >= this.duration) this.time = 0;
    this.startedAt = this.now();
    this.notify();
  }

  pause() {
    this.time = this.current();
    this.startedAt = null;
    this.notify();
  }

  seek(t: number) {
    this.time = Math.max(0, Math.min(this.duration, t));
    if (this.startedAt !== null) this.startedAt = this.now();
    this.notify();
  }

  setRate(rate: number) {
    this.time = this.current();
    if (this.startedAt !== null) this.startedAt = this.now();
    this.rate = rate;
    this.notify();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify() {
    for (const listener of this.listeners) listener();
  }
}
