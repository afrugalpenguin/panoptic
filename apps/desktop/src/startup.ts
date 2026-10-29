import { invoke } from "@tauri-apps/api/core";

export type BenchMode = "startup" | "ui" | null;

export interface StartupInfo {
  /** Wall-clock time Rust main() started, epoch ms. */
  mainStartEpochMs: number;
  benchMode: BenchMode;
}

export const getStartupInfo = () => invoke<StartupInfo>("startup_info");

/** Epoch ms of the webview's first contentful paint, once it has happened. */
export function firstPaintEpochMs(): Promise<number> {
  return new Promise((resolve) => {
    const observer = new PerformanceObserver((list) => {
      const fcp = list.getEntries().find((e) => e.name === "first-contentful-paint");
      if (fcp) {
        observer.disconnect();
        resolve(performance.timeOrigin + fcp.startTime);
      }
    });
    observer.observe({ type: "paint", buffered: true });
  });
}

export const nowEpochMs = () => performance.timeOrigin + performance.now();

/** Bench mode only: hands results to the shell, which writes them to PANOPTIC_BENCH_OUT and exits. */
export const finishBenchmark = (results: unknown) => invoke("bench_finish", { results: JSON.stringify(results) });
