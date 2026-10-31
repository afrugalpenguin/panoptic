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

// dbo.Orders: 1000 rows like a real order table, from a fixed seed so every capture is identical.
const ORDER_COLUMNS = [
  { name: "OrderId", type: "int" },
  { name: "OrderNumber", type: "nvarchar(20)" },
  { name: "CustomerId", type: "int" },
  { name: "AccountCode", type: "char(9)" },
  { name: "OrderedAt", type: "datetime2(3)" },
  { name: "RequiredBy", type: "date" },
  { name: "ShippedAt", type: "datetime2(3)" },
  { name: "Status", type: "nvarchar(20)" },
  { name: "Channel", type: "nvarchar(20)" },
  { name: "Region", type: "nvarchar(16)" },
  { name: "Warehouse", type: "char(5)" },
  { name: "ItemCount", type: "smallint" },
  { name: "Currency", type: "char(3)" },
  { name: "Subtotal", type: "decimal(12,2)" },
  { name: "Discount", type: "decimal(12,2)" },
  { name: "Tax", type: "decimal(12,2)" },
  { name: "Shipping", type: "decimal(12,2)" },
  { name: "Total", type: "decimal(12,2)" },
  { name: "PaymentMethod", type: "nvarchar(16)" },
  { name: "IsPriority", type: "bit" },
  { name: "PromoCode", type: "nvarchar(16)" },
  { name: "CreatedBy", type: "sysname" },
];

function orders(): (string | number | boolean | null)[][] {
  let seed = 20261031;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp = (d: Date) =>
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
  const day = (d: Date) => stamp(d).slice(0, 10);
  const money = (n: number) => Math.round(n * 100) / 100;
  const regions: [string, string, number][] = [["UK-North", "GBP", 0.2], ["UK-South", "GBP", 0.2], ["EU-West", "EUR", 0.21], ["US-East", "USD", 0.0725]];
  const statuses = ["Delivered", "Delivered", "Delivered", "Shipped", "Shipped", "Picking", "Pending", "Cancelled", "Returned"];
  const rows: (string | number | boolean | null)[][] = [];
  let at = Date.UTC(2026, 8, 1, 7, 12, 4, 211);
  for (let i = 0; i < 1000; i++) {
    at += Math.floor(rand() * 75 * 60_000);
    const ordered = new Date(at);
    const [region, currency, rate] = pick(regions);
    const status = pick(statuses);
    const items = 1 + Math.floor(rand() * rand() * 24);
    const subtotal = money(items * (4.5 + rand() * 120));
    const discount = rand() < 0.25 ? money(subtotal * pick([0.05, 0.1, 0.15])) : 0;
    const shipping = subtotal - discount > 75 ? 0 : pick([3.95, 4.99, 6.5, 9.99]);
    const tax = money((subtotal - discount) * rate);
    const shipped = ["Shipped", "Delivered", "Returned"].includes(status) ? stamp(new Date(at + (6 + rand() * 60) * 3_600_000)) : null;
    const customer = 1000 + Math.floor(rand() * 480);
    rows.push([
      10241 + i,
      `SO-2026-${pad(10241 + i, 6)}`,
      customer,
      `ACC-${pad(customer, 5)}`,
      stamp(ordered),
      day(new Date(at + (2 + Math.floor(rand() * 9)) * 86_400_000)),
      shipped,
      status,
      pick(["Web", "Web", "Web", "Phone", "Partner", "Marketplace"]),
      region,
      pick(["WH-01", "WH-02", "WH-03", "WH-04"]),
      items,
      currency,
      subtotal,
      discount,
      tax,
      shipping,
      money(subtotal - discount + tax + shipping),
      pick(["Card", "Card", "Card", "Invoice", "Transfer", "Wallet"]),
      rand() < 0.12,
      discount > 0 ? pick(["AUTUMN10", "WELCOME5", "BULK15", "LOYAL10"]) : null,
      pick(["web-checkout", "web-checkout", "phone-desk", "partner-api", "import-job"]),
    ]);
  }
  return rows;
}
const ORDERS = orders();

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
      const objects = TABLES.map(([schema, name]) => ({ schema, name, kind: "table", columns: name === "Orders" ? ORDER_COLUMNS.map((c) => ({ name: c.name, type: c.type, nullable: ["ShippedAt", "PromoCode"].includes(c.name) })) : [] }));
      return { key: `${scope.connection}|${p.database ?? scope.database ?? ""}`, state: "current", catalog: { stamp: "1", schemas: ["dbo", "sales"], objects, types: [] } };
    }
    case "query.execute": {
      const queryId = String(p.queryId);
      // Streamed in 500-row batches, as the sidecar sends them.
      for (let i = 0; i < ORDERS.length; i += 500)
        notify("query.rows", { queryId, index: 0, columns: i === 0 ? ORDER_COLUMNS : undefined, rows: ORDERS.slice(i, i + 500) });
      notify("query.message", { queryId, kind: "info", text: `(${ORDERS.length} rows affected)`, elapsedMs: 184 });
      return new Promise((resolve) =>
        setTimeout(() => resolve({ queryId, resultSets: [{ rowCount: ORDERS.length }], elapsedMs: 187, rolledBack: false, committed: false, cancelled: false }), 40),
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
