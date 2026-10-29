import type { GridData, TreeData } from "./data";

export const TREE_ROW_H = 22;
export const GRID_ROW_H = 24;
export const OVERSCAN = 8;

export interface TreeView {
  scroller: HTMLElement;
  setRows(rows: Int32Array, expanded: Uint8Array): void;
  destroy(): void;
}

export interface GridView {
  scroller: HTMLElement;
  destroy(): void;
}

/** One rendering layer under test. Both share data, DOM structure and CSS. */
export interface Renderer {
  name: string;
  mountTree(host: HTMLElement, tree: TreeData, rows: Int32Array, expanded: Uint8Array): TreeView;
  mountGrid(host: HTMLElement, grid: GridData): GridView;
}
