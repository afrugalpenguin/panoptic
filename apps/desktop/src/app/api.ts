import type { RpcClient } from "../rpc";

// Mirrors the sidecar's records in apps/sidecar/Panoptic.Sidecar/Model.cs.
// TODO(M1 follow-up): generate these from the C# records so the two sides cannot drift.

export interface TreeNode {
  id: string;
  kind: string;
  label: string;
  icon: string;
  hasChildren: boolean;
  actions: string[];
  meta?: Record<string, string>;
}

export type ConnectionKind = "sql" | "synapse" | "cosmos";
export type AuthKind = "entra" | "sql" | "key";

export interface ConnectionConfig {
  id: string;
  name: string;
  kind: ConnectionKind;
  endpoint: string;
  auth: AuthKind;
  user?: string | null;
  database?: string | null;
  tenantId?: string | null;
  trustServerCertificate: boolean;
}

export interface EnvironmentConfig {
  id: string;
  name: string;
  color: string;
  readOnly: boolean;
  connections: ConnectionConfig[];
}

export interface AppConfig {
  environments: EnvironmentConfig[];
}

export interface TestConnectionResult {
  ok: boolean;
  elapsedMs: number;
  error?: string;
}

export interface DeviceCodePrompt {
  message: string;
  userCode: string;
  verificationUri: string;
}

export function createApi(rpc: RpcClient) {
  return {
    config: () => rpc.request<AppConfig>("config.get"),
    saveEnvironment: (env: EnvironmentConfig) => rpc.request<AppConfig>("config.saveEnvironment", env),
    deleteEnvironment: (id: string) => rpc.request<AppConfig>("config.deleteEnvironment", { id }),
    /** secret: undefined keeps the stored one, "" clears it. */
    saveConnection: (environmentId: string, connection: ConnectionConfig, secret?: string) =>
      rpc.request<AppConfig>("config.saveConnection", { environmentId, connection, secret: secret ?? null }),
    deleteConnection: (id: string) => rpc.request<AppConfig>("config.deleteConnection", { id }),
    testConnection: (connection: ConnectionConfig, secret?: string) =>
      // Sign-in can include an interactive Entra prompt, so allow longer than a normal call.
      rpc.request<TestConnectionResult>("connection.test", { connection, secret: secret ?? null }, 180_000),
    children: (nodeId: string) => rpc.request<TreeNode[]>("tree.children", { nodeId }, 180_000),
  };
}

export type Api = ReturnType<typeof createApi>;
