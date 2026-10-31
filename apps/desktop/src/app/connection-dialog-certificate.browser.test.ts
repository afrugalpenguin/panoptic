// A server reached by another name, or with a private CA, can be validated properly instead of trusting every
// certificate (issue #261): a certificate host name and a certificate file on SQL Server and Postgres connections.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import type { Api, ConnectionConfig } from "./api";
import ConnectionDialog from "./ConnectionDialog.svelte";

const saved: ConnectionConfig = {
  id: "c1", name: "Fabrikam orders", kind: "sql", endpoint: "orders-pe.fabrikam.test", auth: "sql",
  user: "reader", database: null, tenantId: null, trustServerCertificate: false,
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

describe("certificate host name and file", () => {
  it("are offered for SQL Server and Postgres, not Cosmos", () => {
    open(saved);
    expect(document.getElementById("c-cert-host")).not.toBeNull();
    expect(document.getElementById("c-cert-file")).not.toBeNull();
    unmount(mounted!);
    mounted = undefined;
    document.body.innerHTML = "";
    open({ ...saved, kind: "cosmos", endpoint: "https://fabrikam.documents.azure.com:443/", auth: "key", user: null });
    expect(document.getElementById("c-cert-host")).toBeNull();
    expect(document.getElementById("c-cert-file")).toBeNull();
  });

  it("are sent trimmed, with the password typed again", async () => {
    const d = open(saved);
    d.type("c-cert-host", "  orders.fabrikam.test ");
    d.type("c-cert-file", " C:\\certs\\fabrikam-ca.pem ");
    d.type("c-secret", "pw");
    d.clickTest();
    await vi.waitFor(() => expect(d.testConnection).toHaveBeenCalledTimes(1));
    expect(d.testConnection.mock.calls[0][0]).toMatchObject({ certificateHostName: "orders.fabrikam.test", certificateFile: "C:\\certs\\fabrikam-ca.pem" });
  });

  it("change which server is trusted, so the saved password is not reused", () => {
    const d = open(saved);
    d.type("c-cert-file", "C:\\certs\\other-ca.pem");
    d.clickTest();
    expect(d.testConnection).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Enter the password again");
  });

  it("cannot be combined with Trust server certificate", () => {
    const d = open({ ...saved, trustServerCertificate: true });
    d.type("c-cert-host", "orders.fabrikam.test");
    d.type("c-secret", "pw");
    d.clickTest();
    expect(d.testConnection).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Turn off Trust server certificate");
  });

  it("are suggested by the trust warning as the safer alternative", () => {
    open({ ...saved, trustServerCertificate: true });
    expect(document.querySelector(".trust-warning")?.textContent).toContain("certificate host name or file");
  });
});
