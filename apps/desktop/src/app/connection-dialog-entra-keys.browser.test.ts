// Cosmos with account keys fetched through an Entra sign-in (#65): an Entra sign-in, so the tenant and client id
// apply, but nothing to paste: the sidecar fetches the key itself and never stores or returns it.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import type { Api, ConnectionConfig } from "./api";
import { BUILTIN_KINDS } from "./builtin-kinds";
import ConnectionDialog from "./ConnectionDialog.svelte";

const cosmos: ConnectionConfig = {
  id: "c1", name: "Orders", kind: "cosmos", endpoint: "https://orders-dev.documents.azure.com:443/", auth: "entraKeys",
  user: null, database: null, tenantId: "11111111-2222-3333-4444-555555555555", trustServerCertificate: false,
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
    props: { api: { testConnection } as unknown as Api, kinds: BUILTIN_KINDS, environments: [], initial, onSaved: () => {}, onEnvironmentCreated: () => {}, onClose: () => {} },
  });
  flushSync();
  return { testConnection };
}

describe("Cosmos keys fetched with Entra", () => {
  it("is offered for Cosmos", () => {
    open(cosmos);
    const options = [...(document.getElementById("c-auth") as HTMLSelectElement).options].map((o) => o.value);
    expect(options).toEqual(["entra", "entraKeys", "key"]);
  });

  it("asks for the tenant and client id, and no key", async () => {
    const d = open(cosmos);
    expect(document.getElementById("c-tenant")).not.toBeNull();
    expect(document.getElementById("c-client")).not.toBeNull();
    expect(document.getElementById("c-secret")).toBeNull();

    [...document.querySelectorAll("button")].find((b) => b.textContent === "Test")!.click();
    flushSync();

    await vi.waitFor(() => expect(d.testConnection).toHaveBeenCalledTimes(1));
    const [sent, secret] = d.testConnection.mock.calls[0];
    expect(sent.auth).toBe("entraKeys");
    expect(sent.tenantId).toBe(cosmos.tenantId);
    expect(secret).toBe("");
  });
});
