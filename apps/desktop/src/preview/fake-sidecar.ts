// Dev-only: a stand-in for the .NET sidecar so the preview can mount the whole App with synthetic data.
// It answers the JSON-RPC calls the App makes over Tauri's mocked IPC. Synthetic names only (no real servers,
// databases or tenants): the environments extend the landing fixture (docs/plans/2026-10-31-landing.md, Task 3).
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { AppConfig, ConnectionKind, EnvironmentConfig, TreeNode } from "../app/api";

const VERSION = "0.2.0";

const conn = (name: string, kind: ConnectionKind, endpoint: string) => ({
  id: name,
  name,
  kind,
  endpoint,
  auth: "entra" as const,
  trustServerCertificate: false,
});
const env = (id: string, name: string, color: string, readOnly: boolean, connections: ReturnType<typeof conn>[]): EnvironmentConfig => ({
  id,
  name,
  color,
  readOnly,
  connections,
});

export const config: AppConfig = {
  environments: [
    env("dev", "Dev", "#2f9e44", false, [
      conn("dev-sql-01", "sql", "dev-sql-01.example.test"),
      conn("dev-cosmos", "cosmos", "https://dev-cosmos.example.test:443/"),
      conn("uk-dev-pg", "postgres", "uk-dev-pg.example.test"),
    ]),
    env("uat", "UAT", "#f08c00", false, [conn("uat-sql-01", "sql", "uat-sql-01.example.test"), conn("uat-pg", "postgres", "uat-pg.example.test")]),
    env("prod", "Prod", "#e03131", true, [
      conn("uk-prod-sql-01", "sql", "uk-prod-sql-01.example.test"),
      conn("uk-prod-sql-02", "sql", "uk-prod-sql-02.example.test"),
      conn("us-prod-sql-01", "sql", "us-prod-sql-01.example.test"),
      conn("uk-prod-cosmos", "cosmos", "https://uk-prod-cosmos.example.test:443/"),
    ]),
    env("staging", "Staging", "#7048e8", false, [conn("stg-sql-01", "sql", "stg-sql-01.example.test"), conn("stg-cosmos", "cosmos", "https://stg-cosmos.example.test:443/")]),
    env("sandbox", "Sandbox", "#0c8599", false, [conn("sbx-pg-01", "postgres", "sbx-pg-01.example.test")]),
  ],
  // Connections in no environment (docs/explorer-ux.md, "Grouping"): none in the README fixture.
  connections: [],
};

const SELECTABLE = ["selectTop", "newQuery", "refresh"];
const QUERYABLE = ["newQuery", "refresh"];
const BROWSE = ["refresh"];

const node = (id: string, kind: string, label: string, icon: string, hasChildren: boolean, actions: string[], meta?: Record<string, string>): TreeNode => ({
  id,
  kind,
  label,
  icon,
  hasChildren,
  actions,
  meta,
});

const DATABASES: Record<ConnectionKind, string[]> = {
  sql: ["Sales", "Inventory", "Reporting", "master", "model", "msdb", "tempdb"],
  synapse: ["Warehouse"],
  postgres: ["orders", "postgres"],
  cosmos: ["catalog", "events"],
};
const TABLES: [string, string][] = [
  ["dbo", "Customers"],
  ["dbo", "OrderLines"],
  ["dbo", "Orders"],
  ["dbo", "Products"],
  ["sales", "Invoices"],
  ["sales", "Payments"],
];

/** Connection ids carry no environment, as in the real sidecar: conn:<id>/db:<name>/... */
const connectionNode = (c: AppConfig["connections"][number]) =>
  node(`conn:${c.id}`, "connection", c.name, c.kind, true, QUERYABLE, { connectionKind: c.kind, endpoint: c.endpoint, connectionId: c.id, copyText: c.name });
const connectionAt = (segment: string) =>
  [...config.environments.flatMap((e) => e.connections), ...config.connections].find((x) => `conn:${x.id}` === segment);

function children(id: string): TreeNode[] {
  if (id === "") {
    return [
      ...config.environments.map((e) =>
        node(`env:${e.id}`, "environment", e.name, "environment", e.connections.length > 0, BROWSE, {
          color: e.color,
          readOnly: String(e.readOnly),
          environmentId: e.id,
          connectionCount: String(e.connections.length),
        }),
      ),
      ...config.connections.map(connectionNode),
    ];
  }
  const parts = id.split("/");
  if (parts.length === 1 && parts[0].startsWith("env:")) return config.environments.find((x) => `env:${x.id}` === parts[0])?.connections.map(connectionNode) ?? [];
  const c = connectionAt(parts[0]);
  if (!c) return [];
  if (parts.length === 1) {
    return DATABASES[c.kind].map((db) =>
      node(`${id}/db:${db}`, "database", db, "database", true, QUERYABLE, { system: String(["master", "model", "msdb", "tempdb", "postgres"].includes(db)) }),
    );
  }
  if (parts.length === 2) {
    return [
      node(`${id}/f:tables`, "folder", "Tables", "folder", true, BROWSE),
      node(`${id}/f:views`, "folder", "Views", "folder", true, BROWSE),
      node(`${id}/f:programmability`, "folder", "Programmability", "folder", true, BROWSE),
      node(`${id}/f:synonyms`, "folder", "Synonyms", "folder", true, BROWSE),
    ];
  }
  if (parts.length === 3 && parts[2] === "f:tables") {
    return TABLES.map(([schema, name]) =>
      node(`${id}/o:${schema}.${name}`, "table", `${schema}.${name}`, "table", true, SELECTABLE, { schema, name, dragText: `${schema}.${name}`, copyText: `[${schema}].[${name}]` }),
    );
  }
  return [];
}

const ORDERS = [
  [10241, 1007, "2026-10-01 09:14:22", "Shipped", 182.4, "GBP"],
  [10242, 1012, "2026-10-01 10:02:51", "Shipped", 64.0, "GBP"],
  [10243, 1003, "2026-10-02 08:47:09", "Delivered", 1240.75, "EUR"],
  [10244, 1019, "2026-10-02 13:30:40", "Cancelled", 0, "GBP"],
  [10245, 1007, "2026-10-03 11:18:03", "Delivered", 39.99, "GBP"],
  [10246, 1021, "2026-10-04 16:55:27", "Shipped", 512.3, "USD"],
  [10247, 1002, "2026-10-05 09:01:12", "Pending", 88.5, "GBP"],
  [10248, 1015, "2026-10-05 14:42:38", "Delivered", 230.0, "EUR"],
  [10249, 1012, "2026-10-06 10:26:45", "Shipped", 17.25, "GBP"],
  [10250, 1024, "2026-10-07 12:09:30", "Pending", 940.0, "USD"],
  [10251, 1003, "2026-10-08 15:33:19", "Delivered", 76.8, "EUR"],
  [10252, 1009, "2026-10-09 08:12:54", "Shipped", 305.6, "GBP"],
];

type Request = { id?: number; method: string; params?: Record<string, unknown> };
const reply = (line: unknown) => setTimeout(() => void emit("sidecar://message", JSON.stringify(line)), 5);
const notify = (method: string, params: unknown) => reply({ jsonrpc: "2.0", method, params });

function scopeOf(nodeId: string) {
  const parts = nodeId.split("/");
  const connection = parts[0];
  const database = parts[1]?.slice(3);
  const connectionLabel = parts[0].slice(5);
  return { connection, database, label: database ?? connectionLabel, connectionLabel };
}

function languageOf(nodeId: string): string {
  const kind = connectionAt(nodeId.split("/")[0])?.kind;
  return kind === "cosmos" ? "cosmos" : kind === "postgres" ? "pgsql" : "sql";
}

function handle(req: Request): unknown {
  const p = req.params ?? {};
  switch (req.method) {
    case "ping":
      return { startupMs: 180, version: VERSION, mode: "preview", pid: 1 };
    case "config.get":
      return config;
    case "settings.get":
    case "settings.save":
      return {
        updateCheck: "never",
        explorer: { showKindBadge: true, rowFont: "mono", envOrder: [] },
        editor: { intellisense: true, catalogSampleDocs: 50, autoRefreshOnDdl: true, warnUnknownNames: true },
        lastSeenVersion: VERSION,
      };
    case "node.actionLabels":
      return { selectTop: "Select top 1000", newQuery: "New query", refresh: "Refresh" };
    case "tree.children":
      return children(String(p.nodeId));
    case "query.scope":
      return scopeOf(String(p.nodeId));
    case "query.template": {
      const nodeId = String(p.nodeId);
      const obj = nodeId.split("/").at(-1)!;
      const text = p.action === "selectTop" && obj.startsWith("o:") ? `SELECT TOP (1000) *\nFROM ${obj.slice(2).split(".").map((s) => `[${s}]`).join(".")};` : "";
      return { text, language: languageOf(nodeId), scope: scopeOf(nodeId) };
    }
    case "catalog.get":
    case "catalog.refresh": {
      const scope = scopeOf(String(p.nodeId));
      const objects = TABLES.map(([schema, name]) => ({ schema, name, kind: "table", columns: [] }));
      return { key: `${scope.connection}|${p.database ?? scope.database ?? ""}`, state: "current", catalog: { stamp: "1", schemas: ["dbo", "sales"], objects, types: [] } };
    }
    case "query.execute": {
      const queryId = String(p.queryId);
      const columns = [
        { name: "OrderId", type: "int" },
        { name: "CustomerId", type: "int" },
        { name: "OrderedAt", type: "datetime2" },
        { name: "Status", type: "nvarchar" },
        { name: "Total", type: "decimal" },
        { name: "Currency", type: "char" },
      ];
      notify("query.rows", { queryId, index: 0, columns, rows: ORDERS });
      notify("query.message", { queryId, kind: "info", text: `(${ORDERS.length} rows affected)`, elapsedMs: 38 });
      return new Promise((resolve) =>
        setTimeout(() => resolve({ queryId, resultSets: [{ rowCount: ORDERS.length }], elapsedMs: 41, rolledBack: false, committed: false, cancelled: false }), 40),
      );
    }
    default:
      throw new Error(`Not in the preview: ${req.method}`);
  }
}

/** Mocks the shell's commands and events; the sidecar reports itself running straight away. */
export function installFakeSidecar() {
  mockIPC(
    async (cmd, payload) => {
      const args = (payload ?? {}) as Record<string, unknown>;
      switch (cmd) {
        case "sidecar_status":
          return { state: "running", pid: 1 };
        case "sidecar_send": {
          const req = JSON.parse(String(args.line)) as Request;
          if (req.id === undefined) return;
          try {
            const result = await handle(req);
            reply({ jsonrpc: "2.0", id: req.id, result });
          } catch (e) {
            reply({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: String(e) } });
          }
          return;
        }
        case "plugin:app|version":
          return VERSION;
        case "changelog_markdown":
          return "";
        case "is_installed":
          return true;
        default:
          return null;
      }
    },
    { shouldMockEvents: true },
  );
}
