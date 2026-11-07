import type { Narrow } from "../narrow";
import type { QueryLanguage, QueryScope } from "../query/types";
import type { RpcClient } from "../rpc";
import type * as Sidecar from "../sidecar-types.generated";
import type { UpdateCheckMode } from "../update-schedule";

// The sidecar's JSON types are generated from its C# records (sidecar-types.generated.ts, ADR 0005). These are those
// types as the UI uses them, narrowed where it knows a field's closed set of values.

export type TreeNode = Sidecar.TreeNode;

/** Why a node's children failed to load (docs/explorer-errors.md). */
export type NodeError = Sidecar.NodeError;

/** A registered connection kind ("sql", "cosmos"...): open-ended, described by the sidecar (KindDescription). */
export type ConnectionKind = string;
export type AuthKind = "entra" | "sql" | "key" | "windows" | "password";

/** What the UI shows for a connection kind (backends.describe). */
export type KindDescription = Narrow<Sidecar.KindDescription, { auths: { id: AuthKind; label: string }[] }>;
export type KindBadge = Sidecar.KindBadge;

export type ConnectionConfig = Narrow<Sidecar.ConnectionConfig, { auth: AuthKind }>;
export type EnvironmentConfig = Narrow<Sidecar.EnvironmentConfig, { connections: ConnectionConfig[] }>;
/** connections: those in no environment. */
export type AppConfig = Narrow<Sidecar.AppConfig, { environments: EnvironmentConfig[]; connections: ConnectionConfig[] }>;

/** docs/explorer-ux.md, "Settings". envOrder: environment ids in manual order; empty means order added. */
export type ExplorerSettings = Narrow<Sidecar.ExplorerSettings, { rowFont: "mono" | "ui" }>;
/** docs/query-editor.md, "Settings". keywordCase absent: the language default (lower for T-SQL, upper for Cosmos). */
export type EditorSettings = Narrow<Sidecar.EditorSettings, { keywordCase?: "lower" | "upper" | "preserve" | null }>;
/** lastSeenVersion: the version whose changes the user has been shown (ADR 0013); absent means never recorded. */
export type AppSettings = Narrow<Sidecar.AppSettings, { updateCheck: UpdateCheckMode; explorer: ExplorerSettings; editor: EditorSettings }>;

export type TestConnectionResult = Sidecar.TestConnectionResult;
export type DeviceCodePrompt = Sidecar.DeviceCodePrompt;

/** A connection found in SSMS, Azure Data Studio or VS Code. Never includes a password. */
export type ImportCandidate = Narrow<Sidecar.ImportCandidate, { auth: AuthKind }>;
export type ImportSource = Narrow<
  Sidecar.ImportSource,
  { source: "ssms-recent" | "ssms-registered" | "ads" | "vscode"; groups: { name: string; connections: ImportCandidate[] }[] }
>;

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
    /** Connections backups (#28): the sidecar reads and writes the file; secrets are never in it. */
    exportBackup: (path: string) => rpc.request<Sidecar.BackupExportResult>("backup.export", { path }),
    readBackup: (path: string) => rpc.request<Sidecar.BackupPreview>("backup.read", { path }),
    importBackup: (path: string, connections: number[]) => rpc.request<Sidecar.BackupImportResult>("backup.import", { path, connections }),
    // A query can legitimately run for a long time; the user cancels it, so no RPC timeout applies.
    executeQuery: (request: { queryId: string; nodeId: string; text: string; database?: string }) =>
      rpc.request<import("../query/types").QuerySummary>("query.execute", request, 2_147_483_647),
    cancelQuery: (queryId: string) => rpc.request<boolean>("query.cancel", { queryId }),
    queryTemplate: (nodeId: string, action: "selectTop" | "newQuery") =>
      rpc.request<Narrow<Sidecar.QueryTemplateResult, { language: QueryLanguage }>>("query.template", { nodeId, action }),
    /** The connection, database and container a node's query tabs belong to, and their names. */
    queryScope: (nodeId: string) => rpc.request<QueryScope>("query.scope", { nodeId }),
    /** Context menu labels for every action id a node can carry. */
    actionLabels: () => rpc.request<Record<string, string>>("node.actionLabels"),
    describeBackends: () => rpc.request<KindDescription[]>("backends.describe"),
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
