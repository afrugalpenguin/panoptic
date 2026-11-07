// The dialog knows no engine of its own: types, endpoint label, auths and optional fields all come from the sidecar's
// backends.describe (#203), so a new backend shows up here without a UI change.
import { flushSync, mount, unmount } from "svelte";
import { afterEach, describe, expect, it } from "vitest";
import "./app.css";
import type { Api, KindDescription } from "./api";
import { BUILTIN_KINDS } from "./builtin-kinds";
import ConnectionDialog from "./ConnectionDialog.svelte";

const mysql: KindDescription = {
  kind: "mysql",
  label: "MySQL",
  endpointLabel: "Host",
  endpointPlaceholder: "db.fabrikam.test:3306",
  auths: [{ id: "password", label: "Username and password" }],
  badge: { letters: "My", color: "#00758f", name: "MySQL" },
  fields: { database: false, certificateOptions: false, entraUser: false, trustLocalOnly: false },
};

let mounted: Record<string, unknown> | undefined;
afterEach(() => {
  if (mounted) unmount(mounted);
  mounted = undefined;
  document.body.innerHTML = "";
});

function open(kinds: KindDescription[]) {
  const target = document.createElement("div");
  document.body.append(target);
  mounted = mount(ConnectionDialog, {
    target,
    props: { api: {} as Api, kinds, environments: [], onSaved: () => {}, onEnvironmentCreated: () => {}, onClose: () => {} },
  });
  flushSync();
}

const options = (id: string) => [...document.querySelectorAll<HTMLOptionElement>(`#${id} option`)].map((o) => o.textContent);
const label = (forId: string) => document.querySelector(`label[for=${forId}]`)?.textContent ?? null;

function pick(kind: string) {
  const select = document.getElementById("c-kind") as HTMLSelectElement;
  select.value = kind;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  flushSync();
}

describe("connection dialog focus", () => {
  it("opens on the Server field, not the optional Environment picker", () => {
    open(BUILTIN_KINDS);
    expect(document.activeElement?.id).toBe("c-endpoint");
  });
});

describe("connection kinds from the sidecar", () => {
  it("lists the described kinds, first one picked", () => {
    open(BUILTIN_KINDS);

    expect(options("c-kind")).toEqual(BUILTIN_KINDS.map((k) => k.label));
    expect(label("c-endpoint")).toBe("Server");
    expect(options("c-auth")).toEqual(["Microsoft Entra ID", "SQL login", "Windows"]);
  });

  it("shows a kind the UI has never heard of as described", () => {
    open([...BUILTIN_KINDS, mysql]);

    pick("mysql");

    expect(label("c-endpoint")).toBe("Host");
    expect((document.getElementById("c-endpoint") as HTMLInputElement).placeholder).toBe("db.fabrikam.test:3306");
    expect(options("c-auth")).toEqual(["Username and password"]);
    expect(document.getElementById("c-db")).toBeNull();
    expect(document.getElementById("c-cert-host")).toBeNull();
  });

  it("hides the database and certificate fields for Cosmos, and labels its trust option as emulator only", () => {
    open(BUILTIN_KINDS);

    pick("cosmos");

    expect(label("c-endpoint")).toBe("Account URI");
    expect(document.getElementById("c-db")).toBeNull();
    expect(document.getElementById("c-cert-host")).toBeNull();
    expect(document.querySelector(".check")?.textContent).toContain("localhost emulator only");
  });
});
