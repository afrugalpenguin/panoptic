import { describe, expect, it, vi } from "vitest";
import type { TreeNode } from "./api";
import { TreeModel } from "./tree-model";

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
    expect(model.rows()[1]).toMatchObject({ type: "error", message: "boom a" });

    children.a = [node("a/x", false)];
    await model.toggle("a");
    await model.toggle("a");
    expect(labels(model)).toEqual(["a", "  x"]);
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
});
