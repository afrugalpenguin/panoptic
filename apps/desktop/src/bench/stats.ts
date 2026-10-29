export interface FrameStats {
  frames: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  /** Frames at least half a 60 Hz frame late (over 25 ms); vsync jitter around 16.7 ms is not counted. */
  over25: number;
  /** Frames longer than two 60 Hz frames, i.e. visibly dropped. */
  over33: number;
}

export function summarise(deltas: number[]): FrameStats {
  if (deltas.length === 0) return { frames: 0, p50: 0, p95: 0, p99: 0, max: 0, over25: 0, over33: 0 };
  const sorted = [...deltas].sort((a, b) => a - b);
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    frames: sorted.length,
    p50: round(pct(50)),
    p95: round(pct(95)),
    p99: round(pct(99)),
    max: round(sorted[sorted.length - 1]),
    over25: sorted.filter((d) => d > 25).length,
    over33: sorted.filter((d) => d > 2000 / 60).length,
  };
}
