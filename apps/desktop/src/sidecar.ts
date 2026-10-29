import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { RpcClient } from "./rpc";

export type PingResult = { startupMs: number; version: string; mode: string; pid: number };

/** Mirrors SidecarStatus in src-tauri/src/lib.rs. The shell supervises and restarts the sidecar. */
export type SidecarStatus =
  | { state: "starting"; attempt: number }
  | { state: "running"; pid: number }
  | { state: "exited"; code: number | null }
  | { state: "failed"; error: string };

/**
 * Connects the RPC client to the Tauri-managed sidecar. Status changes are reported as they happen,
 * starting with the current one (the sidecar may already be up by the time the UI subscribes).
 */
export async function connectSidecar(
  onStatus: (status: SidecarStatus) => void,
  onNotification: (method: string, params: unknown) => void = () => {},
): Promise<RpcClient> {
  const client = new RpcClient((line) => invoke("sidecar_send", { line }), onNotification);
  const handle = (status: SidecarStatus) => {
    if (status.state === "exited" || status.state === "failed") client.disconnect("sidecar stopped");
    onStatus(status);
  };
  await listen<string>("sidecar://message", (e) => client.receive(e.payload));
  await listen<SidecarStatus>("sidecar://status", (e) => handle(e.payload));
  const current = await invoke<SidecarStatus | null>("sidecar_status");
  if (current) handle(current);
  return client;
}
