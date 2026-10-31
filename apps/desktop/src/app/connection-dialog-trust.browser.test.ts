// Trusting a server certificate turns off the check that the server is who it claims to be. The dialog says so for
// any server that isn't this machine, more strongly with Entra, where a captured token works elsewhere (issue #174).
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import "./app.css";
import type { Api, ConnectionConfig } from "./api";
import ConnectionDialog from "./ConnectionDialog.svelte";

const base: ConnectionConfig = {
  id: "c1", name: "Fabrikam orders", kind: "sql", endpoint: "orders.fabrikam.test", auth: "sql",
  user: "reader", database: null, tenantId: null, trustServerCertificate: true,
};

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

function open(initial: ConnectionConfig) {
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(ConnectionDialog, {
    target,
    props: { api: {} as Api, environments: [], initial, onSaved: () => {}, onEnvironmentCreated: () => {}, onClose: () => {} },
  });
  flushSync();
  return () => document.querySelector(".trust-warning")?.textContent ?? null;
}

describe("trust server certificate warning", () => {
  it("warns for a remote server", () => {
    const warning = open(base);
    expect(warning()).toContain("orders.fabrikam.test");
    expect(warning()).toContain("password");
  });

  it("warns that an Entra token could be reused elsewhere", () => {
    const warning = open({ ...base, auth: "entra", user: null });
    expect(warning()).toContain("sign-in token");
  });

  it("does not warn for this machine", () => {
    const warning = open({ ...base, endpoint: "127.0.0.1,14333" });
    expect(warning()).toBeNull();
  });

  it("does not warn when the certificate is checked", () => {
    const warning = open({ ...base, trustServerCertificate: false });
    expect(warning()).toBeNull();
  });
});
