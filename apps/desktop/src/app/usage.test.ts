import { describe, expect, it } from "vitest";
import { age, connectionRecent, EMPTY_USAGE, ENV_RECENT_KEEP, envRecent, HOST_RECENT_KEEP, loadUsage, recordUse, RECENT_KEEP, saveUsage, type Place } from "./usage";

const place = (over: Partial<Place> = {}): Place => ({
  envId: "env:prod", hostId: "conn:a", hostName: "uk-prod-sql-01", nodeId: "conn:a/db:orders/o:t1", label: "dbo.Orders", kind: "table", ...over,
});

describe("recordUse", () => {
  it("counts uses and stamps the environment's last use", () => {
    const u = recordUse(recordUse(EMPTY_USAGE, place(), 10), place(), 20);
    expect(u.envs["env:prod"]).toEqual({ last: 20, uses: 2 });
  });

  it("keeps the last place and recent objects newest first, without duplicates", () => {
    let u = recordUse(EMPTY_USAGE, place(), 1);
    u = recordUse(u, place({ nodeId: "x", label: "dbo.Lines" }), 2);
    u = recordUse(u, place(), 3);
    expect(u.last?.label).toBe("dbo.Orders");
    expect(u.recent.map((r) => r.label)).toEqual(["dbo.Orders", "dbo.Lines"]);
  });

  it("does not list a connection itself as a recent object, but remembers it as the last place", () => {
    const u = recordUse(EMPTY_USAGE, place({ nodeId: "conn:a", label: "uk-prod-sql-01", kind: "connection" }), 1);
    expect(u.recent).toEqual([]);
    expect(u.last?.kind).toBe("connection");
  });

  it("records a place in no environment without touching any environment's use", () => {
    const u = recordUse(EMPTY_USAGE, place({ envId: undefined, hostId: "conn:a" }), 1);
    expect(u.envs).toEqual({});
    expect(u.last?.hostId).toBe("conn:a");
    expect(u.recent).toHaveLength(1);
  });

  it(`keeps ${RECENT_KEEP} recent objects`, () => {
    let u = EMPTY_USAGE;
    for (let i = 0; i < RECENT_KEEP + 5; i++) u = recordUse(u, place({ nodeId: `n${i}` }), i);
    expect(u.recent).toHaveLength(RECENT_KEEP);
    expect(u.recent[0].nodeId).toBe(`n${RECENT_KEEP + 4}`);
  });
});

describe("loadUsage / saveUsage", () => {
  it("round-trips, and falls back to empty on missing or broken data", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(loadUsage(storage)).toEqual(EMPTY_USAGE);
    const u = recordUse(EMPTY_USAGE, place(), 5);
    saveUsage(u, storage);
    expect(loadUsage(storage)).toEqual(u);
    store.set("panoptic.usage", "{not json");
    expect(loadUsage(storage)).toEqual(EMPTY_USAGE);
  });

  it("rewrites connection ids saved before they dropped the environment (env:x/conn:y to conn:y)", () => {
    const old = {
      envs: { "env:prod": { last: 1, uses: 2 } },
      last: place({ hostId: "env:prod/conn:a", nodeId: "env:prod/conn:a/db:orders/o:t1" }),
      recent: [place({ hostId: "env:prod/conn:a", nodeId: "env:prod/conn:a/db:orders/o:t1" }), place({ hostId: "conn:b", nodeId: "conn:b/db:x" })],
    };
    const storage = { getItem: () => JSON.stringify(old), setItem: () => {} };
    const u = loadUsage(storage);
    expect(u.last).toMatchObject({ envId: "env:prod", hostId: "conn:a", nodeId: "conn:a/db:orders/o:t1" });
    expect(u.recent.map((r) => [r.hostId, r.nodeId])).toEqual([["conn:a", "conn:a/db:orders/o:t1"], ["conn:b", "conn:b/db:x"]]);
    expect(u.envs).toEqual(old.envs);
  });

  it("falls back quietly when touching local storage itself throws (blocked site data)", () => {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("SecurityError"); } });
    try {
      expect(loadUsage()).toEqual(EMPTY_USAGE);
      expect(() => saveUsage(EMPTY_USAGE)).not.toThrow();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe("an environment's recent objects", () => {
  it("keeps objects per environment, newest first, stamped, without duplicates or connections", () => {
    let u = recordUse(EMPTY_USAGE, place(), 1_000);
    u = recordUse(u, place({ envId: "env:uat", nodeId: "conn:u/db:x", label: "dbo.Settle" }), 2_000);
    u = recordUse(u, place({ nodeId: "conn:a/db:orders/o:t2", label: "dbo.Lines" }), 3_000);
    u = recordUse(u, place(), 4_000);
    u = recordUse(u, place({ nodeId: "conn:a", label: "uk-prod-sql-01", kind: "connection" }), 5_000);
    expect(envRecent(u, "env:prod").map((r) => [r.label, r.at])).toEqual([["dbo.Orders", 4_000], ["dbo.Lines", 3_000]]);
    expect(envRecent(u, "env:uat").map((r) => r.label)).toEqual(["dbo.Settle"]);
    expect(envRecent(u, "env:none")).toEqual([]);
  });

  it(`keeps ${ENV_RECENT_KEEP} per environment and shows the newest few`, () => {
    let u = EMPTY_USAGE;
    for (let i = 0; i < ENV_RECENT_KEEP + 5; i++) u = recordUse(u, place({ nodeId: `n${i}` }), i);
    expect(u.envRecent?.["env:prod"]).toHaveLength(ENV_RECENT_KEEP);
    expect(envRecent(u, "env:prod").map((r) => r.nodeId)).toEqual(["n54", "n53", "n52", "n51", "n50"]);
  });

  it("a place in no environment has no environment list", () => {
    expect(recordUse(EMPTY_USAGE, place({ envId: undefined }), 1).envRecent ?? {}).toEqual({});
  });

  it("survives a save and load, and loads stores written before it existed", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveUsage(recordUse(EMPTY_USAGE, place(), 7), storage);
    expect(envRecent(loadUsage(storage), "env:prod").map((r) => r.at)).toEqual([7]);
    store.set("panoptic.usage", JSON.stringify({ envs: {}, recent: [] }));
    expect(envRecent(loadUsage(storage), "env:prod")).toEqual([]);
    store.set("panoptic.usage", JSON.stringify({ envs: {}, recent: [], envRecent: "junk" }));
    expect(envRecent(loadUsage(storage), "env:prod")).toEqual([]);
  });

  it("reads an age the way the Recent card shows it", () => {
    expect(age(20_000)).toBe("now");
    expect(age(4 * 60_000 + 10)).toBe("4m");
    expect(age(22 * 60_000)).toBe("22m");
    expect(age(60 * 60_000)).toBe("1h");
    expect(age(26 * 3_600_000)).toBe("1d");
  });
});

describe("a connection's recent objects", () => {
  it("keeps objects per connection, newest first, in an environment or not, without connections themselves", () => {
    let u = recordUse(EMPTY_USAGE, place({ database: "orders" }), 1_000);
    u = recordUse(u, place({ hostId: "conn:b", nodeId: "conn:b/db:x/o:t", label: "dbo.Other" }), 2_000);
    u = recordUse(u, place({ envId: undefined, nodeId: "conn:a/db:orders/o:t2", label: "dbo.Lines" }), 3_000);
    u = recordUse(u, place({ nodeId: "conn:a", label: "uk-prod-sql-01", kind: "connection" }), 4_000);
    expect(connectionRecent(u, "conn:a").map((r) => [r.label, r.at, r.database])).toEqual([["dbo.Lines", 3_000, undefined], ["dbo.Orders", 1_000, "orders"]]);
    expect(connectionRecent(u, "conn:b").map((r) => r.label)).toEqual(["dbo.Other"]);
    expect(connectionRecent(u, "conn:none")).toEqual([]);
  });

  it(`keeps ${HOST_RECENT_KEEP} per connection and shows the newest five`, () => {
    let u = EMPTY_USAGE;
    for (let i = 0; i < HOST_RECENT_KEEP + 5; i++) u = recordUse(u, place({ nodeId: `n${i}` }), i);
    expect(u.hostRecent?.["conn:a"]).toHaveLength(HOST_RECENT_KEEP);
    expect(connectionRecent(u, "conn:a").map((r) => r.nodeId)).toEqual(["n24", "n23", "n22", "n21", "n20"]);
  });

  it("also finds what the environments' lists held for it from before, each place once at its newest", () => {
    const before = { ...EMPTY_USAGE, envRecent: { "env:old": [{ ...place({ envId: "env:old" }), at: 500 }, { ...place({ nodeId: "conn:a/db:orders/o:t9", label: "dbo.Gone" }), at: 400 }] } };
    const u = recordUse(before, place(), 900);
    expect(connectionRecent(u, "conn:a").map((r) => [r.label, r.at])).toEqual([["dbo.Orders", 900], ["dbo.Gone", 400]]);
  });

  it("reads the per-connection lists back from storage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveUsage(recordUse(EMPTY_USAGE, place({ envId: undefined }), 7), storage);
    expect(connectionRecent(loadUsage(storage), "conn:a").map((r) => [r.label, r.at])).toEqual([["dbo.Orders", 7]]);
  });
});
