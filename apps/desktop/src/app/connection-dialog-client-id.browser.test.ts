// An Entra connection can sign in as an app other than the default public client: a tenant-owned registration, for
// tenants that block the default or insist on their own (issue #262). Optional, and only a GUID.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import type { Api, ConnectionConfig } from "./api";
import ConnectionDialog from "./ConnectionDialog.svelte";

const entra: ConnectionConfig = {
  id: "c1", name: "Fabrikam orders", kind: "sql", endpoint: "orders.fabrikam.test", auth: "entra",
  user: null, database: null, tenantId: null, trustServerCertificate: false,
};

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

function open(initial: ConnectionConfig) {
  const testConnection = vi.fn(async (_connection: ConnectionConfig, _secret?: string) => ({ ok: true, elapsedMs: 1, error: null }));
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(ConnectionDialog, {
    target,
    props: { api: { testConnection } as unknown as Api, environments: [], initial, onSaved: () => {}, onEnvironmentCreated: () => {}, onClose: () => {} },
  });
  flushSync();
  const type = (id: string, value: string) => {
    const el = document.getElementById(id) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
  };
  const clickTest = () => {
    [...document.querySelectorAll("button")].find((b) => b.textContent === "Test")!.click();
    flushSync();
  };
  return { testConnection, type, clickTest };
}

describe("Entra client id", () => {
  it("is offered for Entra and left out (default client) when blank", async () => {
    const d = open(entra);
    expect(document.getElementById("c-client")).not.toBeNull();
    d.clickTest();
    await vi.waitFor(() => expect(d.testConnection).toHaveBeenCalledTimes(1));
    expect(d.testConnection.mock.calls[0][0].clientId ?? null).toBeNull();
  });

  it("sends a GUID, trimmed", async () => {
    const d = open(entra);
    d.type("c-client", "  11111111-2222-3333-4444-555555555555 ");
    d.clickTest();
    await vi.waitFor(() => expect(d.testConnection).toHaveBeenCalledTimes(1));
    expect(d.testConnection.mock.calls[0][0].clientId).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("refuses anything that is not a GUID", () => {
    const d = open(entra);
    d.type("c-client", "my-app");
    d.clickTest();
    expect(d.testConnection).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Client id");
  });

  it("is not offered for other sign-in methods", () => {
    open({ ...entra, auth: "sql", user: "reader" });
    expect(document.getElementById("c-client")).toBeNull();
  });
});
