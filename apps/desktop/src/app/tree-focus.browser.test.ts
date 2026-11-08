// Keyboard focus in the tree (#219): focus stays on the tree itself and aria-activedescendant names the selected
// row, so a click never leaves a focus ring on another row. Real clicks and key presses in headless Chromium.
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
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(Harness, { target, props: { nodes, width: 320, expand: ["env:dev", "env:test"] } });
  const panel = await vi.waitFor(() => {
    const el = target.querySelector<HTMLElement>(".explorer");
    if (!el || el.querySelectorAll(".tree-row").length !== 6) throw new Error("tree not drawn yet");
    return el;
  });
  return { panel, tree: panel.querySelector<HTMLElement>(".tree")! };
}

const row = (panel: HTMLElement, text: string) => [...panel.querySelectorAll<HTMLElement>(".window .tree-row")].find((r) => r.textContent?.includes(text))!;
const selected = (panel: HTMLElement) => panel.querySelector<HTMLElement>(".window .tree-row.selected");

/** The row aria-activedescendant points at: it must exist, and be the selected row. */
function active(tree: HTMLElement) {
  const id = tree.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
}

describe("tree focus", () => {
  it("Down from the filter selects the first row and points aria-activedescendant at it", async () => {
    const { panel, tree } = await show();
    panel.querySelector<HTMLInputElement>(".filter input")!.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(tree);
    await vi.waitFor(() => expect(selected(panel)).toBe(row(panel, "dev")));
    expect(active(tree)).toBe(selected(panel));
  });

  it("the arrows move aria-activedescendant with the selection", async () => {
    const { panel, tree } = await show();
    panel.querySelector<HTMLInputElement>(".filter input")!.focus();
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    await vi.waitFor(() => expect(selected(panel)).toBe(row(panel, "dev-02")));
    expect(active(tree)).toBe(selected(panel));
    expect(selected(panel)!.id).toMatch(/^\S+$/);
  });

  it("a click selects the row but leaves focus on the tree", async () => {
    const { panel, tree } = await show();
    await userEvent.click(row(panel, "dev-01"));
    expect(document.activeElement).toBe(tree);
    await vi.waitFor(() => expect(selected(panel)).toBe(row(panel, "dev-01")));
    expect(active(tree)).toBe(selected(panel));

    await userEvent.click(row(panel, "test-02"));
    expect(document.activeElement).toBe(tree);
    await vi.waitFor(() => expect(active(tree)).toBe(row(panel, "test-02")));
    // No row takes focus, so none can keep a focus ring.
    expect(panel.querySelector(".tree-row[tabindex]")).toBeNull();
  });

  it("Tab into the tree with nothing selected selects the first row", async () => {
    const { panel, tree } = await show();
    panel.querySelector<HTMLInputElement>(".filter input")!.focus();
    // The engine control has one engine, so the next stop after the filter is the tree.
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(tree);
    await vi.waitFor(() => expect(selected(panel)).toBe(row(panel, "dev")));
  });

  it("focus handed back by a closing dialog selects nothing, so the landing stays", async () => {
    const { panel, tree } = await show();
    const dialog = document.createElement("dialog");
    dialog.innerHTML = "<button>Cancel</button>";
    document.body.append(dialog);
    dialog.show();
    dialog.querySelector("button")!.focus();
    tree.focus();
    expect(document.activeElement).toBe(tree);
    await new Promise((r) => setTimeout(r, 50));
    expect(selected(panel)).toBeNull();
    expect(tree.hasAttribute("aria-activedescendant")).toBe(false);
  });
});
