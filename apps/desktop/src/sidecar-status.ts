import type { SidecarStatus } from "./sidecar";

export type SidecarIndicator = "connecting" | "connected" | "disconnected";

export interface SidecarView {
  indicator: SidecarIndicator;
  text: string;
  /** The sidecar process is gone: every connection is disconnected and cached subtrees are stale. */
  lost: boolean;
}

/**
 * What the status bar shows for a supervisor status (ADR 0005). Any exit, failure or stop marks every
 * connection disconnected, and it stays disconnected through the restart until ping answers again, which
 * the caller reports by setting the indicator to "connected". "running" changes nothing: the sidecar is
 * not usable until it answers ping, so it returns undefined.
 */
export function sidecarView(current: SidecarIndicator, status: SidecarStatus): SidecarView | undefined {
  switch (status.state) {
    case "starting":
      return {
        indicator: current === "disconnected" ? "disconnected" : "connecting",
        text: status.attempt > 1 ? `Restarting sidecar (attempt ${status.attempt})...` : "Starting...",
        lost: false,
      };
    case "running":
      return undefined;
    case "exited":
      return { indicator: "disconnected", text: `Sidecar exited (code ${status.code ?? "unknown"}), connections disconnected`, lost: true };
    case "failed":
      return { indicator: "disconnected", text: "Sidecar stopped", lost: true };
    case "stopped":
      return { indicator: "disconnected", text: "Sidecar stopped for update", lost: true };
  }
}
