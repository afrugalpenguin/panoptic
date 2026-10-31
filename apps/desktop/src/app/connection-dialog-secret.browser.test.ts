// A saved password belongs to where it was saved for. Editing the server, user, sign-in or certificate trust of a
// saved connection must ask for the password again rather than send the stored one there (issue #170).
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import type { Api, ConnectionConfig } from "./api";
import ConnectionDialog from "./ConnectionDialog.svelte";

const saved: ConnectionConfig = {
  id: "c1", name: "Fabrikam orders", kind: "sql", endpoint: "orders.fabrikam.test", auth: "sql",
  user: "reader", database: null, tenantId: null, trustServerCertificate: false,
};

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

function open() {
  const testConnection = vi.fn(async (_connection: ConnectionConfig, _secret?: string) => ({ ok: true, elapsedMs: 1, error: null }));
  const api = { testConnection } as unknown as Api;
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(ConnectionDialog, {
    target,
    props: { api, environments: [], initial: saved, onSaved: () => {}, onEnvironmentCreated: () => {}, onClose: () => {} },
  });
  flushSync();
  const input = (id: string) => document.getElementById(id) as HTMLInputElement;
  const type = (id: string, value: string) => {
    input(id).value = value;
    input(id).dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
  };
  const clickTest = () => {
    [...document.querySelectorAll("button")].find((b) => b.textContent === "Test")!.click();
    flushSync();
  };
  return { testConnection, input, type, clickTest };
}

describe("editing a saved connection's password binding", () => {
  it("keeps the saved password for a rename (sends no secret, so the sidecar uses the stored one)", async () => {
    const d = open();
    d.type("c-name", "Fabrikam orders (renamed)");
    d.clickTest();

    await vi.waitFor(() => expect(d.testConnection).toHaveBeenCalledTimes(1));
    expect(d.testConnection.mock.calls[0][1]).toBeUndefined();
  });

  it("asks for the password again when the server changes", () => {
    const d = open();
    d.type("c-endpoint", "orders.fabrikam-lookalike.test");

    expect(d.input("c-secret").placeholder).not.toContain("keep the saved one");
    d.clickTest();

    expect(d.testConnection).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Enter the password again");
  });

  it("asks for the password again when the user changes", () => {
    const d = open();
    d.type("c-user", "someone-else");
    d.clickTest();

    expect(d.testConnection).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Enter the password again");
  });

  it("asks for the password again when certificate trust is turned on", () => {
    const d = open();
    const box = document.querySelector<HTMLInputElement>(".check input[type=checkbox]")!;
    box.click();
    flushSync();
    d.clickTest();

    expect(d.testConnection).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Enter the password again");
  });

  it("drops an earlier test result once the connection is edited (#263)", async () => {
    const d = open();
    d.clickTest();
    await vi.waitFor(() => expect(document.body.textContent).toContain("Connected in 1 ms"));

    d.type("c-endpoint", "orders.fabrikam-lookalike.test");
    expect(document.body.textContent).not.toContain("Connected in");

    d.clickTest();
    expect(document.body.textContent).not.toContain("Connected in");
    expect(document.body.textContent).toContain("Enter the password again");
  });

  it("sends the newly typed password with a changed server", async () => {
    const d = open();
    d.type("c-endpoint", "orders-new.fabrikam.test");
    d.type("c-secret", "new-password");
    d.clickTest();

    await vi.waitFor(() => expect(d.testConnection).toHaveBeenCalledTimes(1));
    expect(d.testConnection.mock.calls[0][1]).toBe("new-password");
  });
});
