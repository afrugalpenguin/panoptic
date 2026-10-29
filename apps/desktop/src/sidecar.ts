import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { RpcClient } from "./rpc";

export type PingResult = { startupMs: number; version: string; mode: string; pid: number };

/** Connects the RPC client to the Tauri-managed sidecar. */
export async function connectSidecar(
  onExit: (code: number | null) => void,
  onNotification: (method: string, params: unknown) => void = () => {},
): Promise<RpcClient> {
  const client = new RpcClient((line) => invoke("sidecar_send", { line }), onNotification);
  await listen<string>("sidecar://message", (e) => client.receive(e.payload));
  await listen<number | null>("sidecar://exit", (e) => {
    client.disconnect("sidecar exited");
    onExit(e.payload);
  });
  return client;
}
