import type { GridData, TreeData } from "../data";
import { GRID_ROW_H, TREE_ROW_H, type Renderer } from "../types";
import { el, VirtualRows } from "./virtual";

export const vanilla: Renderer = {
  name: "plain-ts",

  mountTree(host, tree: TreeData, rows, expanded) {
    let current = rows;
    let open = expanded;
    const list = new VirtualRows(
      host,
      TREE_ROW_H,
      () => {
        const row = el("div", "t-row");
        row.append(el("span", "t-twisty"), el("span", "t-icon"), el("span", "t-label"));
        return row;
      },
      (row, index) => {
        const i = current[index];
        const twisty = row.children[0] as HTMLSpanElement;
        const icon = row.children[1] as HTMLSpanElement;
        const label = row.children[2] as HTMLSpanElement;
        row.style.paddingLeft = `${tree.depth[i] * 16 + 4}px`;
        twisty.className = tree.size[i] > 1 ? (open[i] ? "t-twisty open" : "t-twisty closed") : "t-twisty";
        icon.className = `t-icon k${tree.kind[i]}`;
        label.textContent = tree.label[i];
      },
    );
    list.setCount(current.length);
    return {
      scroller: list.scroller,
      setRows(r, e) {
        current = r;
        open = e;
        list.setCount(r.length);
      },
      destroy: () => list.destroy(),
    };
  },

  mountGrid(host, grid: GridData) {
    const header = el("div", "g-header");
    for (const c of grid.columns) {
      const cell = el("span", "g-cell");
      cell.textContent = c;
      header.append(cell);
    }
    host.append(header);

    const list = new VirtualRows(
      host,
      GRID_ROW_H,
      () => {
        const row = el("div", "g-row");
        for (let c = 0; c < grid.columns.length; c++) row.append(el("span", "g-cell"));
        return row;
      },
      (row, r) => {
        const cells = row.children;
        for (let c = 0; c < cells.length; c++) cells[c].textContent = grid.data[c][r];
      },
    );
    list.setCount(grid.rowCount);
    return {
      scroller: list.scroller,
      destroy() {
        header.remove();
        list.destroy();
      },
    };
  },
};
