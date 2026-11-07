// Postgres client certificate sign-in (#120): a user, a certificate and its key (or a .pfx alone), and an optional
// key passphrase sent as the connection's secret.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import type { Api, ConnectionConfig } from "./api";
import { BUILTIN_KINDS } from "./builtin-kinds";
import ConnectionDialog from "./ConnectionDialog.svelte";

const saved: ConnectionConfig = {
  id: "c1", name: "Orders", kind: "postgres", endpoint: "orders.example.test", auth: "certificate", user: "reader",
  database: null, tenantId: null, trustServerCertificate: false,
  clientCertificateFile: "C:\\certs\\reader.crt", clientKeyFile: "C:\\certs\\reader.key",
};

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

function open(initial?: ConnectionConfig) {
  const testConnection = vi.fn(async (_c: ConnectionConfig, _secret?: string) => ({ ok: true, elapsedMs: 1, error: null }));
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(ConnectionDialog, {
    target,
    props: { api: { testConnection } as unknown as Api, kinds: BUILTIN_KINDS, environments: [], initial, onSaved: () => {}, onEnvironmentCreated: () => {}, onClose: () => {} },
  });
  flushSync();
  return testConnection;
}

const field = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
function set(id: string, value: string) {
  const el = field(id)!;
  el.value = value;
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  flushSync();
}
/** Clicks Test once it is back from any earlier run ("Testing..." while one is in flight). */
async function clickTest() {
  const button = await vi.waitFor(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Test")!);
  button.click();
  flushSync();
}
const error = () => document.querySelector(".result:not(.ok)")?.textContent ?? "";

function newCertConnection() {
  const test = open();
  set("c-kind", "postgres");
  set("c-endpoint", "orders.example.test");
  set("c-auth", "certificate");
  set("c-user", "reader");
  return test;
}

describe("client certificate sign-in", () => {
  it("shows the certificate, key and an optional passphrase, and no password", () => {
    newCertConnection();
    expect(field("c-client-cert")).not.toBeNull();
    expect(field("c-client-key")).not.toBeNull();
    expect(document.querySelector("label[for=c-secret]")?.textContent).toContain("Key passphrase");
  });

  it("needs the certificate file, and a key file unless it is a .pfx", async () => {
    const test = newCertConnection();
    await clickTest();
    expect(error()).toContain("certificate file");
    set("c-client-cert", "C:\\certs\\reader.crt");
    await clickTest();
    expect(error()).toContain("key file");
    expect(test).not.toHaveBeenCalled();
  });

  it("tests with a .pfx alone and no passphrase", async () => {
    const test = newCertConnection();
    set("c-client-cert", "C:\\certs\\reader.pfx");
    await clickTest();
    await vi.waitFor(() => expect(test).toHaveBeenCalled());
    const [config, secret] = test.mock.calls[0];
    expect(config).toMatchObject({ auth: "certificate", user: "reader", clientCertificateFile: "C:\\certs\\reader.pfx", clientKeyFile: null });
    expect(secret).toBe("");
  });

  it("keeps a saved passphrase while the files stay the same, and asks for nothing when they change", async () => {
    const test = open(saved);
    await clickTest();
    await vi.waitFor(() => expect(test).toHaveBeenCalledTimes(1));
    expect(test.mock.calls[0][1]).toBeUndefined();

    set("c-client-key", "C:\\certs\\other.key");
    await clickTest();
    await vi.waitFor(() => expect(test).toHaveBeenCalledTimes(2));
    expect(test.mock.calls[1][1]).toBe("");
  });

  it("sends no certificate files with another sign-in", async () => {
    const test = open(saved);
    set("c-auth", "password");
    set("c-secret", "pw");
    await clickTest();
    await vi.waitFor(() => expect(test).toHaveBeenCalled());
    expect(test.mock.calls[0][0]).toMatchObject({ clientCertificateFile: null, clientKeyFile: null });
  });
});
