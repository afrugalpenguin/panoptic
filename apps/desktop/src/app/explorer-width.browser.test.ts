// Layout checks for the explorer (docs/explorer-ux.md, "Principles" and "Layout (top to bottom)"). Runs in headless
// Chromium (vitest browser project): scrollWidth and container queries need real layout.
import { mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import type { TreeNode } from "./api";
import Harness from "../test/ExplorerHarness.svelte";

// Synthetic names only. Endpoints are long on purpose: they must clip, not scroll.
const env = (id: string, name: string, color: string, count: number): TreeNode => ({
  id: `env:${id}`, kind: "environment", label: name, icon: "environment", hasChildren: count > 0, actions: [],
  meta: { environmentId: id, color, readOnly: "false", connectionCount: String(count) },
});
// Every third connection trusts its certificate, so its row also carries the "cert not checked" badge.
const conn = (name: string, kind: string, trust = false): TreeNode => ({
  id: `conn:${name}`, kind: "connection", label: name, icon: kind, hasChildren: true, actions: [],
  meta: { endpoint: `${name}.a-rather-long-private-endpoint-suffix.example.test`, connectionKind: kind, connectionId: name, ...(trust ? { trustServerCertificate: "true" } : {}) },
});

function fixture(kinds: string[]): Record<string, TreeNode[]> {
  const hosts = (prefix: string) => Array.from({ length: 8 }, (_, i) => conn(`${prefix}-${kinds[i % kinds.length]}-${String(i + 1).padStart(2, "0")}`, kinds[i % kinds.length], i % 3 === 0));
  return {
    "": [env("prod", "Production West Europe", "#e03131", 8), env("uat", "UAT", "#f08c00", 8), env("test", "Test", "#1971c2", 8)],
    "env:prod": hosts("uk-prod"),
    "env:uat": hosts("uk-uat"),
    "env:test": hosts("uk-test"),
  };
}
const FOUR = ["sql", "cosmos", "synapse", "postgres"];
const EIGHT = [...FOUR, "mysql", "oracle", "mongo", "redis"];

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

async function show(width: number, kinds: string[]) {
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(Harness, { target, props: { nodes: fixture(kinds), width, expand: ["env:prod", "env:uat", "env:test"] } });
  const panel = await vi.waitFor(() => {
    const el = target.querySelector<HTMLElement>(".explorer");
    if (!el || el.querySelectorAll(".tree-row").length < 10) throw new Error("tree not drawn yet");
    // The engine control appears once the filter bar has been measured.
    if (!el.querySelector(".engines")) throw new Error("engine control not drawn yet");
    return el;
  });
  return { panel, tree: panel.querySelector<HTMLElement>(".tree")! };
}

const noSideways = (el: HTMLElement) => expect(el.scrollWidth, el.className).toBeLessThanOrEqual(el.clientWidth);

describe("explorer width", () => {
  for (const width of [220, 250, 420])
    it(`nothing scrolls horizontally at ${width}px`, async () => {
      const { panel, tree } = await show(width, FOUR);
      expect(panel.clientWidth).toBe(width);
      // The tree overflows vertically, so its 6px scrollbar takes room, as in WebView2.
      expect(tree.offsetWidth - tree.clientWidth).toBe(6);
      noSideways(panel);
      noSideways(tree);
      noSideways(panel.querySelector<HTMLElement>(".filter-bar")!);
      noSideways(panel.querySelector<HTMLElement>(".footer")!);
      expect(tree.querySelectorAll(".cert-unchecked").length).toBeGreaterThan(0);

      // Scrolled down, with a header pinned, still nothing sideways.
      tree.scrollTop = 300;
      tree.dispatchEvent(new Event("scroll"));
      await vi.waitFor(() => expect(tree.querySelector(".pin")).not.toBeNull());
      noSideways(panel);
      noSideways(tree);
    });

  it("shows four engines as toggles at 220px, with names over 380px", async () => {
    const narrow = await show(220, FOUR);
    expect(narrow.panel.querySelectorAll(".toggle")).toHaveLength(4);
    expect(getComputedStyle(narrow.panel.querySelector(".toggle .name")!).display).toBe("none");
    unmount(mounted!);
    mounted = undefined;
    document.body.innerHTML = "";

    const wide = await show(420, FOUR);
    expect(getComputedStyle(wide.panel.querySelector(".toggle .name")!).display).not.toBe("none");
    noSideways(wide.panel);
  });

  it("uses the Engine button and popover for 8 engines at 250px, and the popover stays inside the panel", async () => {
    const { panel, tree } = await show(250, EIGHT);
    expect(panel.querySelector(".toggles")).toBeNull();
    const button = panel.querySelector<HTMLButtonElement>(".menu-button")!;
    expect(button.textContent?.replace(/\s+/g, " ").trim()).toBe("Engine 8/8");

    button.click();
    const popover = await vi.waitFor(() => {
      const el = panel.querySelector<HTMLElement>(".popover");
      if (!el) throw new Error("popover not open yet");
      return el;
    });
    expect(popover.querySelector(".find")).not.toBeNull();
    expect(popover.querySelectorAll("input[type=checkbox]")).toHaveLength(8);
    const box = popover.getBoundingClientRect();
    const outer = panel.getBoundingClientRect();
    expect(box.width).toBeLessThanOrEqual(240);
    expect(box.left).toBeGreaterThanOrEqual(outer.left);
    expect(box.right).toBeLessThanOrEqual(outer.right);
    expect(box.bottom).toBeLessThanOrEqual(outer.bottom - 30);
    noSideways(panel);
    noSideways(tree);

    // Unticking one engine filters the tree and the footer says so.
    popover.querySelector<HTMLInputElement>("input[type=checkbox]")!.click();
    await vi.waitFor(() => expect(button.textContent?.replace(/\s+/g, " ").trim()).toBe("Engine 7/8"));
    expect(panel.querySelector(".summary .short")?.textContent).toBe("21 / 24");
  });

  it("keeps the footer at the bottom of a short tree", async () => {
    const { tree } = await show(250, FOUR);
    tree.querySelector<HTMLButtonElement>('button[aria-label="Collapse all"]')!.click();
    await vi.waitFor(() => expect(tree.querySelectorAll(".tree-row").length).toBe(3));
    const footer = tree.querySelector<HTMLElement>(".tree-footer")!;
    expect(Math.round(footer.getBoundingClientRect().bottom)).toBe(Math.round(tree.getBoundingClientRect().bottom));
  });
});
