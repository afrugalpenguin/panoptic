import { describe, expect, it } from "vitest";
import type { EnvironmentConfig, TreeNode } from "./api";
import { BUILTIN_KINDS } from "./builtin-kinds";
import { ago, attentionTitle, authLabel, catalogLine, catalogState, databases, databaseSummary, placeText, secretPlace, tokenLeft, writePolicy } from "./conn-pane";
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

describe("connection pane server wording (phase 2)", () => {
  it("says how long ago a session opened", () => {
    expect(ago(20_000)).toBe("just now");
    expect(ago(2 * 60_000 + 5_000)).toBe("2 min ago");
    expect(ago(3 * 3_600_000)).toBe("3 h ago");
    expect(ago(50 * 3_600_000)).toBe("2 d ago");
    expect(ago(-5_000)).toBe("just now");
  });

  it("says how long the token has left, or that it ran out", () => {
    const now = 1_000_000_000;
    expect(tokenLeft(now + 42 * 60_000 + 1, now)).toBe("token 42 min left");
    expect(tokenLeft(now + 2 * 3_600_000 + 1, now)).toBe("token 2 h left");
    expect(tokenLeft(now - 1, now)).toBe("token expired");
  });

  it("counts databases and groups the ones that are not online by state", () => {
    expect(databaseSummary({ total: 12, online: 9, notOnline: [{ name: "a", state: "restoring", error: false }, { name: "b", state: "suspect", error: true }, { name: "c", state: "restoring", error: false }] })).toEqual({
      text: "12 · 9 online",
      pills: [{ state: "restoring", count: 2, error: false }, { state: "suspect", count: 1, error: true }],
    });
    expect(databaseSummary({ total: 4, online: 4, notOnline: [] })).toEqual({ text: "4 · 4 online", pills: [] });
  });

  it("heads Needs attention by what the items are", () => {
    expect(attentionTitle([{ group: "database" }])).toBe("1 database needs attention");
    expect(attentionTitle([{ group: "database" }, { group: "database" }])).toBe("2 databases need attention");
    expect(attentionTitle([{ group: "database" }, { group: "token" }])).toBe("2 items need attention");
  });
});

describe("connection pane catalog wording (phase 3)", () => {
  const info = (snapshots: number, newestAt: number | null = null) => ({ state: "warm", snapshots, newestAt, failures: [] });
  const now = 10_000_000;

  it("names the state with its colour", () => {
    expect(catalogState("warm")).toEqual({ word: "warm", color: "var(--ok)" });
    expect(catalogState("refreshing")).toEqual({ word: "refreshing", color: "var(--warn)" });
    expect(catalogState("cold")).toEqual({ word: "cold", color: "var(--tree-dim)" });
  });

  it("counts snapshots against the server's databases when the describe has them, never more than there are", () => {
    expect(catalogLine(info(3, now - 4 * 60_000), 12, now)).toBe("3 of 12 databases · 4 min ago");
    expect(catalogLine(info(2), 1, now)).toBe("1 of 1 database");
    expect(catalogLine(info(1, now), undefined, now)).toBe("1 database · just now");
    expect(catalogLine(info(0), 12, now)).toBe("no snapshots yet");
  });
});
