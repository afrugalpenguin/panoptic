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

/** Mirrors NodeError: why a node's children failed to load (docs/explorer-errors.md). */
export interface NodeError {
  /** One short sentence with no identifiers, for the tree row. */
  summary: string;
  /** The full original message plus status, ids, endpoint and identity. */
  detail: string;
  /** Provider status, e.g. "403/5300" or a SQL error number. */
  code?: string | null;
  retryable: boolean;
}

export type ConnectionKind = "sql" | "synapse" | "cosmos";
export type AuthKind = "entra" | "sql" | "key" | "windows";

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

/** Mirrors ExplorerSettings in the sidecar's Model.cs (docs/explorer-ux.md, "Settings"). */
export interface ExplorerSettings {
  showKindBadge: boolean;
  rowFont: "mono" | "ui";
  /** Environment ids in manual order; empty means order added. */
  envOrder: string[];
}

/** Mirrors EditorSettings in the sidecar's Model.cs (docs/query-editor.md, "Settings"). */
export interface EditorSettings {
  intellisense: boolean;
  /** Absent: the language default (lower for T-SQL, upper for Cosmos). */
  keywordCase?: "lower" | "upper" | "preserve" | null;
  /** Documents sampled per Cosmos container for property paths, 10 to 500. */
  catalogSampleDocs: number;
  autoRefreshOnDdl: boolean;
}

export interface AppSettings {
  updateCheck: import("../update-schedule").UpdateCheckMode;
  explorer: ExplorerSettings;
  editor: EditorSettings;
  /** The version whose changes the user has been shown (ADR 0013); absent means never recorded. */
  lastSeenVersion?: string | null;
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

/** A connection found in SSMS, Azure Data Studio or VS Code. Never includes a password. */
export interface ImportCandidate {
  name: string;
  kind: ConnectionKind;
  endpoint: string;
  auth: AuthKind;
  user?: string | null;
  database?: string | null;
  trustServerCertificate: boolean;
  note?: string | null;
  alreadyAdded: boolean;
}

export interface ImportSource {
  source: "ssms-recent" | "ssms-registered" | "ads" | "vscode";
  label: string;
  path: string;
  groups: { name: string; connections: ImportCandidate[] }[];
  error?: string | null;
}

export function createApi(rpc: RpcClient) {
  return {
    config: () => rpc.request<AppConfig>("config.get"),
    settings: () => rpc.request<AppSettings>("settings.get"),
    saveSettings: (settings: AppSettings) => rpc.request<AppSettings>("settings.save", settings),
    saveEnvironment: (env: EnvironmentConfig) => rpc.request<AppConfig>("config.saveEnvironment", env),
    deleteEnvironment: (id: string) => rpc.request<AppConfig>("config.deleteEnvironment", { id }),
    /** secret: undefined keeps the stored one, "" clears it. */
    saveConnection: (environmentId: string, connection: ConnectionConfig, secret?: string) =>
      rpc.request<AppConfig>("config.saveConnection", { environmentId, connection, secret: secret ?? null }),
    deleteConnection: (id: string) => rpc.request<AppConfig>("config.deleteConnection", { id }),
    testConnection: (connection: ConnectionConfig, secret?: string) =>
      // Sign-in can include an interactive Entra prompt, so allow longer than a normal call.
      rpc.request<TestConnectionResult>("connection.test", { connection, secret: secret ?? null }, 180_000),
    scanImports: () => rpc.request<ImportSource[]>("import.scan", undefined, 30_000),
    // A query can legitimately run for a long time; the user cancels it, so no RPC timeout applies.
    executeQuery: (request: { queryId: string; nodeId: string; text: string; database?: string }) =>
      rpc.request<import("../query/types").QuerySummary>("query.execute", request, 2_147_483_647),
    cancelQuery: (queryId: string) => rpc.request<boolean>("query.cancel", { queryId }),
    queryTemplate: (nodeId: string, action: "selectTop" | "newQuery") =>
      rpc.request<{ text?: string | null; language: "sql" | "cosmos" }>("query.template", { nodeId, action }),
    children: (nodeId: string) => rpc.request<TreeNode[]>("tree.children", { nodeId }, 180_000),
    /** Answers at once from memory or disk; a fresher catalog arrives as a catalog.updated notification. */
    catalogGet: (nodeId: string, database?: string) =>
      rpc.request<import("../query/catalog.svelte").CatalogNotice>("catalog.get", { nodeId, database: database ?? null }),
    catalogRefresh: (nodeId: string, database?: string) =>
      rpc.request<import("../query/catalog.svelte").CatalogNotice>("catalog.refresh", { nodeId, database: database ?? null }),
  };
}

export type Api = ReturnType<typeof createApi>;
