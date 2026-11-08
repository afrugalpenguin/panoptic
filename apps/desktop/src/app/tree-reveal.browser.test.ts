// After Add connection the tree selects the new connection and scrolls it into view (#216), even when it lands below
// the fold of a long environment.
import { mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import type { TreeNode } from "./api";
import Harness from "../test/ExplorerHarness.svelte";

// Synthetic names only.
const conn = (name: string): TreeNode => ({
  id: `conn:${name}`, kind: "connection", label: name, icon: "sql", hasChildren: true, actions: [],
  meta: { endpoint: `${name}.example.test`, connectionKind: "sql", connectionId: name },
});
const many = Array.from({ length: 40 }, (_, i) => conn(`dev-${String(i + 1).padStart(2, "0")}`));
const nodes: Record<string, TreeNode[]> = {
  "": [
    {
      id: "env:dev", kind: "environment", label: "dev", icon: "environment", hasChildren: true, actions: [],
      meta: { environmentId: "dev", color: "#1971c2", readOnly: "false", connectionCount: String(many.length) },
    },
  ],
  "env:dev": many,
};

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

describe("revealing a row", () => {
  it("selects it and scrolls it into view", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const harness = mount(Harness, { target, props: { nodes, width: 320, expand: ["env:dev"] } }) as { reveal: (key: string) => void };
    mounted = harness;
    await vi.waitFor(() => {
      if (!target.textContent?.includes("dev-01")) throw new Error("tree not drawn yet");
    });

    harness.reveal("conn:dev-40");

    await vi.waitFor(() => {
      const row = target.querySelector<HTMLElement>('.tree-row[aria-selected="true"]');
      expect(row?.textContent).toContain("dev-40");
      const scroller = row!.closest<HTMLElement>('[tabindex="0"]')!.getBoundingClientRect();
      const box = row!.getBoundingClientRect();
      expect(box.top).toBeGreaterThanOrEqual(scroller.top);
      expect(box.bottom).toBeLessThanOrEqual(scroller.bottom);
    });
  });

  it("leaves the selection alone for a key not in the tree", async () => {
    const target = document.createElement("div");
    document.body.append(target);
    const harness = mount(Harness, { target, props: { nodes, width: 320, expand: ["env:dev"] } }) as { reveal: (key: string) => void };
    mounted = harness;
    await vi.waitFor(() => {
      if (!target.textContent?.includes("dev-01")) throw new Error("tree not drawn yet");
    });

    harness.reveal("conn:missing");

    expect(target.querySelector('.tree-row[aria-selected="true"]')).toBeNull();
  });
});
