import type { QueryLanguage, QueryScope } from "../query/types";
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

export type ConnectionKind = "sql" | "synapse" | "cosmos" | "postgres";
export type AuthKind = "entra" | "sql" | "key" | "windows" | "password";

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
  /** Entra only: sign in as this app registration instead of the default public client. */
  clientId?: string | null;
  /** SQL Server and Postgres: the name the certificate must match, when it isn't the server's (a private endpoint, an alias). */
  certificateHostName?: string | null;
  /** SQL Server and Postgres: a CA (or the server's own) certificate to trust for this connection only. */
  certificateFile?: string | null;
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
  /** Connections in no environment. */
  connections: ConnectionConfig[];
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
  /** Underline tables and columns the catalog does not know, before the query runs. */
  warnUnknownNames: boolean;
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
    /** environmentId: null puts it in no environment; another one moves it. secret: undefined keeps the stored one, "" clears it. */
    saveConnection: (environmentId: string | null, connection: ConnectionConfig, secret?: string) =>
      rpc.request<AppConfig>("config.saveConnection", { environmentId, connection, secret: secret ?? null }),
    deleteConnection: (id: string) => rpc.request<AppConfig>("config.deleteConnection", { id }),
    /** Undo of a delete: writes back the config from before it; the sidecar kept the deleted connections' secrets. */
    restoreConfig: (config: AppConfig) => rpc.request<AppConfig>("config.restore", config),
    /** A delete stands: drops these deleted connections' secrets. Never touches a connection still in the config. */
    purgeSecrets: (connectionIds: string[]) => rpc.request<boolean>("config.purgeSecrets", { connectionIds }),
    testConnection: (connection: ConnectionConfig, secret?: string, signal?: AbortSignal) =>
      // Sign-in can include an interactive Entra prompt, so allow longer than a normal call.
      rpc.request<TestConnectionResult>("connection.test", { connection, secret: secret ?? null }, 180_000, signal),
    scanImports: () => rpc.request<ImportSource[]>("import.scan", undefined, 30_000),
    // A query can legitimately run for a long time; the user cancels it, so no RPC timeout applies.
    executeQuery: (request: { queryId: string; nodeId: string; text: string; database?: string }) =>
      rpc.request<import("../query/types").QuerySummary>("query.execute", request, 2_147_483_647),
    cancelQuery: (queryId: string) => rpc.request<boolean>("query.cancel", { queryId }),
    queryTemplate: (nodeId: string, action: "selectTop" | "newQuery") =>
      rpc.request<{ text?: string | null; language: QueryLanguage; scope?: QueryScope }>("query.template", { nodeId, action }),
    /** The connection, database and container a node's query tabs belong to, and their names. */
    queryScope: (nodeId: string) => rpc.request<QueryScope>("query.scope", { nodeId }),
    /** Context menu labels for every action id a node can carry. */
    actionLabels: () => rpc.request<Record<string, string>>("node.actionLabels"),
    /** Runs a node action a backend adds in the sidecar; null text means nothing to copy. */
    invokeNode: (nodeId: string, actionId: string) => rpc.request<{ text?: string | null }>("node.invoke", { nodeId, actionId }),
    /** Aborting `signal` cancels the expand in the sidecar ($/cancelRequest) and rejects with an AbortError. */
    children: (nodeId: string, signal?: AbortSignal) => rpc.request<TreeNode[]>("tree.children", { nodeId }, 180_000, signal),
    /** Answers at once from memory or disk; a fresher catalog arrives as a catalog.updated notification. */
    catalogGet: (nodeId: string, database?: string) =>
      rpc.request<import("../query/catalog.svelte").CatalogNotice>("catalog.get", { nodeId, database: database ?? null }),
    catalogRefresh: (nodeId: string, database?: string) =>
      rpc.request<import("../query/catalog.svelte").CatalogNotice>("catalog.refresh", { nodeId, database: database ?? null }),
  };
}

export type Api = ReturnType<typeof createApi>;
