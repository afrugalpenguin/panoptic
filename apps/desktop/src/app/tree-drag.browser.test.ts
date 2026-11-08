// Drag and drop reordering in the tree (#63): the drop line, where a drop lands, and Alt+Up and Alt+Down. Synthetic
// drag events in headless Chromium; the harness records the moves instead of saving them.
import { mount, unmount } from "svelte";
import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import type { TreeNode } from "./api";
import Harness from "../test/ExplorerHarness.svelte";

// Synthetic names only.
const env = (id: string, count: number): TreeNode => ({
  id: `env:${id}`, kind: "environment", label: id, icon: "environment", hasChildren: count > 0, actions: [],
  meta: { environmentId: id, color: "#1971c2", readOnly: "false", connectionCount: String(count) },
});
const conn = (name: string): TreeNode => ({
  id: `conn:${name}`, kind: "connection", label: name, icon: "sql", hasChildren: true, actions: [],
  meta: { endpoint: `${name}.example.test`, connectionKind: "sql", connectionId: name },
});
const nodes: Record<string, TreeNode[]> = {
  "": [env("dev", 2), env("test", 2)],
  "env:dev": [conn("dev-01"), conn("dev-02")],
  "env:test": [conn("test-01"), conn("test-02")],
};

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

async function show() {
  const moves: unknown[][] = [];
  const orders: string[][] = [];
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(Harness, {
    target,
    props: {
      nodes,
      width: 320,
      expand: ["env:dev", "env:test"],
      onMoveConnection: (...args: unknown[]) => void moves.push(args),
      onReorderEnvironments: (order: string[]) => void orders.push(order),
    },
  });
  const panel = await vi.waitFor(() => {
    const el = target.querySelector<HTMLElement>(".explorer");
    if (!el || el.querySelectorAll(".tree-row").length !== 6) throw new Error("tree not drawn yet");
    return el;
  });
  return { panel, moves, orders };
}

/** A row by its node id (the virtualiser's copy, not the pinned header). */
const row = (panel: HTMLElement, key: string) => panel.querySelector<HTMLElement>(`.window .tree-row[id$="-${encodeURIComponent(key)}"]`)!;

/** A drag event a quarter of the way into the row from its top or bottom, sharing one DataTransfer as a real drag does. */
function fire(type: string, el: HTMLElement, data: DataTransfer, half: "upper" | "lower" = "upper") {
  const box = el.getBoundingClientRect();
  const clientY = half === "upper" ? box.top + box.height / 4 : box.top + (box.height * 3) / 4;
  el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: data, clientX: box.left + 40, clientY }));
}

const lines = (panel: HTMLElement) =>
  [...panel.querySelectorAll<HTMLElement>(".window .tree-row.drop-before, .window .tree-row.drop-after")].map(
    (r) => `${r.classList.contains("drop-before") ? "before" : "after"} ${r.id.split("-conn%3A").pop()}`,
  );

describe("tree drag and drop", () => {
  it("a connection dropped on the upper half of another lands before it, with a line above while dragging", async () => {
    const { panel, moves } = await show();
    const data = new DataTransfer();
    fire("dragstart", row(panel, "conn:dev-02"), data);
    fire("dragover", row(panel, "conn:dev-01"), data, "upper");
    await vi.waitFor(() => expect(lines(panel)).toEqual(["before dev-01"]));
    fire("drop", row(panel, "conn:dev-01"), data, "upper");
    expect(moves).toEqual([["dev-02", "dev", "dev-01"]]);
    await vi.waitFor(() => expect(lines(panel)).toEqual([]));
  });

  it("the lower half of a connection in another environment lands after it", async () => {
    const { panel, moves } = await show();
    const data = new DataTransfer();
    fire("dragstart", row(panel, "conn:dev-01"), data);
    fire("dragover", row(panel, "conn:test-01"), data, "lower");
    await vi.waitFor(() => expect(lines(panel)).toEqual(["after test-01"]));
    fire("drop", row(panel, "conn:test-01"), data, "lower");
    expect(moves).toEqual([["dev-01", "test", "test-02"]]);
  });

  it("a drop that would leave the connection where it is shows no line and does nothing", async () => {
    const { panel, moves } = await show();
    const data = new DataTransfer();
    fire("dragstart", row(panel, "conn:dev-02"), data);
    // Upper half first, then down into the lower half, which is where it already is.
    fire("dragover", row(panel, "conn:dev-01"), data, "upper");
    await vi.waitFor(() => expect(lines(panel)).toEqual(["before dev-01"]));
    fire("dragover", row(panel, "conn:dev-01"), data, "lower");
    await vi.waitFor(() => expect(lines(panel)).toEqual([]));
    fire("drop", row(panel, "conn:dev-01"), data, "lower");
    expect(moves).toEqual([]);
  });

  it("dropping on an environment header still takes the connection in, outlined, with no position", async () => {
    const { panel, moves } = await show();
    const data = new DataTransfer();
    fire("dragstart", row(panel, "conn:dev-01"), data);
    fire("dragover", row(panel, "env:test"), data, "upper");
    await vi.waitFor(() => expect(row(panel, "env:test").classList).toContain("drop-over"));
    expect(lines(panel)).toEqual([]);
    fire("drop", row(panel, "env:test"), data, "upper");
    expect(moves).toEqual([["dev-01", "test", undefined]]);
  });

  it("an environment header dragged onto another reorders the environments", async () => {
    const { panel, orders, moves } = await show();
    const data = new DataTransfer();
    fire("dragstart", row(panel, "env:test"), data);
    // A connection row is not a target for an environment.
    fire("dragover", row(panel, "conn:dev-01"), data, "upper");
    fire("dragover", row(panel, "env:dev"), data, "upper");
    await vi.waitFor(() => expect(row(panel, "env:dev").classList).toContain("drop-before"));
    expect(row(panel, "conn:dev-01").classList).not.toContain("drop-before");
    fire("drop", row(panel, "env:dev"), data, "upper");
    expect(orders).toEqual([["test", "dev"]]);
    expect(moves).toEqual([]);
  });

  it("dragend (Escape, or a drop outside) clears the line and moves nothing", async () => {
    const { panel, moves, orders } = await show();
    const data = new DataTransfer();
    const source = row(panel, "conn:dev-02");
    fire("dragstart", source, data);
    fire("dragover", row(panel, "conn:test-01"), data, "upper");
    await vi.waitFor(() => expect(lines(panel)).toEqual(["before test-01"]));
    fire("dragend", source, data);
    await vi.waitFor(() => expect(lines(panel)).toEqual([]));
    expect(moves).toEqual([]);
    expect(orders).toEqual([]);
  });

  it("an environment header drags to reorder, with no text for the query editor", async () => {
    const { panel } = await show();
    const data = new DataTransfer();
    fire("dragstart", row(panel, "env:dev"), data);
    expect(data.getData("text/plain")).toBe("");
    expect(data.getData("application/x-panoptic-environment")).toBe("dev");
  });

  it("Alt+Up and Alt+Down move the selected connection within its group, and the selected environment", async () => {
    const { panel, moves, orders } = await show();
    await userEvent.click(row(panel, "conn:dev-02"));
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(moves).toEqual([["dev-02", "dev", "dev-01"]]);
    // Already last: nothing to do.
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(moves).toHaveLength(1);
    // Alt with an arrow moves the row; it does not change the selection.
    expect(row(panel, "conn:dev-02").classList).toContain("selected");

    await userEvent.click(row(panel, "env:dev"));
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(orders).toEqual([["test", "dev"]]);
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(orders).toHaveLength(1);
  });
});
