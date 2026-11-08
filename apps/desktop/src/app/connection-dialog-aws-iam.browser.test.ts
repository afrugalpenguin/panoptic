// Postgres sign-in to Amazon RDS with an IAM token (#121): a user, an optional AWS profile and a region that is read
// from an RDS server name when blank. No secret is stored.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./app.css";
import type { Api, ConnectionConfig } from "./api";
import { BUILTIN_KINDS } from "./builtin-kinds";
import ConnectionDialog from "./ConnectionDialog.svelte";

const RDS = "orders.abc123example.eu-west-2.rds.amazonaws.com";

const saved: ConnectionConfig = {
  id: "c1", name: "Orders", kind: "postgres", endpoint: RDS, auth: "awsIam", user: "reader",
  database: null, tenantId: null, trustServerCertificate: false, awsProfile: "orders-ro", awsRegion: null,
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

function newIamConnection(endpoint = RDS) {
  const test = open();
  set("c-kind", "postgres");
  set("c-endpoint", endpoint);
  set("c-auth", "awsIam");
  set("c-user", "reader");
  return test;
}

describe("AWS IAM sign-in", () => {
  it("is offered for Postgres", () => {
    open();
    set("c-kind", "postgres");
    expect([...(field("c-auth") as HTMLSelectElement).options].map((o) => o.textContent)).toContain("AWS IAM (RDS)");
  });

  it("shows the user, profile and region, and no password", () => {
    newIamConnection();
    expect(field("c-user")).not.toBeNull();
    expect((field("c-aws-profile") as HTMLInputElement).placeholder).toBe("default");
    expect(field("c-aws-region")).not.toBeNull();
    expect(field("c-secret")).toBeNull();
  });

  it("shows the region read from an RDS server name, and asks for one otherwise", () => {
    newIamConnection();
    expect((field("c-aws-region") as HTMLInputElement).placeholder).toBe("eu-west-2");
    set("c-endpoint", "localhost:5432");
    expect((field("c-aws-region") as HTMLInputElement).placeholder).toBe("Required for this server name");
    set("c-cert-host", RDS);
    expect((field("c-aws-region") as HTMLInputElement).placeholder).toBe("eu-west-2");
  });

  it("needs a user, and a region for a server name it can't read one from", async () => {
    const test = newIamConnection("localhost:5432");
    await clickTest();
    expect(error()).toContain("region");
    set("c-user", "");
    await clickTest();
    expect(error()).toContain("User is required");
    expect(test).not.toHaveBeenCalled();
  });

  it("tests with the profile and no secret", async () => {
    const test = newIamConnection();
    set("c-aws-profile", "orders-ro");
    await clickTest();
    await vi.waitFor(() => expect(test).toHaveBeenCalled());
    const [config, secret] = test.mock.calls[0];
    expect(config).toMatchObject({ auth: "awsIam", user: "reader", awsProfile: "orders-ro", awsRegion: null });
    expect(secret).toBe("");
  });

  it("tests a tunnel with its region", async () => {
    const test = newIamConnection("localhost:5432");
    set("c-aws-region", "eu-west-2");
    await clickTest();
    await vi.waitFor(() => expect(test).toHaveBeenCalled());
    expect(test.mock.calls[0][0]).toMatchObject({ endpoint: "localhost:5432", awsRegion: "eu-west-2" });
  });

  it("sends no AWS settings with another sign-in", async () => {
    const test = open(saved);
    set("c-auth", "password");
    set("c-secret", "pw");
    await clickTest();
    await vi.waitFor(() => expect(test).toHaveBeenCalled());
    expect(test.mock.calls[0][0]).toMatchObject({ awsProfile: null, awsRegion: null });
  });
});
