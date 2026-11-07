// The explorer footer sits inside the tree's focus container; its buttons must still take Enter and Space
// (keyboard users have no other way to reach them). Real key presses in headless Chromium, so native button
// activation is what is tested.
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

async function show(expand: string[]) {
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(Harness, { target, props: { nodes, width: 320, expand } });
  const want = 2 + expand.length * 2;
  return vi.waitFor(() => {
    const el = target.querySelector<HTMLElement>(".explorer");
    if (!el || el.querySelectorAll(".tree-row").length !== want) throw new Error("tree not drawn yet");
    return el;
  });
}

const button = (panel: HTMLElement, label: string) => panel.querySelector<HTMLButtonElement>(`.tree-footer button[aria-label="${label}"]`)!;
const rowCount = (panel: HTMLElement) => panel.querySelectorAll(".tree-row").length;

describe("explorer footer keys", () => {
  it("Enter activates a footer button", async () => {
    const panel = await show(["env:dev", "env:test"]);
    button(panel, "Collapse all").focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(rowCount(panel)).toBe(2));
  });

  it("Space activates a footer button", async () => {
    const panel = await show([]);
    button(panel, "Expand all").focus();
    await userEvent.keyboard(" ");
    await vi.waitFor(() => expect(rowCount(panel)).toBe(6));
  });
});
