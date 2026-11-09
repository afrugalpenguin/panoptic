import { describe, expect, it, vi } from "vitest";
import type { ConnectionConfig, EnvironmentConfig, NodeError, TreeNode } from "./api";
import { rowMenu, type MenuEntry, type RowMenuContext } from "./row-menu";
import type { Row } from "./tree-model";

const conn: ConnectionConfig = { id: "c1", name: "orders", kind: "sql", endpoint: "orders.fabrikam.test", auth: "sql", trustServerCertificate: false };
const prod: EnvironmentConfig = { id: "prod", name: "Prod", color: "#e03131", readOnly: true, connections: [conn] };
const uat: EnvironmentConfig = { id: "uat", name: "UAT", color: "#f08c00", readOnly: false, connections: [] };

const node = (over: Partial<TreeNode>): TreeNode => ({ id: "n", kind: "table", label: "n", icon: "table", hasChildren: false, actions: [], ...over });
const nodeRow = (n: TreeNode) => ({ type: "node", key: n.id, node: n }) as unknown as Row;
const denied: NodeError = { summary: "No access", detail: "403", retryable: true };

function context(over: Partial<RowMenuContext> = {}) {
  const calls: string[] = [];
  /** Rows by key, nodes and environments by id, connection lookups by the connection's id. */
  const show = (a: unknown): string => {
    if (typeof a !== "object" || a === null) return String(a);
    if ("connection" in a) return (a as { connection: ConnectionConfig }).connection.id;
    if ("key" in a) return (a as { key: string }).key;
    return (a as { id: string }).id;
  };
  const record = (name: string) => vi.fn((...args: unknown[]) => void calls.push(`${name}(${args.map(show).join(",")})`));
  const ctx: RowMenuContext = {
    labels: { selectTop: "Select top 1000", newQuery: "New query", refresh: "Refresh" },
    envOrder: ["prod", "uat"],
    looseConnections: [],
    environment: (id) => [prod, uat].find((e) => e.id === id),
    connection: (id) => (id === conn.id ? { env: prod, connection: conn } : undefined),
    copy: record("copy"),
    retry: record("retry"),
    openProblems: record("openProblems"),
    openQuery: record("openQuery"),
    refresh: record("refresh"),
    refreshQueryTabs: record("refreshQueryTabs"),
    invoke: record("invoke"),
    newConnection: record("newConnection"),
    moveEnvironment: record("moveEnvironment"),
    deleteEnvironment: record("deleteEnvironment"),
    editConnection: record("editConnection"),
    moveConnection: record("moveConnection"),
    stepConnection: record("stepConnection"),
    removeFromEnvironment: record("removeFromEnvironment"),
    removeConnection: record("removeConnection"),
    ...over,
  };
  return { ctx, calls };
}

const labels = (items: MenuEntry[]) => items.map((i) => (i === "separator" ? "---" : `${i.label}${i.disabled ? " [disabled]" : ""}${i.danger ? " [danger]" : ""}`));
const run = (items: MenuEntry[], label: string) => (items.find((i) => i !== "separator" && i.label === label) as Exclude<MenuEntry, "separator">).run();

describe("rowMenu", () => {
  it("offers nothing on the Ungrouped header or an empty environment's hint", () => {
    const { ctx } = context();
    expect(rowMenu({ type: "group" } as Row, ctx)).toEqual([]);
    expect(rowMenu({ type: "env-empty" } as Row, ctx)).toEqual([]);
  });

  it("an error row copies, retries when it can, and opens Problems", () => {
    const { ctx, calls } = context();
    const items = rowMenu({ type: "error", parentId: "p", error: denied } as Row, ctx);
    expect(labels(items)).toEqual(["Copy error", "Retry", "Open Problems"]);
    run(items, "Retry");
    run(items, "Open Problems");
    expect(calls).toEqual(["retry(p)", "openProblems(p)"]);
    expect(labels(rowMenu({ type: "error", parentId: "p", error: { ...denied, retryable: false } } as Row, ctx))).toEqual(["Copy error", "Open Problems"]);
  });

  it("a loading or empty row offers Retry", () => {
    const { ctx, calls } = context();
    const items = rowMenu({ type: "loading", parentId: "p" } as Row, ctx);
    expect(labels(items)).toEqual(["Retry"]);
    run(items, "Retry");
    expect(calls).toEqual(["retry(p)"]);
  });

  it("an environment reorders, refreshes and deletes itself, and edits in its pane not a dialog; Move up is off for the first", () => {
    const { ctx, calls } = context();
    const items = rowMenu(nodeRow(node({ id: "env:prod", kind: "environment", actions: ["refresh"], meta: { environmentId: "prod" } })), ctx);
    expect(labels(items)).toEqual([
      "New connection...", "Move up [disabled]", "Move down", "Refresh", "---", "Delete environment [danger]",
    ]);
    for (const label of ["New connection...", "Move down", "Refresh", "Delete environment"]) run(items, label);
    expect(calls).toEqual(["newConnection(prod)", "moveEnvironment(prod,1)", "refresh(env:prod)", "deleteEnvironment(prod)"]);
  });

  it("the last environment cannot move down", () => {
    const { ctx } = context();
    const items = rowMenu(nodeRow(node({ id: "env:uat", kind: "environment", meta: { environmentId: "uat" } })), ctx);
    expect(labels(items).slice(1, 3)).toEqual(["Move up", "Move down [disabled]"]);
  });

  it("a connection edits, queries, moves and removes itself; its refresh also refreshes its query tabs", () => {
    const { ctx, calls } = context();
    const n = node({ id: "conn:c1", kind: "connection", actions: ["newQuery", "refresh"], meta: { connectionId: "c1", copyText: "orders" } });
    const items = rowMenu(nodeRow(n), ctx);
    expect(labels(items)).toEqual([
      "New query (Ctrl+N)", "---", "Edit connection...", "Refresh", "Copy name", "Move to environment...", "Move up [disabled]", "Move down [disabled]",
      "Remove from environment", "---", "Remove connection [danger]",
    ]);
    for (const label of ["New query (Ctrl+N)", "Edit connection...", "Refresh", "Copy name", "Move to environment...", "Remove from environment", "Remove connection"]) run(items, label);
    expect(calls).toEqual([
      "openQuery(conn:c1,newQuery)", "editConnection(c1)", "refresh(conn:c1)", "refreshQueryTabs(conn:c1)", "copy(orders)",
      "moveConnection(c1)", "removeFromEnvironment(c1)", "removeConnection(c1)",
    ]);
  });

  it("a connection moves up and down within its group, off at either end", () => {
    const second = { ...conn, id: "c2", name: "billing" };
    const third = { ...conn, id: "c3", name: "stock" };
    const env = { ...prod, connections: [conn, second, third] };
    const at = (c: ConnectionConfig) => {
      const { ctx, calls } = context({ connection: (id) => ({ env, connection: [conn, second, third].find((x) => x.id === id)! }) });
      const items = rowMenu(nodeRow(node({ id: `conn:${c.id}`, kind: "connection", meta: { connectionId: c.id } })), ctx);
      return { items, calls, moves: labels(items).filter((l) => l.startsWith("Move up") || l.startsWith("Move down")) };
    };
    expect(at(conn).moves).toEqual(["Move up [disabled]", "Move down"]);
    expect(at(second).moves).toEqual(["Move up", "Move down"]);
    expect(at(third).moves).toEqual(["Move up", "Move down [disabled]"]);
    const { items, calls } = at(second);
    run(items, "Move up");
    run(items, "Move down");
    expect(calls).toEqual(["stepConnection(c2,-1)", "stepConnection(c2,1)"]);
  });

  it("a connection in no environment moves within the other connections in none", () => {
    const second = { ...conn, id: "c2" };
    const { ctx } = context({ looseConnections: [conn, second], connection: (id) => ({ connection: id === "c2" ? second : conn }) });
    const items = rowMenu(nodeRow(node({ id: "conn:c2", kind: "connection", meta: { connectionId: "c2" } })), ctx);
    expect(labels(items)).toContain("Move up");
    expect(labels(items)).toContain("Move down [disabled]");
  });

  it("a connection in no environment has nothing to be removed from", () => {
    const { ctx } = context({ connection: () => ({ connection: conn }) });
    const items = rowMenu(nodeRow(node({ id: "conn:c1", kind: "connection", meta: { connectionId: "c1" } })), ctx);
    expect(labels(items)).not.toContain("Remove from environment");
  });

  it("a database refresh also refreshes its query tabs; other nodes just refresh, invoke and copy", () => {
    const { ctx, calls } = context();
    run(rowMenu(nodeRow(node({ id: "db", kind: "database", actions: ["refresh"] })), ctx), "Refresh");
    const table = rowMenu(nodeRow(node({ id: "t", actions: ["selectTop", "refresh", "script"], meta: { copyText: "[dbo].[t]" } })), ctx);
    expect(labels(table)).toEqual(["Select top 1000", "---", "Refresh", "script", "Copy name"]);
    run(table, "Select top 1000");
    run(table, "Refresh");
    run(table, "script");
    expect(calls).toEqual(["refresh(db)", "refreshQueryTabs(db)", "openQuery(t,selectTop)", "refresh(t)", "invoke(t,script)"]);
  });
});
