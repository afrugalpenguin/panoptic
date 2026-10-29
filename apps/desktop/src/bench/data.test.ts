import { describe, expect, it } from "vitest";
import { flatten, generateGrid, generateTree } from "./data";

describe("generateTree", () => {
  const tree = generateTree(50_000);

  it("generates roughly the target node count", () => {
    expect(tree.count).toBeGreaterThanOrEqual(50_000);
    expect(tree.count).toBeLessThan(51_000);
  });

  it("lays nodes out in preorder so every subtree is contiguous", () => {
    for (let i = 1; i < tree.count; i++) {
      const p = tree.parent[i];
      if (p < 0) continue;
      expect(p).toBeLessThan(i);
      expect(i).toBeLessThan(p + tree.size[p]);
    }
  });

  it("starts with environments at depth 0", () => {
    expect(tree.depth[0]).toBe(0);
    expect(tree.label[0]).toMatch(/dev|uat|prod|sandbox/);
  });
});

describe("flatten", () => {
  const tree = generateTree(1_000);

  it("shows only roots when nothing is expanded", () => {
    const rows = flatten(tree, new Uint8Array(tree.count));
    expect([...rows].every((i) => tree.depth[i] === 0)).toBe(true);
  });

  it("shows every node when everything is expanded", () => {
    const rows = flatten(tree, new Uint8Array(tree.count).fill(1));
    expect(rows.length).toBe(tree.count);
  });

  it("hides the subtree of a collapsed node", () => {
    const expanded = new Uint8Array(tree.count).fill(1);
    expanded[0] = 0;
    const rows = flatten(tree, expanded);
    expect(rows.length).toBe(tree.count - tree.size[0] + 1);
  });
});

describe("generateGrid", () => {
  it("generates the requested rows with a value for every column", () => {
    const grid = generateGrid(1_000);
    expect(grid.rowCount).toBe(1_000);
    expect(grid.columns.length).toBeGreaterThanOrEqual(10);
    for (const col of grid.data) expect(col.length).toBe(1_000);
  });
});
