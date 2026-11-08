import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { RpcClient } from "./rpc";

export type PingResult = {
  startupMs: number;
  version: string;
  mode: string;
  pid: number;
  /** Set when store.bin could not be read at start-up: where it was moved aside. The store started empty. */
  storeRecoveredFrom?: string;
  /** Set with storeRecoveredFrom when the store was restored from its backup (the previous save) rather than started empty. */
  storeRestoredFromBackup?: boolean;
};

/** Status bar text once the sidecar answers ping. */
export function readyText(ping: PingResult): string {
  if (!ping.storeRecoveredFrom) return "Ready";
  const name = ping.storeRecoveredFrom.split(/[\\/]/).pop();
  if (ping.storeRestoredFromBackup) return `Ready, but saved connections and settings could not be read and were restored from the previous save (old file kept as ${name})`;
  return `Ready, but saved connections and settings could not be read and were reset (old file kept as ${name})`;
}

/** Mirrors SidecarStatus in src-tauri/src/lib.rs. The shell supervises and restarts the sidecar. */
export type SidecarStatus =
  | { state: "starting"; attempt: number }
  | { state: "running"; pid: number }
  | { state: "exited"; code: number | null }
  | { state: "failed"; error: string }
  /** Stopped on purpose for an update; restarted only by sidecar_start. */
  | { state: "stopped" };

/** The error pending requests get when the sidecar process exits, fails or is stopped. */
export const ENGINE_STOPPED = "database engine stopped";

/**
 * Connects the RPC client to the Tauri-managed sidecar. Status changes are reported as they happen,
 * starting with the current one (the sidecar may already be up by the time the UI subscribes).
 */
export async function connectSidecar(
  onStatus: (status: SidecarStatus) => void,
  onNotification: (method: string, params: unknown) => void = () => {},
  onDropped?: (reason: string) => void,
): Promise<RpcClient> {
  const client = new RpcClient((line) => invoke("sidecar_send", { line }), onNotification, onDropped);
  const handle = (status: SidecarStatus) => {
    if (status.state === "exited" || status.state === "failed" || status.state === "stopped") client.disconnect(ENGINE_STOPPED);
    onStatus(status);
  };
  await listen<string>("sidecar://message", (e) => client.receive(e.payload));
  await listen<SidecarStatus>("sidecar://status", (e) => handle(e.payload));
  const current = await invoke<SidecarStatus | null>("sidecar_status");
  if (current) handle(current);
  return client;
}
