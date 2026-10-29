import { describe, expect, it, vi } from "vitest";
import type { QuerySummary } from "./types";
import { nodeParts, QueryWorkspace } from "./store.svelte";

const target = { nodeId: "env:dev/conn:c1/db:Orders", label: "Orders", connection: "sql-dev", envColor: "#2f9e44", readOnly: false, language: "sql" as const };

function setup() {
  let resolve!: (s: QuerySummary) => void;
  const api = {
    executeQuery: vi.fn((_: { queryId: string }) => new Promise<QuerySummary>((r) => (resolve = r))),
    cancelQuery: vi.fn(async () => true),
  };
  const ws = new QueryWorkspace(api);
  return { ws, api, finish: (s: Partial<QuerySummary> = {}) => resolve({ queryId: "", resultSets: [], elapsedMs: 5, rolledBack: false, cancelled: false, ...s }) };
}

describe("QueryWorkspace", () => {
  it("opens tabs and makes the new one active", () => {
    const { ws } = setup();
    const a = ws.open(target, "SELECT 1");
    const b = ws.open(target, "");
    expect(ws.tabs).toHaveLength(2);
    expect(ws.active).toBe(b);
    ws.close(b.id);
    expect(ws.active).toBe(a);
  });

  it("routes streamed rows and messages to the running tab", async () => {
    const { ws, api, finish } = setup();
    const tab = ws.open(target, "SELECT 1");
    const done = ws.run(tab);
    const queryId = api.executeQuery.mock.calls[0][0].queryId;
    expect(tab.running).toBe(true);

    ws.handle("query.rows", { queryId, index: 0, columns: [{ name: "a", type: "int" }], rows: [[1], [2]] });
    ws.handle("query.rows", { queryId, index: 0, rows: [[3]] });
    ws.handle("query.message", { queryId, kind: "info", text: "(3 rows affected)", elapsedMs: 4 });
    ws.handle("query.rows", { queryId: "someone-else", index: 0, rows: [[99]] });

    expect(tab.results[0].count).toBe(3);
    expect(tab.results[0].rows).toEqual([[1], [2], [3]]);
    expect(tab.messages.map((m) => m.text)).toEqual(["(3 rows affected)"]);

    finish({ resultSets: [{ rowCount: 3 }] });
    await done;
    expect(tab.running).toBe(false);
    expect(tab.summary?.resultSets[0].rowCount).toBe(3);
  });

  it("extends columns when Cosmos finds new properties mid-stream", () => {
    const { ws, api } = setup();
    const tab = ws.open({ ...target, language: "cosmos" }, "SELECT * FROM c");
    ws.run(tab);
    const queryId = api.executeQuery.mock.calls[0][0].queryId;
    ws.handle("query.rows", { queryId, index: 0, columns: [{ name: "id", type: "" }], rows: [["a"]] });
    ws.handle("query.rows", { queryId, index: 0, columns: [{ name: "id", type: "" }, { name: "x", type: "" }], rows: [["b", 1]] });
    expect(tab.results[0].columns.map((c) => c.name)).toEqual(["id", "x"]);
  });

  it("runs only the selection when there is one, and clears the previous results", async () => {
    const { ws, api, finish } = setup();
    const tab = ws.open(target, "SELECT 1\nSELECT 2");
    tab.results = [];
    ws.run(tab, "SELECT 2");
    expect(api.executeQuery.mock.calls[0][0]).toMatchObject({ text: "SELECT 2", nodeId: target.nodeId });
    finish();
  });

  it("cancels the running query", async () => {
    const { ws, api } = setup();
    const tab = ws.open(target, "WAITFOR DELAY '00:01'");
    ws.run(tab);
    await ws.cancel(tab);
    expect(api.cancelQuery).toHaveBeenCalledWith(api.executeQuery.mock.calls[0][0].queryId);
  });

  it("records a failed call as the tab's error instead of throwing", async () => {
    const api = { executeQuery: vi.fn(async () => Promise.reject(new Error("sidecar stopped"))), cancelQuery: vi.fn() };
    const ws = new QueryWorkspace(api);
    const tab = ws.open(target, "SELECT 1");
    await ws.run(tab);
    expect(tab.running).toBe(false);
    expect(tab.error).toBe("sidecar stopped");
  });

  describe("What's new tab", () => {
    const sections = [
      { version: "0.2.13", date: "2026-10-29", body: "- Added: x" },
      { version: "0.2.12", date: "2026-10-28", body: "No user-facing changes." },
    ];

    it("is appended and made active without touching open query tabs", () => {
      const { ws } = setup();
      const query = ws.open(target, "SELECT 1");
      const tab = ws.openWhatsNew(sections);
      expect(ws.tabs.map((t) => t.kind)).toEqual(["query", "whats-new"]);
      expect(ws.active).toBe(tab);
      expect(tab.title).toBe("What's new in v0.2.13");
      expect(query.text).toBe("SELECT 1");
    });

    it("is a singleton: opening again focuses it and updates its sections", () => {
      const { ws } = setup();
      ws.openWhatsNew(sections.slice(0, 1));
      ws.open(target, "");
      const again = ws.openWhatsNew(sections);
      expect(ws.tabs.filter((t) => t.kind === "whats-new")).toHaveLength(1);
      expect(ws.active).toBe(again);
      expect(again.sections).toHaveLength(2);
    });

    it("closes like any tab", () => {
      const { ws } = setup();
      const tab = ws.openWhatsNew(sections);
      ws.close(tab.id);
      expect(ws.tabs).toHaveLength(0);
    });

    it("is never touched by query routing", async () => {
      const { ws, api, finish } = setup();
      const query = ws.open(target, "SELECT 1");
      ws.openWhatsNew(sections);
      const done = ws.run(query);
      const queryId = api.executeQuery.mock.calls[0][0].queryId;
      ws.handle("query.rows", { queryId, index: 0, columns: [{ name: "a", type: "int" }], rows: [[1]] });
      finish();
      await done;
      expect(query.results[0].count).toBe(1);
      expect(ws.tabs.find((t) => t.kind === "whats-new")).not.toHaveProperty("results");
    });
  });
});

describe("QueryWorkspace: IntelliSense", () => {
  const catalog = { stamp: "s", schemas: ["dbo"], objects: [], types: [] };

  function setupCatalog() {
    const api = {
      executeQuery: vi.fn(async (_: { queryId: string; database?: string }) => ({ queryId: "", resultSets: [], elapsedMs: 1, rolledBack: false, cancelled: false })),
      cancelQuery: vi.fn(async () => true),
      catalogGet: vi.fn(async (_nodeId: string, database?: string) => ({ key: `key:${database ?? "node"}`, state: "building" as const })),
      catalogRefresh: vi.fn(async (_nodeId: string, database?: string) => ({ key: `key:${database ?? "node"}`, state: "building" as const })),
      databases: vi.fn(async (_connection: string) => ["Orders", "Sales"]),
    };
    return { ws: new QueryWorkspace(api), api };
  }
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("parses the connection, database and container out of a node id", () => {
    expect(nodeParts("env:dev/conn:c1/db:My%20Db/f:tables/o:x")).toEqual({ connection: "env:dev/conn:c1", database: "My Db" });
    expect(nodeParts("env:dev/conn:cos/db:app/c:orders")).toEqual({ connection: "env:dev/conn:cos", database: "app", container: "orders" });
    expect(nodeParts("env:dev/conn:c1")).toEqual({ connection: "env:dev/conn:c1" });
  });

  it("loads the tab's catalog and database list on open, and follows notifications", async () => {
    const { ws, api } = setupCatalog();
    const tab = ws.open(target, "");
    await settle();
    expect(api.catalogGet).toHaveBeenCalledWith(target.nodeId, undefined);
    expect(api.databases).toHaveBeenCalledWith("env:dev/conn:c1");
    expect(tab.databases).toEqual(["Orders", "Sales"]);
    expect(tab.catalogKey).toBe("key:node");
    expect(ws.intellisenseStatus(tab).text).toBe("IntelliSense: building");
    ws.handle("catalog.updated", { key: "key:node", state: "current", catalog });
    expect(ws.intellisenseStatus(tab).text).toBe("IntelliSense: current");
  });

  it("switching database reloads the catalog and the query runs against it", async () => {
    const { ws, api } = setupCatalog();
    const tab = ws.open(target, "select 1");
    await settle();
    ws.setDatabase(tab, "Sales");
    await settle();
    expect(api.catalogGet).toHaveBeenLastCalledWith(target.nodeId, "Sales");
    expect(tab.catalogKey).toBe("key:Sales");
    await ws.run(tab);
    expect(api.executeQuery.mock.calls[0][0].database).toBe("Sales");
    ws.setDatabase(tab, "Orders");
    expect(tab.database).toBeUndefined();
  });

  it("refreshes the catalog after DDL, not after a query, and not when turned off", async () => {
    const { ws, api } = setupCatalog();
    const tab = ws.open(target, "");
    await ws.run(tab, "select 'drop'");
    expect(api.catalogRefresh).not.toHaveBeenCalled();
    await ws.run(tab, "create table t (a int)");
    expect(api.catalogRefresh).toHaveBeenCalledTimes(1);
    ws.editor = { ...ws.editor, autoRefreshOnDdl: false };
    await ws.run(tab, "drop table t");
    expect(api.catalogRefresh).toHaveBeenCalledTimes(1);
  });

  it("model info: language, keys, catalogs, and on-demand loading of other databases", async () => {
    const { ws, api } = setupCatalog();
    const tab = ws.open(target, "");
    await settle();
    ws.handle("catalog.updated", { key: "key:node", state: "current", catalog });
    const info = ws.intellisense(tab)()!;
    expect(info.options).toEqual({ language: "tsql" });
    expect(info.keys).toEqual({ current: "key:node", databases: { orders: "key:node" } });
    expect(info.catalogs).toEqual([{ key: "key:node", catalog, version: 1 }]);

    info.onMissing("Sales");
    info.onMissing("Sales");
    await settle();
    expect(api.catalogGet.mock.calls.filter((c) => c[1] === "Sales")).toHaveLength(1);
    expect(ws.intellisense(tab)()!.keys.databases).toEqual({ orders: "key:node", sales: "key:Sales" });
  });

  it("turned off: no model info and no catalog requests", async () => {
    const { ws, api } = setupCatalog();
    ws.editor = { ...ws.editor, intellisense: false };
    const tab = ws.open(target, "");
    await settle();
    expect(api.catalogGet).not.toHaveBeenCalled();
    expect(ws.intellisense(tab)()).toBeUndefined();
    expect(ws.intellisenseStatus(tab).text).toBe("IntelliSense: off");
  });
});

describe("QueryWorkspace: explorer refresh", () => {
  it("rebuilds the catalogs of open tabs on the refreshed connection or database only", async () => {
    const api = {
      executeQuery: vi.fn(),
      cancelQuery: vi.fn(async () => true),
      catalogGet: vi.fn(async (_n: string, d?: string) => ({ key: `k:${d ?? "node"}`, state: "building" as const })),
      catalogRefresh: vi.fn(async (_n: string, d?: string) => ({ key: `k:${d ?? "node"}`, state: "building" as const })),
    };
    const ws = new QueryWorkspace(api);
    ws.open(target, "");
    ws.open({ ...target, nodeId: "env:dev/conn:c1/db:Sales" }, "");
    ws.open({ ...target, nodeId: "env:dev/conn:c2/db:Orders" }, "");

    ws.refreshForNode("env:dev/conn:c1/db:Orders");
    expect(api.catalogRefresh.mock.calls.map((c) => c[0])).toEqual(["env:dev/conn:c1/db:Orders"]);

    ws.refreshForNode("env:dev/conn:c1");
    expect(api.catalogRefresh).toHaveBeenCalledTimes(3);
  });
});
