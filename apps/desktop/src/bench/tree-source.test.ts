import { describe, expect, it } from "vitest";
import { TreeModel } from "../app/tree-model";
import { generateTree } from "./data";
import { openAll, treeSource } from "./tree-source";

describe("treeSource", () => {
  const tree = generateTree(2_000);

  it("serves the generated tree to the shipped TreeModel, environments first", async () => {
    const source = treeSource(tree);
    const model = new TreeModel(source.load, () => {});
    await model.loadRoot();

    const rows = model.rows();
    expect(rows.every((r) => r.type === "node" && r.node.kind === "environment")).toBe(true);
    expect(model.envIds()).toHaveLength(rows.length);
  });

  it("opens every node, so the model shows the whole tree", async () => {
    const source = treeSource(tree);
    const model = new TreeModel(source.load, () => {});
    await model.loadRoot();

    await openAll(model, source);

    expect(model.rows().filter((r) => r.type === "node")).toHaveLength(tree.count);
  });

  it("can leave chosen nodes closed", async () => {
    const source = treeSource(tree);
    const model = new TreeModel(source.load, () => {});
    await model.loadRoot();
    const folder = source.lastFolder;

    await openAll(model, source, folder);

    expect(model.isExpanded(folder)).toBe(false);
    expect(model.rows().filter((r) => r.type === "node").length).toBeLessThan(tree.count);
  });
});
