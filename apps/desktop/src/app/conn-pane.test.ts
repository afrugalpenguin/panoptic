import { describe, expect, it } from "vitest";
import type { EnvironmentConfig, TreeNode } from "./api";
import { BUILTIN_KINDS } from "./builtin-kinds";
import { authLabel, databases, placeText, secretPlace, writePolicy } from "./conn-pane";
import { keepsSecret } from "./sign-in.svelte";

const prod: EnvironmentConfig = { id: "prod", name: "Prod", color: "#e03131", readOnly: true, connections: [] };
const dev: EnvironmentConfig = { ...prod, id: "dev", name: "Dev", readOnly: false };

describe("connection pane wording", () => {
  it("places the connection in its environment, or none", () => {
    expect(placeText(prod, 2, 8)).toBe("Connection · 2 of 8 in Prod");
    expect(placeText(undefined, 1, 3)).toBe("Loose connection");
  });

  it("takes the write policy from the environment, and allows writes with none", () => {
    expect(writePolicy(prod)).toEqual({ readOnly: true, value: "Read-only", tag: "inherited", summary: "writes read-only from Prod" });
    expect(writePolicy(dev)).toEqual({ readOnly: false, value: "Allowed", tag: "inherited", summary: "writes allowed from Dev" });
    expect(writePolicy(undefined)).toEqual({ readOnly: false, value: "Allowed", tag: "no environment", summary: "writes allowed, no environment" });
  });

  it("names the sign-in as the sidecar labels it", () => {
    const sql = BUILTIN_KINDS.find((k) => k.kind === "sql");
    expect(authLabel(sql, "sql")).toBe("SQL login");
    expect(authLabel(sql, "entra")).toBe("Microsoft Entra ID");
    expect(authLabel(undefined, "key")).toBe("key");
  });

  it("puts passwords, keys and passphrases in the encrypted store, and says none for sign-ins that keep nothing", () => {
    for (const auth of ["sql", "password", "key", "certificate"] as const) expect(secretPlace(auth).value).toBe("Encrypted store");
    for (const auth of ["entra", "entraKeys", "windows", "awsIam"] as const) expect(secretPlace(auth).value).toBe("none");
  });

  it("counts only database children", () => {
    const n = (id: string, kind: string): TreeNode => ({ id, kind, label: id, icon: kind, hasChildren: true, actions: [] });
    expect(databases([n("a", "database"), n("f", "folder"), n("b", "database")]).map((d) => d.id)).toEqual(["a", "b"]);
    expect(databases(undefined)).toEqual([]);
  });
});

describe("keepsSecret", () => {
  const saved = { id: "c1", name: "orders", kind: "sql", endpoint: "orders.example.test", auth: "sql" as const, user: "reader", trustServerCertificate: false };

  it("keeps the secret while the edit points where it was saved for", () => {
    expect(keepsSecret(saved, { ...saved, name: "renamed", database: "Sales" })).toBe(true);
    expect(keepsSecret(saved, { ...saved, endpoint: "ORDERS.example.test" })).toBe(true);
  });

  it("drops it for another host, sign-in, user or certificate trust", () => {
    expect(keepsSecret(saved, { ...saved, endpoint: "orders-2.example.test" })).toBe(false);
    expect(keepsSecret(saved, { ...saved, auth: "entra" })).toBe(false);
    expect(keepsSecret(saved, { ...saved, user: "writer" })).toBe(false);
    expect(keepsSecret(saved, { ...saved, trustServerCertificate: true })).toBe(false);
    expect(keepsSecret(saved, { ...saved, certificateHostName: "other.example.test" })).toBe(false);
  });
});
