import { describe, expect, it, vi } from "vitest";
import type { TreeNode } from "./api";
import { RpcError } from "../rpc";
import { ENV_GAP, moveEnvironment, ROW_HEIGHT, TreeModel } from "./tree-model";

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
  });

  describe("kind filter", () => {
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

    it("derives chips from the loaded connections", async () => {
      expect((await loaded()).kinds()).toEqual([
        { kind: "sql", badge: { letters: "S", color: "#2d5aa0", name: "SQL" }, count: 3 },
        { kind: "cosmos", badge: { letters: "C", color: "#1f7a74", name: "Cosmos" }, count: 1 },
      ]);
    });

    it("filters to one kind, hides environments with none, and counts what is shown", async () => {
      const model = await loaded();
      await model.toggle("dev");
      await model.toggle("prod");
      model.setKindFilter("cosmos");
      const rows = model.rows();
      expect(rows.map((r) => r.key)).toEqual(["dev", "dev/c1"]);
      expect(rows[0].type === "node" && rows[0].count).toBe(1);

      model.setKindFilter(undefined);
      expect(model.rows().map((r) => r.key)).toEqual(["dev", "dev/s1", "dev/s2", "dev/c1", "prod", "prod/s1"]);
    });
  });

  it("drops a deleted environment's connections from the kind chips", async () => {
    const conn = (id: string, kind: string): TreeNode => ({
      id, kind: "connection", label: id, icon: kind, hasChildren: true, actions: [], meta: { endpoint: `${id}.x.com`, connectionKind: kind },
    });
    const env = (id: string): TreeNode => ({ ...node(id), kind: "environment", label: id, meta: { environmentId: id } });
    const children: Record<string, TreeNode[]> = { "": [env("dev"), env("old")], dev: [conn("dev/s", "sql")], old: [conn("old/c", "cosmos")] };
    const { model } = fixture(children);
    await model.loadRoot();
    await model.preload(["dev", "old"]);
    expect(model.kinds().map((k) => k.kind)).toEqual(["sql", "cosmos"]);

    children[""] = [env("dev")];
    await model.reload("");
    expect(model.kinds().map((k) => k.kind)).toEqual(["sql"]);
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

      expect(labels(model)).toEqual(["dev", "  a", "  b", "prod", "  a", "empty"]);
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
