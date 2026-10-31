import { describe, expect, it } from "vitest";
import { EMPTY_USAGE, loadUsage, recordUse, RECENT_KEEP, saveUsage, type Place } from "./usage";

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
