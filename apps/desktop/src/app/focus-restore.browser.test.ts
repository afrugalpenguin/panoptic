// Closing a dialog, confirm or context menu hands focus back to what opened it, not to the page (#216), so the
// keyboard carries on where it was. Real focus in headless Chromium.
import { flushSync, mount, unmount, type Component } from "svelte";
import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import ConfirmDialog from "./ConfirmDialog.svelte";
import ContextMenu from "./ContextMenu.svelte";

const text = { title: "Remove connection", body: 'Remove "orders.example.test" from Panoptic?', action: "Remove" };

let mounted: Record<string, unknown>[] = [];
afterEach(() => {
  for (const m of mounted) unmount(m);
  mounted = [];
  document.body.innerHTML = "";
});

function opener(): HTMLButtonElement {
  const button = document.createElement("button");
  button.textContent = "Opener";
  document.body.append(button);
  button.focus();
  return button;
}

/** Mounts a component the way App does (its own block), returning a close that removes it. */
function show<P extends Record<string, any>>(component: Component<P>, props: P): () => void {
  const target = document.createElement("div");
  document.body.append(target);
  const m = mount(component, { target, props }) as Record<string, unknown>;
  mounted.push(m);
  flushSync();
  return () => {
    mounted = mounted.filter((x) => x !== m);
    unmount(m);
    flushSync();
  };
}

describe("focus after a dialog closes", () => {
  it("goes back to the opener", async () => {
    const button = opener();
    let close = () => {};
    close = show(ConfirmDialog, { text, onResult: () => close() });
    expect(document.activeElement?.textContent).toBe("Cancel");

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.activeElement).toBe(button));
  });
});

describe("focus after a context menu closes", () => {
  it("goes back to the opener on Esc", async () => {
    const button = opener();
    let close = () => {};
    close = show(ContextMenu, { x: 10, y: 10, items: [{ label: "Copy name", run: () => {} }], onClose: () => queueMicrotask(close) });
    expect(document.activeElement?.textContent).toBe("Copy name");

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("goes back to the menu's opener once a dialog the menu opened closes", async () => {
    const button = opener();
    let closeMenu = () => {};
    let closeDialog = () => {};
    const remove = () => (closeDialog = show(ConfirmDialog, { text, onResult: () => closeDialog() }));
    closeMenu = show(ContextMenu, { x: 10, y: 10, items: [{ label: "Remove connection", run: remove }], onClose: () => queueMicrotask(closeMenu) });

    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));

    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(document.activeElement).toBe(button));
  });
});
