// Ctrl+P with tabs open: Seek over the workspace (issue #187). Real key presses in headless Chromium.
import { mount, unmount } from "svelte";
import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import type { SeekIndex } from "./seek";
import SeekOverlay from "./SeekOverlay.svelte";

// Synthetic names only.
const index: SeekIndex = {
  envs: [
    { id: "env:dev", name: "Dev", hosts: [{ id: "conn:dev-01", name: "dev-01", envId: "env:dev" }] },
    { id: "env:uat", name: "UAT", hosts: [{ id: "conn:uat-01", name: "uat-01", envId: "env:uat" }] },
  ],
  usage: { envs: {}, recent: [] },
};

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

function show() {
  const before = document.createElement("button");
  before.textContent = "where focus was";
  document.body.append(before);
  before.focus();
  const on = { onOpen: vi.fn(), onQuery: vi.fn(), onClose: vi.fn() };
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(SeekOverlay, { target, props: { index, ...on } });
  return { on, before };
}

const input = () => document.querySelector<HTMLInputElement>("dialog.seek-overlay input")!;

describe("Seek overlay", () => {
  it("opens as a modal with the Seek box focused", async () => {
    show();
    await vi.waitFor(() => expect(document.activeElement).toBe(input()));
    expect(document.querySelector<HTMLDialogElement>("dialog.seek-overlay")!.open).toBe(true);
  });

  it("Enter opens the row and closes", async () => {
    const { on } = show();
    await vi.waitFor(() => expect(document.activeElement).toBe(input()));
    await userEvent.keyboard("uat");
    await userEvent.keyboard("{Enter}");
    expect(on.onOpen).toHaveBeenCalledTimes(1);
    expect(on.onOpen.mock.calls[0][0]).toMatchObject({ kind: "env", env: { id: "env:uat" } });
    expect(on.onClose).toHaveBeenCalledWith(false);
  });

  it("Ctrl+Enter starts a query on the row and closes", async () => {
    const { on } = show();
    await vi.waitFor(() => expect(document.activeElement).toBe(input()));
    await userEvent.keyboard("uat-01");
    await userEvent.keyboard("{ArrowDown}");
    await userEvent.keyboard("{Control>}{Enter}{/Control}");
    expect(on.onQuery).toHaveBeenCalledTimes(1);
    expect(on.onQuery.mock.calls[0][0]).toMatchObject({ kind: "host", host: { id: "conn:uat-01" } });
    expect(on.onClose).toHaveBeenCalledWith(false);
  });

  it("Esc clears the query first, then closes and hands focus back", async () => {
    const { on, before } = show();
    await vi.waitFor(() => expect(document.activeElement).toBe(input()));
    await userEvent.keyboard("ua");
    await userEvent.keyboard("{Escape}");
    expect(input().value).toBe("");
    expect(on.onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(on.onClose).toHaveBeenCalledWith(true);
    expect(on.onOpen).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(before);
  });
});
