import { invoke } from "@tauri-apps/api/core";
import type { PingResult } from "./sidecar";

export type BenchMode = "startup" | "ui" | "expand" | null;

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

/** Resolves once the browser has painted what the last work changed (two animation frames). */
export async function afterPaint(): Promise<void> {
  for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
}

/** Bench mode only: hands results to the shell, which writes them to PANOPTIC_BENCH_OUT and exits. */
export const finishBenchmark = (results: unknown) => invoke("bench_finish", { results: JSON.stringify(results) });

/** Start-up timings: the status bar's line, and what the startup bench records (scripts/bench.ps1). */
export interface StartupTimings {
  kind: "startup";
  mainStartEpochMs: number;
  firstPaintEpochMs: number;
  sidecarReadyEpochMs: number;
  mainToFirstPaintMs: number;
  mainToSidecarReadyMs: number;
  /** Startup bench only: when the tree had painted its environments and connections. */
  treeRenderedEpochMs: number | undefined;
  sidecarStartupMs: number;
  sidecarMode: string;
}

export function startupTimings(
  info: StartupInfo,
  ping: PingResult,
  at: { sidecarReadyEpochMs: number; firstPaintEpochMs: number; treeRenderedEpochMs?: number },
): StartupTimings {
  return {
    kind: "startup",
    mainStartEpochMs: info.mainStartEpochMs,
    firstPaintEpochMs: at.firstPaintEpochMs,
    sidecarReadyEpochMs: at.sidecarReadyEpochMs,
    mainToFirstPaintMs: Math.round(at.firstPaintEpochMs - info.mainStartEpochMs),
    mainToSidecarReadyMs: Math.round(at.sidecarReadyEpochMs - info.mainStartEpochMs),
    treeRenderedEpochMs: at.treeRenderedEpochMs,
    sidecarStartupMs: ping.startupMs,
    sidecarMode: ping.mode,
  };
}

/** The status bar's start-up line. */
export function startupText(t: StartupTimings, ping: PingResult): string {
  return `First paint ${t.mainToFirstPaintMs} ms, engine ready ${t.mainToSidecarReadyMs} ms (engine ${ping.startupMs} ms, ${ping.mode}, v${ping.version})`;
}
