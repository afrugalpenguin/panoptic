import { describe, expect, it } from "vitest";
import type { TreeNode } from "../app/api";
import { TreeModel } from "../app/tree-model";
import { expandTargets, walkExpands } from "./expand";

const node = (id: string, kind: string, hasChildren = true, meta?: Record<string, string>): TreeNode => ({
  id,
  kind,
  label: id.split("/").pop()!.replace(/^\w+:/, ""),
  icon: kind,
  hasChildren,
  actions: [],
  meta,
});

const tree: Record<string, TreeNode[]> = {
  "": [node("env:test", "environment")],
  "env:test": [
    node("conn:local", "connection", true, { connectionKind: "sql", endpoint: "127.0.0.1,14333" }),
    node("conn:remote", "connection", true, { connectionKind: "sql", endpoint: "far.example.test" }),
    node("conn:broken", "connection", true, { connectionKind: "postgres", endpoint: "localhost:15432" }),
  ],
  "conn:local": [node("conn:local/db:master", "database", false), node("conn:local/db:Orders", "database")],
  "conn:local/db:Orders": [node("conn:local/db:Orders/f:tables", "folder")],
  "conn:local/db:Orders/f:tables": [node("conn:local/db:Orders/f:tables/o:dbo.t", "table", false)],
};

async function loaded() {
  const loads: string[] = [];
  const model = new TreeModel(async (id) => {
    loads.push(id);
    if (!tree[id]) throw new Error(`no route to ${id}`);
    return tree[id];
  }, () => {});
  await model.loadRoot();
  await model.preload(model.envIds());
  return { model, loads };
}

describe("expandTargets", () => {
  it("picks the connections on this machine", async () => {
    const { model } = await loaded();
    expect(expandTargets(model)).toEqual(["conn:local", "conn:broken"]);
  });
});

describe("walkExpands", () => {
  it("expands each level down the first expandable child, cold then warm", async () => {
    const { model, loads } = await loaded();
    let clock = 0;

    const steps = await walkExpands(model, ["conn:local"], async () => {}, () => (clock += 10));

    expect(steps.map((s) => [s.kind, s.path.join(" > "), s.children])).toEqual([
      ["connection", "local", 2],
      ["database", "local > Orders", 1],
      ["folder", "local > Orders > tables", 1],
    ]);
    expect(steps.every((s) => s.engine === "sql" && s.coldMs === 10 && s.warmMs === 10 && !s.error)).toBe(true);
    // Each level loads twice: the cold expand and the warm refresh.
    expect(loads.filter((id) => id === "conn:local")).toHaveLength(2);
  });

  it("records a failed expand and stops that connection", async () => {
    const { model } = await loaded();

    const steps = await walkExpands(model, ["conn:broken"], async () => {});

    expect(steps).toHaveLength(1);
    expect(steps[0].error).toContain("no route");
    expect(steps[0].warmMs).toBeUndefined();
  });
});
