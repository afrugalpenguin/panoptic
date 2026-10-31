import { describe, expect, it } from "vitest";
import { ENV_CAP, livePlace, liveUsage, MAX_ROWS, seek, seekKey, seekSummary, type SeekEnv, type SeekHost, type SeekIndex, type SeekRow } from "./seek";
import type { Place } from "./usage";

const host = (env: string, name: string) => ({ id: `env:${env}/conn:${name}`, name, envId: `env:${env}` });
const env = (id: string, name: string, hosts: string[]): SeekEnv => ({ id: `env:${id}`, name, hosts: hosts.map((h) => host(id, h)) });
const envs = [env("dev", "Dev", ["dev-sql-01", "uk-dev-pg"]), env("prod", "Prod", ["uk-prod-sql-01", "uk-prod-sql-02", "us-prod-sql-01"]), env("uat", "UAT", ["uat-sql-01"])];
const orders: Place = { envId: "env:prod", hostId: "env:prod/conn:uk-prod-sql-01", hostName: "uk-prod-sql-01", nodeId: "n1", label: "dbo.Orders", kind: "table" };
const lines: Place = { ...orders, nodeId: "n2", label: "dbo.Lines" };
const index: SeekIndex = {
  envs,
  usage: { envs: { "env:uat": { last: 30, uses: 1 }, "env:prod": { last: 20, uses: 9 }, "env:dev": { last: 20, uses: 3 } }, last: orders, recent: [orders, lines] },
};

const show = (rows: SeekRow[]) =>
  rows.map((r) => (r.kind === "env" ? `env ${r.env.name}` : r.kind === "host" ? `host ${r.host.name}` : r.kind === "recent" ? `recent ${r.place.label}` : r.kind === "resume" ? `resume ${r.place.label}` : `more ${r.count}`));

describe("seek: nothing typed", () => {
  it("picks up where you left off, then environments by last use (uses break ties), then recent objects", () => {
    expect(show(seek(index, ""))).toEqual(["resume dbo.Orders", "env UAT", "env Prod", "env Dev", "recent dbo.Lines"]);
  });

  it("caps environments at five with a 'more' hint, and never shows more than nine rows", () => {
    const many: SeekIndex = { envs: Array.from({ length: 30 }, (_, i) => env(`e${i}`, `Env ${i}`, [`h${i}`])), usage: { envs: {}, last: orders, recent: [orders, lines, { ...orders, nodeId: "n3", label: "a" }, { ...orders, nodeId: "n4", label: "b" }] } };
    const rows = seek(many, "");
    expect(rows.filter((r) => r.kind === "env")).toHaveLength(ENV_CAP);
    expect(rows.find((r) => r.kind === "more")).toEqual({ kind: "more", group: "envs", count: 25 });
    expect(rows.filter((r) => r.kind !== "more").length).toBeLessThanOrEqual(MAX_ROWS);
  });

  it("shows nothing but an empty list with no environments", () => {
    expect(seek({ envs: [], usage: { envs: {}, recent: [] } }, "")).toEqual([]);
  });

  it("drops a remembered place whose connection no longer exists (removed from config)", () => {
    const gone: Place = { ...orders, envId: "env:old", hostId: "env:old/conn:x", nodeId: "n9", label: "dbo.Gone" };
    const stale: SeekIndex = { envs, usage: { envs: {}, last: gone, recent: [gone, lines] } };
    expect(show(seek(stale, ""))).not.toContain("resume dbo.Gone");
    expect(show(seek(stale, "")).filter((r) => r.includes("Gone"))).toEqual([]);
    expect(show(seek(stale, "", "connections"))[0]).toBe("host dev-sql-01");
  });
});

describe("seek: typed", () => {
  it("'prod': the environment, then its connections, then its recent objects", () => {
    expect(show(seek(index, "prod"))).toEqual(["env Prod", "host uk-prod-sql-01", "host uk-prod-sql-02", "host us-prod-sql-01", "recent dbo.Orders", "recent dbo.Lines"]);
  });

  it("'uk prod': tokens AND across environment and host, so Prod ranks with only its uk hosts under it", () => {
    expect(show(seek(index, "uk prod"))).toEqual(["env Prod", "host uk-prod-sql-01", "host uk-prod-sql-02", "recent dbo.Orders", "recent dbo.Lines"]);
  });

  it("finds an environment through a recent object's name", () => {
    expect(show(seek(index, "orders"))).toEqual(["env Prod", "recent dbo.Orders"]);
  });

  it("finds nothing for a word nothing contains", () => {
    expect(seek(index, "zzz")).toEqual([]);
  });
});

describe("seek: connections only (the query tab's picker)", () => {
  it("puts the last used connection first when nothing is typed", () => {
    expect(show(seek(index, "", "connections"))[0]).toBe("host uk-prod-sql-01");
  });

  it("ANDs tokens across environment and host", () => {
    expect(show(seek(index, "uk prod", "connections"))).toEqual(["host uk-prod-sql-01", "host uk-prod-sql-02"]);
  });
});

describe("seekKey", () => {
  const rows = seek(index, ""); // resume, env UAT, env Prod, env Dev, recent dbo.Lines
  const key = (key: string, active: number, query = "", mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}) =>
    seekKey({ key, ctrlKey: !!mods.ctrlKey, shiftKey: !!mods.shiftKey }, rows, active, query);

  it("moves with the arrows, within the list", () => {
    expect(key("ArrowDown", 0)).toEqual({ kind: "move", index: 1 });
    expect(key("ArrowUp", 0)).toEqual({ kind: "move", index: 0 });
    expect(key("ArrowDown", 4)).toEqual({ kind: "move", index: 4 });
  });

  it("Enter opens, Ctrl+Enter queries the highlighted row", () => {
    expect(key("Enter", 2)).toEqual({ kind: "open", row: rows[2] });
    expect(key("Enter", 2, "", { ctrlKey: true })).toEqual({ kind: "query", row: rows[2] });
  });

  it("Tab jumps to the next group's first row, and leaves after the last group", () => {
    expect(key("Tab", 0)).toEqual({ kind: "move", index: 1 });
    expect(key("Tab", 2)).toEqual({ kind: "move", index: 4 });
    expect(key("Tab", 4)).toBeUndefined();
    expect(key("Tab", 0, "", { shiftKey: true })).toBeUndefined();
  });

  it("Esc clears a query, then leaves", () => {
    expect(key("Escape", 0, "prod")).toEqual({ kind: "clear" });
    expect(key("Escape", 0, "")).toEqual({ kind: "leave" });
  });
});

describe("livePlace", () => {
  it("is the last place while its connection exists, and nothing once it is gone", () => {
    expect(livePlace(index)).toEqual(orders);
    expect(livePlace({ envs, usage: { envs: {}, last: { ...orders, hostId: "gone" }, recent: [] } })).toBeUndefined();
    expect(livePlace({ envs, usage: { envs: {}, recent: [] } })).toBeUndefined();
  });
});

// Connections in no environment (docs/landing.md, "Seek").
const loose = (name: string): SeekHost => ({ id: `conn:${name}`, name });
const lonePlace = (name: string, label: string, nodeId: string): Place => ({ hostId: `conn:${name}`, hostName: name, nodeId, label, kind: "table" });

describe("liveUsage", () => {
  it("looks each place's environment up from its connection: moved ones follow, removed ones go", () => {
    const moved: Place = { ...orders, envId: "env:old" };
    const unhomed: Place = { ...lines, envId: "env:prod", hostId: "conn:orders-sql", hostName: "orders-sql" };
    const gone: Place = { ...orders, hostId: "conn:gone", nodeId: "n9" };
    const usage = liveUsage({ envs, hosts: [loose("orders-sql")], usage: { envs: {}, last: moved, recent: [moved, unhomed, gone] } });
    expect(usage.last).toEqual(orders);
    expect(usage.recent).toEqual([orders, { ...unhomed, envId: undefined }]);
  });
});

describe("seek: connections in no environment", () => {
  const flat: SeekIndex = {
    envs: [],
    hosts: ["alpha-sql", "beta-pg", "gamma-sql", "delta-sql", "eps-sql", "zeta-sql", "orders-sql"].map(loose),
    usage: { envs: {}, last: lonePlace("gamma-sql", "dbo.Last", "g1"), recent: [lonePlace("gamma-sql", "dbo.Last", "g1"), lonePlace("beta-pg", "public.items", "b1")] },
  };
  const mixed: SeekIndex = { ...index, hosts: [loose("orders-sql"), loose("uk-sql")] };

  it("nothing typed, no environments: resume, connections last used first then by name with a hint, then recent", () => {
    const rows = seek(flat, "");
    expect(show(rows)).toEqual([
      "resume dbo.Last",
      "host gamma-sql",
      "host beta-pg",
      "host alpha-sql",
      "host delta-sql",
      "host eps-sql",
      "more 2",
      "recent public.items",
    ]);
    expect(rows.find((r) => r.kind === "more")).toEqual({ kind: "more", group: "hosts", count: 2 });
    const first = rows.find((r): r is Extract<SeekRow, { kind: "host" }> => r.kind === "host");
    expect(first?.env).toBeUndefined();
  });

  it("nothing typed, mixed: environments, then connections in none, then recent", () => {
    expect(show(seek(mixed, ""))).toEqual(["resume dbo.Orders", "env UAT", "env Prod", "env Dev", "host orders-sql", "host uk-sql", "recent dbo.Lines"]);
  });

  it("typed: a connection in no environment matches on its own name, never on an environment's", () => {
    expect(show(seek(mixed, "orders"))).toEqual(["env Prod", "host orders-sql", "recent dbo.Orders"]);
    expect(show(seek(mixed, "prod"))).not.toContain("host uk-sql");
    expect(show(seek(mixed, "uk sql"))).toEqual(["env Prod", "env Dev", "host uk-prod-sql-01", "host uk-prod-sql-02", "host uk-sql", "recent dbo.Orders", "recent dbo.Lines"]);
  });

  it("typed with no environment matching still finds connections in none, and their recent objects", () => {
    expect(show(seek(flat, "items"))).toEqual(["recent public.items"]);
    expect(show(seek(flat, "sql"))).toEqual(["host alpha-sql", "host delta-sql", "host eps-sql", "host gamma-sql", "host orders-sql", "host zeta-sql", "recent dbo.Last"]);
  });

  it("connections only: a connection in none matches on its own name", () => {
    expect(show(seek(mixed, "uk", "connections"))).toEqual(["host uk-prod-sql-01", "host uk-prod-sql-02", "host uk-dev-pg", "host uk-sql"]);
    expect(show(seek(mixed, "prod", "connections"))).not.toContain("host uk-sql");
    expect(show(seek(flat, "", "connections"))[0]).toBe("host gamma-sql");
  });
});

describe("seekSummary", () => {
  it("counts environments, or with none, connections", () => {
    expect(seekSummary(3, 10)).toBe("Objects across all 3 environments. Type a table, container, proc or host.");
    expect(seekSummary(1, 10)).toBe("Objects across all 1 environment. Type a table, container, proc or host.");
    expect(seekSummary(0, 4)).toBe("Objects across all 4 connections. Type a table, container, proc or host.");
    expect(seekSummary(0, 1)).toBe("Objects across 1 connection. Type a table, container, proc or host.");
    expect(seekSummary(0, 0)).toBe("No connections yet");
  });
});
