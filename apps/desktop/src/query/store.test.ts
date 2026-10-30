import { describe, expect, it, vi } from "vitest";
import type { QuerySummary } from "./types";
import type { Suggestion } from "./intellisense/suggest";
import type { SuggestRequest } from "./intellisense/worker";
import { nodeParts, QueryWorkspace } from "./store.svelte";

const target = { nodeId: "env:dev/conn:c1/db:Orders", label: "Orders", connection: "sql-dev", envColor: "#2f9e44", readOnly: false, language: "sql" as const };

function setup(suggest?: (request: SuggestRequest) => Promise<Suggestion | undefined>) {
  let resolve!: (s: QuerySummary) => void;
  const api = {
    executeQuery: vi.fn((_: { queryId: string }) => new Promise<QuerySummary>((r) => (resolve = r))),
    cancelQuery: vi.fn(async () => true),
  };
  const ws = new QueryWorkspace(suggest ? { ...api, suggest } : api);
  return { ws, api, finish: (s: Partial<QuerySummary> = {}) => resolve({ queryId: "", resultSets: [], elapsedMs: 5, rolledBack: false, committed: false, cancelled: false, ...s }) };
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

  describe("error location", () => {
    const script = ["select 1 as a", "", "select c.Id", "from dbo.Customer c", "  join contracts k on k.CustomerId = c.Id"].join("\n");

    function failing(text: string, suggest?: (request: SuggestRequest) => Promise<Suggestion | undefined>) {
      const { ws, api } = setup(suggest);
      const tab = ws.open(target, text);
      const error = (message: { number?: number; line?: number; text: string }) =>
        ws.handle("query.message", { queryId: api.executeQuery.mock.calls[0][0].queryId, kind: "error", elapsedMs: 1, ...message });
      return { ws, tab, error };
    }

    it("points a name error at the token and says where the statement starts", () => {
      const { ws, tab, error } = failing(script);
      ws.run(tab);
      error({ number: 208, line: 3, text: "Line 3: Invalid object name 'contracts'." });
      const [m] = tab.messages;
      expect(m.text).toBe("Line 5: Invalid object name 'contracts' (statement starts at line 3).");
      expect(script.slice(m.at!.start, m.at!.end)).toBe("contracts");
      expect(m.located).toBe(true);
    });

    it("maps a selection's lines to the editor's", () => {
      const text = "-- header\n\n" + script;
      const { ws, tab, error } = failing(text);
      ws.run(tab, script, text.indexOf("select 1"));
      error({ number: 208, line: 3, text: "Line 3: Invalid object name 'contracts'." });
      expect(tab.messages[0].text).toBe("Line 7: Invalid object name 'contracts' (statement starts at line 5).");
      expect(text.slice(tab.messages[0].at!.start, tab.messages[0].at!.end)).toBe("contracts");
    });

    it("keeps the reported line when the name is not found once", () => {
      const { ws, tab, error } = failing("select 1\n\nselect * from t a join t b on 1 = 1");
      ws.run(tab);
      error({ number: 208, line: 3, text: "Line 3: Invalid object name 't'." });
      error({ number: 102, line: 1, text: "Line 1: Incorrect syntax near 'x'." });
      expect(tab.messages.map((m) => [m.text, m.located, m.at])).toEqual([
        ["Line 3: Invalid object name 't'.", false, { start: 10, end: 10 }],
        ["Line 1: Incorrect syntax near 'x'.", false, { start: 0, end: 0 }],
      ]);
    });

    it("places nothing for an error without a script line", () => {
      const { ws, tab, error } = failing("exec p");
      ws.run(tab);
      error({ number: 208, text: "Procedure dbo.p, line 3: Invalid object name 'x'." });
      expect(tab.messages[0].at).toBeUndefined();
    });

    it("appends a suggestion and keeps it as a fix", async () => {
      const suggest = vi.fn(async (_: SuggestRequest) => ({ label: "dbo.Contracts", insertText: "dbo.Contracts" }));
      const { ws, tab, error } = failing(script, suggest);
      ws.run(tab);
      error({ number: 208, line: 3, text: "Line 3: Invalid object name 'contracts'." });
      await vi.waitFor(() => expect(tab.messages[0].fix).toBeDefined());
      expect(suggest.mock.calls[0][0]).toEqual({ number: 208, parts: ["contracts"], tables: [] });
      expect(tab.messages[0].text).toBe("Line 5: Invalid object name 'contracts' (statement starts at line 3). Did you mean dbo.Contracts?");
      expect(tab.messages[0].fix).toEqual({ label: "dbo.Contracts", insertText: "dbo.Contracts" });
    });

    it("leaves the message alone when there is no suggestion", async () => {
      const suggest = vi.fn(async (_: SuggestRequest) => undefined);
      const { ws, tab, error } = failing("select Nmae\nfrom dbo.Customer", suggest);
      ws.run(tab);
      error({ number: 207, line: 1, text: "Line 1: Invalid column name 'Nmae'." });
      await vi.waitFor(() => expect(suggest).toHaveBeenCalled());
      await Promise.resolve();
      expect(suggest.mock.calls[0][0]).toMatchObject({ number: 207, parts: ["Nmae"], tables: [{ name: "Customer", schema: "dbo" }] });
      expect(tab.messages[0].text).toBe("Line 1: Invalid column name 'Nmae'.");
      expect(tab.messages[0].fix).toBeUndefined();
    });

    it("asks the editor to reveal a message", () => {
      const { ws, tab, error } = failing(script);
      ws.run(tab);
      error({ number: 208, line: 3, text: "Line 3: Invalid object name 'contracts'." });
      ws.reveal(tab, tab.messages[0]);
      ws.reveal(tab, tab.messages[0]);
      expect(tab.reveal).toEqual({ id: tab.messages[0].id, seq: 2 });
    });

    describe("Postgres", () => {
      const pg = { ...target, language: "pgsql" as const };
      const pgScript = 'select 1;\n\nselect o.idd, "Order Lines".qty\nfrom sales."order" o';

      function failingPg(text: string) {
        const { ws, api } = setup();
        const tab = ws.open(pg, text);
        const error = (message: { state?: string; line?: number; column?: number; text: string }) =>
          ws.handle("query.message", { queryId: api.executeQuery.mock.calls[0][0].queryId, kind: "error", elapsedMs: 1, ...message });
        return { ws, tab, error };
      }

      it("marks the name at the server's line and column, dotted and quoted parts included", () => {
        const { ws, tab, error } = failingPg(pgScript);
        ws.run(tab);
        error({ state: "42703", line: 3, column: 8, text: "Line 3: column o.idd does not exist" });
        error({ state: "42P01", line: 3, column: 15, text: 'Line 3: missing FROM-clause entry for table "Order Lines"' });
        expect(tab.messages.map((m) => [pgScript.slice(m.at!.start, m.at!.end), m.located])).toEqual([
          ["o.idd", true],
          ['"Order Lines".qty', true],
        ]);
      });

      it("maps a selection's lines to the editor's", () => {
        const text = "-- header\n\n" + pgScript;
        const { ws, tab, error } = failingPg(text);
        ws.run(tab, pgScript, text.indexOf("select 1"));
        error({ state: "42703", line: 3, column: 8, text: "Line 3: column o.idd does not exist" });
        expect(tab.messages[0].text).toBe("Line 5: column o.idd does not exist");
        expect(text.slice(tab.messages[0].at!.start, tab.messages[0].at!.end)).toBe("o.idd");
      });

      it("marks the line's start when there is no column, and nothing without a line", () => {
        const { ws, tab, error } = failingPg("select 1;\n  select 1/0");
        ws.run(tab);
        error({ state: "22012", line: 2, text: "Line 2: division by zero" });
        error({ state: "P0001", text: "PL/pgSQL function f() line 3 at RAISE: boom" });
        expect(tab.messages.map((m) => [m.at, m.located])).toEqual([
          [{ start: 12, end: 12 }, false],
          [undefined, undefined],
        ]);
      });
    });
  });

  describe("What's new tab", () => {
    const sections = [
      { version: "0.2.13", date: "2026-10-29", body: "- Added: x" },
      { version: "0.2.12", date: "2026-10-28", body: "No user-facing changes." },
    ];

    it("is appended and made active without touching open query tabs", () => {
      const { ws } = setup();
      const query = ws.open(target, "SELECT 1");
      const tab = ws.openWhatsNew(sections, "launch");
      expect(ws.tabs.map((t) => t.kind)).toEqual(["query", "whats-new"]);
      expect(ws.active).toBe(tab);
      expect(tab.title).toBe("What's new");
      expect(query.text).toBe("SELECT 1");
    });

    it("is a singleton: opening again focuses it and updates its sections", () => {
      const { ws } = setup();
      ws.openWhatsNew(sections.slice(0, 1), "launch");
      ws.open(target, "");
      const again = ws.openWhatsNew(sections, "launch");
      expect(ws.tabs.filter((t) => t.kind === "whats-new")).toHaveLength(1);
      expect(ws.active).toBe(again);
      expect(again.sections).toHaveLength(2);
    });

    it("remembers whether it was opened on launch or from Settings", () => {
      const { ws } = setup();
      expect(ws.openWhatsNew(sections.slice(0, 1), "launch").opened).toBe("launch");
      expect(ws.openWhatsNew(sections, "settings").opened).toBe("settings");
    });

    it("closes like any tab", () => {
      const { ws } = setup();
      const tab = ws.openWhatsNew(sections, "launch");
      ws.close(tab.id);
      expect(ws.tabs).toHaveLength(0);
    });

    it("is never touched by query routing", async () => {
      const { ws, api, finish } = setup();
      const query = ws.open(target, "SELECT 1");
      ws.openWhatsNew(sections, "launch");
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

describe("QueryWorkspace: Problems tab", () => {
  const problem = (nodeId: string) => ({
    nodeId,
    env: "dev",
    connection: "orders",
    path: ["app"],
    error: { summary: "Login failed.", detail: "full", code: "18456", retryable: false },
    at: 1,
  });
  const ws = () => new QueryWorkspace({ executeQuery: vi.fn(), cancelQuery: vi.fn() });

  it("is a singleton titled with its count, focused on the asked-for entry", () => {
    const w = ws();
    const tab = w.openProblems([problem("a")]);
    expect(tab.title).toBe("Problems (1)");
    const again = w.openProblems([problem("a"), problem("b")], "b");
    expect(again).toBe(tab);
    expect(w.tabs.filter((t) => t.kind === "problems")).toHaveLength(1);
    expect(w.active).toBe(tab);
    expect(tab.title).toBe("Problems (2)");
    expect(tab.focus).toEqual({ nodeId: "b", seq: 1 });
    w.openProblems([problem("b")], "b");
    expect(tab.focus?.seq).toBe(2);
  });

  it("follows the tree's problems only while open", () => {
    const w = ws();
    w.setProblems([problem("a")]);
    expect(w.tabs).toHaveLength(0);
    const tab = w.openProblems([problem("a")]);
    w.setProblems([]);
    expect(tab.entries).toEqual([]);
    expect(tab.title).toBe("Problems (0)");
  });
});

describe("QueryWorkspace: IntelliSense", () => {
  const catalog = { stamp: "s", schemas: ["dbo"], objects: [], types: [] };

  function setupCatalog() {
    const api = {
      executeQuery: vi.fn(async (_: { queryId: string; database?: string }) => ({ queryId: "", resultSets: [], elapsedMs: 1, rolledBack: false, committed: false, cancelled: false })),
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

  it("Postgres tabs list databases but load no catalog until the pgsql dialect lands", async () => {
    const { ws, api } = setupCatalog();
    const tab = ws.open({ ...target, language: "pgsql" }, "");
    await settle();
    expect(api.catalogGet).not.toHaveBeenCalled();
    expect(tab.databases).toEqual(["Orders", "Sales"]);
    expect(ws.intellisense(tab)()).toBeUndefined();
    expect(ws.intellisenseStatus(tab).text).toBe("IntelliSense: not yet for Postgres");
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

  it("a name that is not a database is asked for once, and again after a refresh or DDL on its connection", async () => {
    const { ws, api } = setupCatalog();
    const tab = ws.open(target, "");
    await settle();
    const typo = () => api.catalogGet.mock.calls.filter((c) => c[1] === "Typo").length;
    const info = ws.intellisense(tab)()!;
    info.onMissing("Typo");
    await settle();
    // The sidecar answers "building" at once; opening the database then fails in the background.
    ws.handle("catalog.state", { key: "key:Typo", state: "error", message: "Cannot open database" });
    for (let i = 0; i < 5; i++) info.onMissing("Typo");
    await settle();
    expect(typo()).toBe(1);

    ws.refreshForNode("env:dev/conn:c1/db:Sales");
    info.onMissing("Typo");
    await settle();
    expect(typo()).toBe(1);
    ws.refreshForNode("env:dev/conn:c1");
    info.onMissing("Typo");
    await settle();
    expect(typo()).toBe(2);

    ws.handle("catalog.state", { key: "key:Typo", state: "error", message: "Cannot open database" });
    await ws.run(tab, "create database Typo");
    info.onMissing("Typo");
    await settle();
    expect(typo()).toBe(3);
    expect(ws.intellisense(tab)()!.keys.databases).toEqual({ orders: "key:node", typo: "key:Typo" });
  });

  it("a failed request is not remembered, so a timeout does not hide a database", async () => {
    const { ws, api } = setupCatalog();
    const tab = ws.open(target, "");
    await settle();
    api.catalogGet.mockRejectedValueOnce(new Error("Request timed out"));
    const info = ws.intellisense(tab)()!;
    info.onMissing("Sales");
    await settle();
    info.onMissing("Sales");
    await settle();
    expect(api.catalogGet.mock.calls.filter((c) => c[1] === "Sales")).toHaveLength(2);
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
