import { describe, expect, it } from "vitest";
import { ENV_CAP, MAX_ROWS, seek, type SeekEnv, type SeekIndex, type SeekRow } from "./seek";
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

  it("drops a remembered place whose environment no longer exists (removed from config)", () => {
    const gone: Place = { ...orders, envId: "env:old", nodeId: "n9", label: "dbo.Gone" };
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
