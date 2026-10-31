import { describe, expect, it, vi } from "vitest";
import type { TreeNode } from "./api";
import { AbortError, RpcError } from "../rpc";
import { dropTarget, ENV_GAP, moveEnvironment, ROW_HEIGHT, selectableRow, TreeModel, UNGROUPED, type Row } from "./tree-model";

const node = (id: string, hasChildren = true, meta?: Record<string, string>): TreeNode => ({
  id,
  kind: "folder",
  label: id.split("/").pop()!,
  icon: "folder",
  hasChildren,
  actions: [],
  meta,
});

function fixture(children: Record<string, TreeNode[]>) {
  const load = vi.fn(async (id: string) => {
    const kids = children[id];
    if (!kids) throw new Error(`boom ${id}`);
    return kids;
  });
  const model = new TreeModel(load, () => {});
  return { model, load };
}

const labels = (model: TreeModel) => model.rows().map((r) => `${"  ".repeat(r.depth)}${r.type === "node" ? r.node.label : `<${r.type}>`}`);

describe("TreeModel", () => {
  it("loads the root and shows collapsed top-level nodes", async () => {
    const { model } = fixture({ "": [node("a"), node("b")] });
    await model.loadRoot();
    expect(labels(model)).toEqual(["a", "b"]);
  });

  it("loads children on first expand only, then serves them from cache", async () => {
    const { model, load } = fixture({ "": [node("a")], a: [node("a/x", false)] });
    await model.loadRoot();

    await model.toggle("a");
    expect(labels(model)).toEqual(["a", "  x"]);

    await model.toggle("a");
    await model.toggle("a");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shows a loading row while children are in flight", async () => {
    let release!: (n: TreeNode[]) => void;
    const model = new TreeModel(
      (id) => (id === "" ? Promise.resolve([node("a")]) : new Promise((r) => (release = r))),
      () => {},
    );
    await model.loadRoot();

    const pending = model.toggle("a");
    expect(labels(model)).toEqual(["a", "  <loading>"]);
    release([node("a/x", false)]);
    await pending;
    expect(labels(model)).toEqual(["a", "  x"]);
  });

  it("shows an error row when loading fails and retries on the next expand", async () => {
    const children: Record<string, TreeNode[]> = { "": [node("a")] };
    const { model } = fixture(children);
    await model.loadRoot();

    await model.toggle("a");
    expect(labels(model)).toEqual(["a", "  <error>"]);
    expect(model.rows()[1]).toMatchObject({ type: "error", error: { summary: "boom a", detail: "boom a", retryable: true } });

    children.a = [node("a/x", false)];
    await model.toggle("a");
    await model.toggle("a");
    expect(labels(model)).toEqual(["a", "  x"]);
  });

  describe("errors", () => {
    const denied = { summary: "No data-plane access.", detail: "403 full text", code: "403/5300", retryable: false };
    const env = (id: string): TreeNode => ({ ...node(id), kind: "environment", label: "dev", meta: { environmentId: "dev" } });
    const conn = (id: string): TreeNode => ({ ...node(id), kind: "connection", label: "orders", meta: { connectionKind: "cosmos" } });

    function failing() {
      const children: Record<string, TreeNode[]> = {
        "": [env("env:dev")],
        "env:dev": [conn("env:dev/conn:c1")],
        "env:dev/conn:c1": [{ ...node("env:dev/conn:c1/db:app"), kind: "database", label: "app" }],
      };
      const fail = new Set(["env:dev/conn:c1/db:app"]);
      const load = vi.fn(async (id: string) => {
        if (fail.has(id)) throw new RpcError(-32000, "raw", denied);
        return children[id] ?? [];
      });
      return { model: new TreeModel(load, () => {}), fail, children };
    }

    async function expandAll(model: TreeModel) {
      await model.loadRoot();
      await model.expand("env:dev");
      await model.expand("env:dev/conn:c1");
      await model.expand("env:dev/conn:c1/db:app");
    }

    it("keeps the sidecar's structured error on a leaf-height row and flags the parent", async () => {
      const { model } = failing();
      await expandAll(model);
      const rows = model.rows();
      expect(rows.at(-1)).toMatchObject({ type: "error", parentId: "env:dev/conn:c1/db:app", error: denied, rowKind: "leaf", height: ROW_HEIGHT.leaf });
      expect(rows.at(-2)).toMatchObject({ type: "node", error: denied });
      expect(rows.filter((r) => r.type === "node" && r.error)).toHaveLength(1);

      model.collapse("env:dev/conn:c1/db:app");
      expect(model.rows().at(-1)).toMatchObject({ type: "node", error: denied });
    });

    it("lists one problem per failed node with where it is", async () => {
      const { model } = failing();
      await expandAll(model);
      expect(model.problems()).toEqual([
        { nodeId: "env:dev/conn:c1/db:app", env: "dev", connection: "orders", path: ["app"], error: denied, at: expect.any(Number) },
      ]);
    });

    it("keeps the problem while a retry loads, and clears it when the node loads", async () => {
      const { model, fail } = failing();
      await expandAll(model);
      fail.delete("env:dev/conn:c1/db:app");
      const retry = model.refresh("env:dev/conn:c1/db:app");
      expect(model.problems()).toHaveLength(1);
      await retry;
      expect(model.problems()).toEqual([]);
    });

    it("clears the problem when its connection is removed", async () => {
      const { model, children } = failing();
      await expandAll(model);
      children["env:dev"] = [];
      await model.reload("env:dev");
      expect(model.problems()).toEqual([]);
    });

    it("forgetConnections drops subtrees and their problems, keeps environments open, and reloads on expand", async () => {
      const { model, fail } = failing();
      await expandAll(model);
      fail.delete("env:dev/conn:c1/db:app");
      model.forgetConnections();
      expect(labels(model)).toEqual(["dev", "  orders"]);
      expect(model.rows()[1]).toMatchObject({ type: "node", expanded: false, loading: false });
      expect(model.problems()).toEqual([]);

      await model.expand("env:dev/conn:c1");
      await model.expand("env:dev/conn:c1/db:app");
      expect(labels(model)).toEqual(["dev", "  orders", "    app", "      <empty>"]);
    });
  });

  it("shows an empty row for a node with no children", async () => {
    const { model } = fixture({ "": [node("a")], a: [] });
    await model.loadRoot();
    await model.toggle("a");
    expect(labels(model)).toEqual(["a", "  <empty>"]);
  });

  it("refresh reloads a subtree and keeps it expanded", async () => {
    const children: Record<string, TreeNode[]> = { "": [node("a")], a: [node("a/x", false)] };
    const { model, load } = fixture(children);
    await model.loadRoot();
    await model.toggle("a");

    children.a = [node("a/x", false), node("a/y", false)];
    await model.refresh("a");
    expect(labels(model)).toEqual(["a", "  x", "  y"]);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("carries the environment colour down to every descendant", async () => {
    const { model } = fixture({
      "": [{ ...node("env:dev"), kind: "environment", meta: { color: "#123456", readOnly: "true" } }],
      "env:dev": [node("env:dev/conn:x", false)],
    });
    await model.loadRoot();
    await model.toggle("env:dev");
    expect(model.rows().map((r) => r.envColor)).toEqual(["#123456", "#123456"]);
    expect(model.rows().map((r) => r.readOnly)).toEqual([true, true]);
  });

  it("marks children stale after the configured age", async () => {
    vi.useFakeTimers();
    const model = new TreeModel(async (id) => (id === "" ? [node("a")] : [node("a/x", false)]), () => {}, 1000);
    await model.loadRoot();
    await model.toggle("a");
    expect(model.isStale("a")).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(model.isStale("a")).toBe(true);
    vi.useRealTimers();
  });

  it("reports load time and item count for the status bar", async () => {
    const onLoaded = vi.fn();
    const model = new TreeModel(async (id) => (id === "" ? [node("a")] : [node("a/x", false)]), () => {}, undefined, onLoaded);
    await model.loadRoot();
    await model.toggle("a");
    expect(onLoaded).toHaveBeenLastCalledWith(expect.objectContaining({ id: "a", count: 1 }));
    expect(onLoaded.mock.lastCall![0].ms).toBeGreaterThanOrEqual(0);
  });

  it("finds the parent of a node", async () => {
    const { model } = fixture({ "": [node("a")], a: [node("a/x", false)] });
    await model.loadRoot();
    await model.toggle("a");
    expect(model.parentOf("a/x")).toBe("a");
    expect(model.parentOf("a")).toBe("");
  });

  it("reload refetches one level but keeps loaded descendants", async () => {
    const children: Record<string, TreeNode[]> = { "": [node("a")], a: [node("a/x")], "a/x": [node("a/x/1", false)] };
    const { model, load } = fixture(children);
    await model.loadRoot();
    await model.toggle("a");
    await model.toggle("a/x");

    children.a = [node("a/x"), node("a/y", false)];
    await model.reload("a");
    expect(labels(model)).toEqual(["a", "  x", "    1", "  y"]);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("precomputes label segments for connections and leaves when they load", async () => {
    const conn = (id: string, endpoint: string, kind = "sql"): TreeNode => ({
      id,
      kind: "connection",
      label: "display name",
      icon: kind,
      hasChildren: true,
      actions: [],
      meta: { endpoint, connectionKind: kind, connectionId: id },
    });
    const { model } = fixture({
      "": [{ ...node("env:dev"), kind: "environment", meta: { environmentId: "dev", color: "#000" } }],
      "env:dev": [conn("env:dev/conn:a", "acmedwhuat.database.windows.net"), conn("env:dev/conn:b", "acmedwhdev.database.windows.net")],
      "env:dev/conn:a": [{ ...node("env:dev/conn:a/o"), kind: "table", label: "dbo.Customer", meta: { schema: "dbo", name: "Customer" } }],
    });
    await model.loadRoot();
    await model.toggle("env:dev");
    await model.toggle("env:dev/conn:a");

    const byKey = Object.fromEntries(model.rows().map((r) => [r.key, r.type === "node" ? r.label : undefined]));
    expect(byKey["env:dev/conn:a"]).toEqual({ prefix: "acmedwh", core: "uat", suffix: ".database.windows.net" });
    expect(byKey["env:dev/conn:a/o"]).toEqual({ prefix: "dbo.", core: "Customer", suffix: "" });
    expect(byKey["env:dev"]).toEqual({ prefix: "", core: "env:dev", suffix: "" });
  });

  it("rebuilds labels without connections that were removed", async () => {
    const conn = (id: string, endpoint: string): TreeNode => ({
      id, kind: "connection", label: id, icon: "sql", hasChildren: true, actions: [], meta: { endpoint, connectionKind: "sql" },
    });
    const children: Record<string, TreeNode[]> = {
      "": [{ ...node("env:dev"), kind: "environment", meta: { environmentId: "dev" } }],
      "env:dev": [conn("a", "orders-uat.x.com"), conn("b", "orders-dev.x.com"), conn("c", "billing-dev.x.com")],
    };
    const { model } = fixture(children);
    await model.loadRoot();
    await model.toggle("env:dev");
    children["env:dev"] = children["env:dev"].filter((n) => n.id !== "c");
    await model.reload("env:dev");

    const a = model.rows().find((r) => r.key === "a");
    expect(a?.type === "node" && a.label).toEqual({ prefix: "orders-", core: "uat", suffix: ".x.com" });
  });

  describe("cancel", () => {
    /** Like the real RPC client: a load never settles on its own and rejects with an AbortError when aborted. */
    function hanging(fail = new Set<string>()) {
      const signals = new Map<string, AbortSignal>();
      const load = vi.fn((id: string, signal: AbortSignal) => {
        signals.set(id, signal);
        if (id === "") return Promise.resolve([node("a")]);
        if (fail.has(id)) return Promise.reject(new Error(`boom ${id}`));
        return new Promise<TreeNode[]>((_, reject) => signal.addEventListener("abort", () => reject(new AbortError("tree.children"))));
      });
      const loaded: { error?: string }[] = [];
      const model = new TreeModel(load, () => {}, undefined, (r) => loaded.push(r));
      return { model, load, signals, loaded, fail };
    }

    it("collapsing a node that is loading aborts its load, with no error row, problem or status error", async () => {
      const { model, signals, loaded } = hanging();
      await model.loadRoot();
      loaded.length = 0;

      const pending = model.toggle("a");
      expect(labels(model)).toEqual(["a", "  <loading>"]);
      model.toggle("a");
      await pending;

      expect(signals.get("a")!.aborted).toBe(true);
      expect(labels(model)).toEqual(["a"]);
      expect(model.rows()[0]).toMatchObject({ type: "node", loading: false, error: undefined });
      expect(model.problems()).toEqual([]);
      expect(model.inFlight()).toEqual([]);
      expect(loaded).toEqual([]);
    });

    it("expanding again after a cancelled load starts a fresh one", async () => {
      const { model, load } = hanging();
      await model.loadRoot();
      const first = model.toggle("a");
      model.collapse("a");
      await first;

      void model.toggle("a");
      expect(labels(model)).toEqual(["a", "  <loading>"]);
      expect(load).toHaveBeenCalledTimes(3);
    });

    it("cancel from the status bar collapses the node and stops its load", async () => {
      const { model, signals } = hanging();
      await model.loadRoot();
      const pending = model.toggle("a");
      model.cancel(model.inFlight()[0].id);
      await pending;

      expect(signals.get("a")!.aborted).toBe(true);
      expect(model.isExpanded("a")).toBe(false);
      expect(labels(model)).toEqual(["a"]);
    });

    it("a cancelled retry leaves the earlier failure in place", async () => {
      const { model, fail } = hanging(new Set(["a"]));
      await model.loadRoot();
      await model.toggle("a");
      expect(model.problems()).toHaveLength(1);

      fail.delete("a");
      model.collapse("a");
      const retry = model.toggle("a");
      model.collapse("a");
      await retry;

      expect(model.rows()[0]).toMatchObject({ type: "node", error: { summary: "boom a" } });
      expect(model.problems()).toHaveLength(1);
    });

    it("collapse all aborts the loads of the nodes it collapses", async () => {
      const { model, signals } = hanging();
      await model.loadRoot();
      const pending = model.toggle("a");
      model.collapseAll();
      await pending;
      expect(signals.get("a")!.aborted).toBe(true);
      expect(model.inFlight()).toEqual([]);
    });
  });

  describe("layout", () => {
    const conn = (id: string, kind = "sql"): TreeNode => ({
      id, kind: "connection", label: id, icon: kind, hasChildren: true, actions: [],
      meta: { endpoint: `${id}.x.com`, connectionKind: kind, connectionId: id },
    });
    const env = (id: string, color: string): TreeNode => ({
      ...node(id), kind: "environment", label: id, meta: { environmentId: id, color, connectionCount: "2" },
    });

    async function loaded() {
      const { model } = fixture({
        "": [env("dev", "#2f9e44"), env("prod", "#e03131")],
        dev: [conn("dev/a"), conn("dev/b", "cosmos")],
        prod: [conn("prod/a")],
        "dev/a": [{ ...node("dev/a/f"), kind: "folder", label: "Tables" }],
        "dev/a/f": [{ ...node("dev/a/f/t", false), kind: "table", label: "dbo.Orders" }],
        "dev/b": [{ ...node("dev/b/c", false), kind: "container", label: "orders", meta: { partitionKey: "/tenantId" } }],
      });
      await model.loadRoot();
      for (const id of ["dev", "prod", "dev/a", "dev/a/f", "dev/b"]) await model.toggle(id);
      return model;
    }

    it("classifies rows and gives each its fixed height", async () => {
      const rows = (await loaded()).rows();
      expect(rows.map((r) => [r.key, r.rowKind, r.height])).toEqual([
        ["dev", "header", ROW_HEIGHT.header],
        ["dev/a", "connection", ROW_HEIGHT.connection],
        ["dev/a/f", "folder", ROW_HEIGHT.folder],
        ["dev/a/f/t", "leaf", ROW_HEIGHT.leaf],
        ["dev/b", "connection", ROW_HEIGHT.connection],
        ["dev/b/c", "leaf", ROW_HEIGHT.leaf],
        ["prod", "header", ROW_HEIGHT.header],
        ["prod/a", "connection", ROW_HEIGHT.connection],
      ]);
    });

    it("lays rows out by summing heights, with a gap before every env group after the first", async () => {
      const rows = (await loaded()).rows();
      const prod = rows.find((r) => r.key === "prod")!;
      const beforeProd = rows.slice(0, rows.indexOf(prod)).reduce((sum, r) => sum + r.height, 0);
      expect(rows[0].top).toBe(0);
      expect(rows[0].gapBefore).toBe(0);
      expect(prod.gapBefore).toBe(ENV_GAP);
      expect(prod.top).toBe(beforeProd + ENV_GAP);
    });

    it("carries env, indent, badge, count and secondary text precomputed", async () => {
      type NodeRow = Extract<ReturnType<TreeModel["rows"]>[number], { type: "node" }>;
      const rows = Object.fromEntries(
        (await loaded())
          .rows()
          .filter((r): r is NodeRow => r.type === "node")
          .map((r) => [r.key, r]),
      );
      expect(rows["dev/a/f/t"].envId).toBe("dev");
      expect([rows["dev/a"].indent, rows["dev/a/f"].indent, rows["dev/a/f/t"].indent]).toEqual([30, 50, 70]);
      expect(rows["dev/b"].badge).toEqual({ letters: "C", color: "#1f7a74", name: "Cosmos" });
      expect(rows["dev"].count).toBe(2);
      expect(rows["dev/a/f"].count).toBe(1);
      expect(rows["dev/b/c"].secondary).toBe("/tenantId");
    });

    it("marks a connection whose certificate is not checked, except on this machine and for Cosmos", async () => {
      const trusting = (id: string, endpoint: string, kind = "sql"): TreeNode => ({
        id, kind: "connection", label: id, icon: kind, hasChildren: true, actions: [],
        meta: { endpoint, connectionKind: kind, connectionId: id, trustServerCertificate: "true" },
      });
      const { model } = fixture({
        "": [env("dev", "#2f9e44")],
        dev: [
          trusting("remote", "orders.fabrikam.test"),
          trusting("local", "127.0.0.1,14333"),
          trusting("emulator", "https://localhost:8081", "cosmos"),
          conn("checked"),
        ],
      });
      await model.loadRoot();
      await model.toggle("dev");
      const flags = Object.fromEntries(
        model.rows().filter((r) => r.type === "node" && r.rowKind === "connection").map((r) => [r.key, r.type === "node" && r.certificateUnchecked === true]),
      );
      expect(flags).toEqual({ remote: true, local: false, emulator: false, checked: false });
    });
  });

  describe("engine and text filters", () => {
    const conn = (id: string, kind: string): TreeNode => ({
      id, kind: "connection", label: id, icon: kind, hasChildren: true, actions: [],
      meta: { endpoint: `${id}.x.com`, connectionKind: kind },
    });
    const env = (id: string): TreeNode => ({ ...node(id), kind: "environment", label: id, meta: { environmentId: id, connectionCount: "9" } });

    async function loaded() {
      const { model } = fixture({
        "": [env("dev"), env("prod")],
        dev: [conn("dev/s1", "sql"), conn("dev/s2", "sql"), conn("dev/c1", "cosmos")],
        prod: [conn("prod/s1", "sql")],
      });
      await model.loadRoot();
      await model.preload(["dev", "prod"]);
      return model;
    }

    it("preloads connection lists without expanding", async () => {
      const model = await loaded();
      expect(model.rows().map((r) => r.key)).toEqual(["dev", "prod"]);
    });

    it("derives engines from the loaded connections", async () => {
      expect((await loaded()).engines()).toEqual([
        { kind: "sql", badge: { letters: "S", color: "#2d5aa0", name: "SQL" }, count: 3 },
        { kind: "cosmos", badge: { letters: "C", color: "#1f7a74", name: "Cosmos" }, count: 1 },
      ]);
    });

    it("hides engines, hides environments left with none, and counts what is shown", async () => {
      const model = await loaded();
      await model.toggle("dev");
      await model.toggle("prod");
      model.setHiddenEngines(["sql"]);
      const rows = model.rows();
      expect(rows.map((r) => r.key)).toEqual(["dev", "dev/c1"]);
      expect(rows[0].type === "node" && rows[0].count).toBe(1);

      model.setHiddenEngines([]);
      expect(model.rows().map((r) => r.key)).toEqual(["dev", "dev/s1", "dev/s2", "dev/c1", "prod", "prod/s1"]);
    });

    it("keeps several engines on at once", async () => {
      const model = await loaded();
      await model.toggle("dev");
      model.setHiddenEngines(["cosmos"]);
      expect(model.rows().map((r) => r.key)).toEqual(["dev", "dev/s1", "dev/s2", "prod"]);
      model.setHiddenEngines(["cosmos", "sql"]);
      expect(model.rows().map((r) => r.key)).toEqual([]);
    });

    it("forgets a hidden engine once no connection has it", async () => {
      const model = await loaded();
      model.setHiddenEngines(["cosmos", "mongo"]);
      expect([...model.hiddenEngines()]).toEqual(["cosmos"]);
    });

    it("text filter matches endpoint or environment name, substring, ignoring case, and expands nothing", async () => {
      const model = await loaded();
      await model.toggle("dev");
      model.setTextFilter("S2.X");
      expect(model.rows().map((r) => r.key)).toEqual(["dev", "dev/s2"]);
      expect(model.rows()[0]).toMatchObject({ count: 1 });

      // Environment name: every connection in it matches, but a collapsed environment stays collapsed.
      model.setTextFilter("PRO");
      expect(model.rows().map((r) => r.key)).toEqual(["prod"]);
      expect(model.rows()[0]).toMatchObject({ count: 1 });

      model.setTextFilter("nothing-like-this");
      expect(model.rows()).toEqual([]);
      model.setTextFilter("");
      expect(model.rows().map((r) => r.key)).toEqual(["dev", "dev/s1", "dev/s2", "dev/c1", "prod"]);
    });

    it("text and engine filters combine", async () => {
      const model = await loaded();
      await model.toggle("dev");
      model.setTextFilter("dev");
      model.setHiddenEngines(["sql"]);
      expect(model.rows().map((r) => r.key)).toEqual(["dev", "dev/c1"]);
    });

    it("filtering reads the built model: no loads and no new label build", async () => {
      const { model, load } = fixture({
        "": [env("dev"), env("prod")],
        dev: [conn("dev/s1", "sql"), conn("dev/c1", "cosmos")],
        prod: [conn("prod/s1", "sql")],
      });
      await model.loadRoot();
      await model.preload(["dev", "prod"]);
      const calls = load.mock.calls.length;
      const engines = model.engines();
      model.setTextFilter("s1");
      model.setHiddenEngines(["cosmos"]);
      model.rows();
      expect(load.mock.calls.length).toBe(calls);
      expect(model.engines()).toBe(engines);
    });

    it("summarises environments and connections, and what matches when anything is hidden", async () => {
      const model = await loaded();
      expect(model.summary()).toEqual({ environments: 2, connections: 4, matching: 4 });
      model.setTextFilter("dev");
      expect(model.summary()).toEqual({ environments: 2, connections: 4, matching: 3 });
      model.setHiddenEngines(["cosmos"]);
      expect(model.summary()).toEqual({ environments: 2, connections: 4, matching: 2 });
    });
  });

  it("drops a deleted environment's connections from the engines", async () => {
    const conn = (id: string, kind: string): TreeNode => ({
      id, kind: "connection", label: id, icon: kind, hasChildren: true, actions: [], meta: { endpoint: `${id}.x.com`, connectionKind: kind },
    });
    const env = (id: string): TreeNode => ({ ...node(id), kind: "environment", label: id, meta: { environmentId: id } });
    const children: Record<string, TreeNode[]> = { "": [env("dev"), env("old")], dev: [conn("dev/s", "sql")], old: [conn("old/c", "cosmos")] };
    const { model } = fixture(children);
    await model.loadRoot();
    await model.preload(["dev", "old"]);
    expect(model.engines().map((k) => k.kind)).toEqual(["sql", "cosmos"]);

    children[""] = [env("dev")];
    await model.reload("");
    expect(model.engines().map((k) => k.kind)).toEqual(["sql"]);
  });

  it("orders environments by explorer.envOrder, the rest in order added, with one change notification", async () => {
    const env = (id: string): TreeNode => ({ ...node(id), kind: "environment", label: id, meta: { environmentId: id.slice(4) } });
    const onChange = vi.fn();
    const model = new TreeModel(async (id) => (id === "" ? [env("env:a"), env("env:b"), env("env:c")] : []), onChange);
    await model.loadRoot();
    onChange.mockClear();

    model.setEnvOrder(["c", "missing", "a"]);

    expect(model.rows().map((r) => r.key)).toEqual(["env:c", "env:a", "env:b"]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  describe("expand and collapse all", () => {
    const conn = (id: string): TreeNode => ({ ...node(id), kind: "connection", meta: { endpoint: `${id}.x.com`, connectionKind: "sql" } });
    const env = (id: string): TreeNode => ({ ...node(id), kind: "environment", meta: { environmentId: id } });

    async function loaded() {
      const { model, load } = fixture({
        "": [env("dev"), env("prod"), { ...env("empty"), hasChildren: false }],
        dev: [conn("dev/a"), conn("dev/b")],
        prod: [conn("prod/a")],
        "dev/a": [node("dev/a/db", false)],
      });
      await model.loadRoot();
      return { model, load };
    }

    it("expand all opens every environment as far as its connections, without calling a server", async () => {
      const { model, load } = await loaded();
      await model.toggle("dev");
      await model.toggle("dev/a");

      await model.expandEnvironments();

      expect(labels(model)).toEqual(["dev", "  a", "  b", "prod", "  a", "empty", "  <env-empty>"]);
      expect(load.mock.calls.map(([id]) => id)).toEqual(["", "dev", "dev/a", "prod"]);
    });

    it("collapse all closes every node with one change notification", async () => {
      const onChange = vi.fn();
      const kids: Record<string, TreeNode[]> = { "": [env("dev")], dev: [conn("dev/a")], "dev/a": [node("dev/a/db", false)] };
      const model = new TreeModel(async (id) => kids[id], onChange);
      await model.loadRoot();
      await model.toggle("dev");
      await model.toggle("dev/a");
      onChange.mockClear();

      model.collapseAll();

      expect(labels(model)).toEqual(["dev"]);
      expect(onChange).toHaveBeenCalledTimes(1);
      await model.toggle("dev");
      expect(labels(model)).toEqual(["dev", "  a"]);
    });
  });

  it("focus expands one environment (and a connection in it) and collapses the others", async () => {
    const { model } = fixture({ "": [node("env:a"), node("env:b")], "env:a": [node("env:a/conn:x")], "env:b": [], "env:a/conn:x": [] });
    await model.loadRoot();
    await model.expand("env:a");
    await model.expand("env:b");
    await model.focus("env:a", "env:a/conn:x");
    expect(model.isExpanded("env:a")).toBe(true);
    expect(model.isExpanded("env:a/conn:x")).toBe(true);
    expect(model.isExpanded("env:b")).toBe(false);
  });
});

describe("connections without an environment", () => {
  const conn = (id: string, kind = "sql"): TreeNode => ({
    id, kind: "connection", label: id, icon: kind, hasChildren: true, actions: [],
    meta: { endpoint: `${id}-srv.x.com`, connectionKind: kind, connectionId: id.slice(5) },
  });
  const env = (id: string, count: number): TreeNode => ({
    ...node(id, count > 0), kind: "environment", label: id.slice(4), meta: { environmentId: id.slice(4), color: "#2f9e44", connectionCount: String(count) },
  });
  type NodeRow = Extract<Row, { type: "node" }>;
  const byKey = (rows: Row[]) => Object.fromEntries(rows.map((r) => [r.key, r]));

  async function flat() {
    const f = fixture({ "": [conn("conn:a"), conn("conn:b")], "conn:a": [node("conn:a/db:x", false)] });
    await f.model.loadRoot();
    return f;
  }

  async function mixed() {
    const f = fixture({
      "": [env("env:dev", 1), env("env:empty", 0), conn("conn:a"), conn("conn:b", "cosmos")],
      "env:dev": [conn("conn:c")],
      "conn:a": [node("conn:a/db:x", false)],
    });
    await f.model.loadRoot();
    await f.model.preload(f.model.envIds());
    return f;
  }

  it("with no environments, lists them flat at the root with no header and no environment colour", async () => {
    const { model } = await flat();
    await model.expand("conn:a");
    const rows = model.rows();
    expect(labels(model)).toEqual(["conn:a", "  db:x", "conn:b"]);
    expect(rows.map((r) => [r.key, r.rowKind, r.indent, r.loose])).toEqual([
      ["conn:a", "connection", 10, true],
      ["conn:a/db:x", "folder", 30, true],
      ["conn:b", "connection", 10, true],
    ]);
    expect(rows.every((r) => r.envColor === undefined && r.gapBefore === 0)).toBe(true);
  });

  it("with environments, puts them last under a dimmed Ungrouped header, and an empty environment gets a hint row", async () => {
    const { model } = await mixed();
    await model.expand("env:dev");
    const rows = model.rows();
    expect(rows.map((r) => `${"  ".repeat(r.depth)}${r.type === "node" ? r.node.label : `<${r.type}>`}`)).toEqual([
      "dev",
      "  conn:c",
      "empty",
      "  <env-empty>",
      "<group>",
      "  conn:a",
      "  conn:b",
    ]);
    const k = byKey(rows);
    expect(k[UNGROUPED]).toMatchObject({ type: "group", rowKind: "header", gapBefore: ENV_GAP, count: 2, expanded: true, loose: true });
    expect(k["conn:a"]).toMatchObject({ depth: 1, indent: 30, loose: true, envColor: undefined, envId: UNGROUPED });
    expect(k["env:empty#empty"]).toMatchObject({ type: "env-empty", parentId: "env:empty", rowKind: "leaf" });
    expect(selectableRow(k["env:empty#empty"])).toBe(false);
    expect(selectableRow(k[UNGROUPED])).toBe(true);
    expect((k["conn:c"] as NodeRow).loose).toBe(false);
  });

  it("collapses and expands the Ungrouped group without loading anything", async () => {
    const { model, load } = await mixed();
    const calls = load.mock.calls.length;
    expect(model.isExpanded(UNGROUPED)).toBe(true);
    await model.toggle(UNGROUPED);
    expect(labels(model)).toEqual(["dev", "empty", "  <env-empty>", "<group>"]);
    await model.toggle(UNGROUPED);
    expect(labels(model)).toEqual(["dev", "empty", "  <env-empty>", "<group>", "  conn:a", "  conn:b"]);
    expect(load.mock.calls.length).toBe(calls);
  });

  it("filters by engine: the group needs a loose connection of a shown engine, an empty environment always hides", async () => {
    const { model } = await mixed();
    model.setHiddenEngines(["sql"]);
    expect(labels(model)).toEqual(["<group>", "  conn:b"]);
    expect(byKey(model.rows())[UNGROUPED]).toMatchObject({ count: 1 });
    model.setHiddenEngines(["cosmos"]);
    expect(labels(model)).toEqual(["dev", "<group>", "  conn:a"]);
  });

  it("filters loose connections by text; no environment name to match, an empty environment always hides", async () => {
    const { model } = await mixed();
    model.setTextFilter("conn:b");
    expect(labels(model)).toEqual(["<group>", "  conn:b"]);
    model.setTextFilter("empty");
    expect(labels(model)).toEqual([]);
    expect(model.summary()).toEqual({ environments: 2, connections: 3, matching: 0 });
  });

  it("orders environments by envOrder and keeps the group last", async () => {
    const { model } = await mixed();
    model.setEnvOrder(["empty", "dev"]);
    expect(labels(model)).toEqual(["empty", "  <env-empty>", "dev", "<group>", "  conn:a", "  conn:b"]);
  });

  it("envIds lists environments only; expand all opens them and the group, never a loose connection", async () => {
    const { model, load } = await mixed();
    expect(model.envIds()).toEqual(["env:dev", "env:empty"]);
    await model.toggle(UNGROUPED);
    await model.expandEnvironments();
    expect(model.isExpanded(UNGROUPED)).toBe(true);
    expect(model.isExpanded("conn:a")).toBe(false);
    expect(load.mock.calls.map(([id]) => id)).not.toContain("conn:a");
  });

  it("forgetConnections drops what was loaded below loose connections", async () => {
    const { model, load } = await mixed();
    await model.expand("conn:a");
    model.forgetConnections();
    expect(model.isExpanded("conn:a")).toBe(false);
    await model.expand("conn:a");
    expect(load.mock.calls.filter(([id]) => id === "conn:a")).toHaveLength(2);
  });

  it("focus with no environment opens the group and the connection, and focusing an environment closes the group", async () => {
    const { model } = await mixed();
    await model.expand("env:dev");
    await model.toggle(UNGROUPED);
    await model.focus(undefined, "conn:a");
    expect(model.isExpanded("env:dev")).toBe(false);
    expect(model.isExpanded(UNGROUPED)).toBe(true);
    expect(model.isExpanded("conn:a")).toBe(true);
    await model.focus("env:dev");
    expect(model.isExpanded(UNGROUPED)).toBe(false);
    expect(model.isExpanded("env:dev")).toBe(true);
  });

  it("works out labels across grouped and loose connections alike", async () => {
    const { model } = await mixed();
    const k = byKey(model.rows()) as Record<string, NodeRow>;
    const { prefix, core, suffix } = k["conn:a"].label;
    // Computed from the endpoint (a fallback would be the plain node label), so the loose connection took part.
    expect(prefix + core + suffix).toBe("conn:a-srv.x.com");
    expect(core).not.toBe("conn:a");
  });

  it("reveal opens where a moved connection landed: its environment, even one that was empty, or Ungrouped", async () => {
    const kids: Record<string, TreeNode[]> = {
      "": [env("env:dev", 1), env("env:empty", 0), conn("conn:a"), conn("conn:b", "cosmos")],
      "env:dev": [conn("conn:c")],
    };
    const { model } = fixture(kids);
    await model.loadRoot();
    await model.toggle(UNGROUPED);

    // conn:a moves into the empty environment; the app reloads config, then reveals the target.
    kids[""] = [env("env:dev", 1), env("env:empty", 1), conn("conn:b", "cosmos")];
    kids["env:empty"] = [conn("conn:a")];
    await model.reload("");
    await model.reveal("empty");
    expect(labels(model)).toEqual(["dev", "empty", "  conn:a", "<group>"]);

    await model.reveal(null);
    expect(model.isExpanded(UNGROUPED)).toBe(true);
    await model.reveal("gone");
    expect(model.isExpanded("env:dev")).toBe(false);
  });

  it("dropTarget: a header or its empty row means that environment, the group means none, anything else is not a target", async () => {
    const { model } = await mixed();
    await model.expand("env:dev");
    const k = byKey(model.rows());
    expect(dropTarget(k["env:dev"])).toBe("dev");
    expect(dropTarget(k["env:empty#empty"])).toBe("empty");
    expect(dropTarget(k[UNGROUPED])).toBeNull();
    expect(dropTarget(k["conn:a"])).toBeUndefined();
    expect(dropTarget(k["conn:c"])).toBeUndefined();
  });
});

describe("moveEnvironment", () => {
  const known = ["a", "b", "c"];

  it("moves within the display order: saved order first, then the rest in order added", () => {
    expect(moveEnvironment([], known, "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveEnvironment(["c"], known, "c", 1)).toEqual(["a", "c", "b"]);
  });

  it("drops ids of environments that no longer exist", () => {
    expect(moveEnvironment(["gone", "c", "a"], known, "a", -1)).toEqual(["a", "c", "b"]);
  });

  it("leaves the order alone at either end or for an unknown id", () => {
    expect(moveEnvironment([], known, "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveEnvironment([], known, "c", 1)).toEqual(["a", "b", "c"]);
    expect(moveEnvironment([], known, "zz", 1)).toEqual(["a", "b", "c"]);
  });
});
