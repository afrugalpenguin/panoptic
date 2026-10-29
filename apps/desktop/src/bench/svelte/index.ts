import { flushSync, mount, unmount } from "svelte";
import type { Renderer } from "../types";
import Grid from "./Grid.svelte";
import Tree from "./Tree.svelte";

export const svelte: Renderer = {
  name: "svelte-5",

  mountTree(host, tree, rows, expanded) {
    const c = mount(Tree, { target: host, props: { tree, rows, expanded } });
    flushSync();
    return {
      scroller: c.getScroller(),
      setRows: (r, e) => {
        c.setRows(r, e);
        flushSync();
      },
      destroy: () => unmount(c),
    };
  },

  mountGrid(host, grid) {
    const c = mount(Grid, { target: host, props: { grid } });
    flushSync();
    return { scroller: c.getScroller(), destroy: () => unmount(c) };
  },
};
