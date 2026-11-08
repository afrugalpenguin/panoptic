// Closing a tab from its x (What's new, most often) moves focus to the tab now shown, not to the page (#216).
// Real focus in headless Chromium.
import { flushSync, mount, unmount } from "svelte";
import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../app/app.css";
import type { SeekIndex } from "../app/seek";
import { QueryWorkspace } from "./store.svelte";
import Workspace from "./Workspace.svelte";

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

describe("closing a tab", () => {
  it("focuses the tab shown next", async () => {
    const workspace = new QueryWorkspace({ executeQuery: async () => ({}) as never, cancelQuery: async () => true });
    workspace.openProblems([]);
    workspace.openWhatsNew([{ version: "0.2.0", date: "2026-10-31", body: "- Fixed: something." }], "launch");
    const host = document.createElement("div");
    host.style.cssText = "width: 800px; height: 400px;";
    document.body.append(host);
    mounted = mount(Workspace, { target: host, props: { workspace, seekIndex: {} as SeekIndex, onConnect: () => {}, onLinkError: () => {} } });
    flushSync();

    const close = host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"] button.close')!;
    await userEvent.click(close);

    await vi.waitFor(() => {
      const focused = document.activeElement as HTMLElement;
      expect(focused.getAttribute("role")).toBe("tab");
      expect(focused.getAttribute("aria-selected")).toBe("true");
    });
    expect(workspace.tabs.map((t) => t.kind)).toEqual(["problems"]);
  });
});
