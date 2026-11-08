// Enter in the connection dialog's fields saves it, as Save does (#217). Real key presses in headless Chromium, so
// the form's own implicit submission is what is tested.
import { flushSync, mount, unmount } from "svelte";
import { userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import type { Api, AppConfig } from "./api";
import { BUILTIN_KINDS } from "./builtin-kinds";
import ConnectionDialog from "./ConnectionDialog.svelte";

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

function open() {
  const saveConnection = vi.fn(async () => ({ environments: [] }) as unknown as AppConfig);
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(ConnectionDialog, {
    target,
    props: { api: { saveConnection } as unknown as Api, kinds: BUILTIN_KINDS, environments: [], onSaved, onEnvironmentCreated: () => {}, onClose },
  });
  flushSync();
  return { saveConnection, onSaved, onClose };
}

const error = () => [...document.querySelectorAll(".result")].map((e) => e.textContent).join("");

describe("Enter in the connection dialog", () => {
  it("saves the connection from a text field", async () => {
    const { saveConnection, onSaved, onClose } = open();
    await userEvent.type(document.getElementById("c-endpoint")!, "orders.example.test");
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveConnection).toHaveBeenCalledOnce();
    expect(saveConnection.mock.calls[0]).toEqual([null, expect.objectContaining({ endpoint: "orders.example.test" }), ""]);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ endpoint: "orders.example.test" }), null);
  });

  it("shows what is missing instead of saving an incomplete form", async () => {
    const { saveConnection, onClose } = open();
    document.getElementById("c-name")!.focus();
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(error()).toContain("Server is required"));
    expect(saveConnection).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Enter on Cancel cancels rather than saves", async () => {
    const { saveConnection, onClose } = open();
    await userEvent.type(document.getElementById("c-endpoint")!, "orders.example.test");
    [...document.querySelectorAll("button")].find((b) => b.textContent === "Cancel")!.focus();
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveConnection).not.toHaveBeenCalled();
  });
});
