import { flushSync, mount, unmount } from "svelte";
import Tree from "../app/Tree.svelte";
import { TreeModel, type Row } from "../app/tree-model";
import ResultGrid from "../query/ResultGrid.svelte";
import { ResultSet } from "../query/store.svelte";
import type { GridData } from "./data";
import type { TreeSource } from "./tree-source";

/** The shipped explorer tree over a synthetic source, wired the way App.svelte wires it: every model change re-reads rows. */
export interface BenchTree {
  model: TreeModel;
  /** Mounts the tree with the current rows. */
  mount(host: HTMLElement): HTMLElement;
  /** While off, model changes do not re-render (for setting up a large tree before a timed step). */
  setLive(on: boolean): void;
  /** Re-reads the rows once and renders them. */
  render(): void;
  destroy(): void;
}

/** Loads the root and opens every environment (Expand all), ready to mount. */
export async function createTree(source: TreeSource): Promise<BenchTree> {
  let live = false;
  // Raw, as App.svelte holds them: a deep $state proxy over 50k rows made every change cost about 100 ms in the
  // bench that the app never pays (#195).
  let rows = $state.raw<Row[]>([]);
  const model: TreeModel = new TreeModel(source.load, () => {
    if (live) rows = model.rows();
  });
  const props = {
    model,
    get rows() {
      return rows;
    },
    selectedKey: undefined as string | undefined,
    onContextMenu: () => {},
    onActivate: () => {},
    onOpenProblem: () => {},
  };
  await model.loadRoot();
  await model.expandEnvironments();
  rows = model.rows();
  let component: ReturnType<typeof mount> | undefined;
  return {
    model,
    mount: (host) => {
      component = mount(Tree, { target: host, props });
      flushSync();
      live = true;
      return host.querySelector<HTMLElement>("[role=tree]")!;
    },
    setLive: (on) => (live = on),
    render: () => {
      rows = model.rows();
      flushSync();
    },
    destroy: () => component && unmount(component),
  };
}

/** A complete result set, as after a query has finished streaming. */
export function resultSet(grid: GridData): ResultSet {
  const set = new ResultSet();
  set.columns = grid.columns.map((name) => ({ name, type: "nvarchar" }));
  set.rows = Array.from({ length: grid.rowCount }, (_, r) => grid.data.map((col) => col[r]));
  set.count = grid.rowCount;
  return set;
}

/** The shipped result grid. */
export function mountGrid(host: HTMLElement, set: ResultSet): { scroller: HTMLElement; destroy(): void } {
  const component = mount(ResultGrid, { target: host, props: { set } });
  flushSync();
  return { scroller: host.querySelector<HTMLElement>("[role=grid]")!, destroy: () => unmount(component) };
}
