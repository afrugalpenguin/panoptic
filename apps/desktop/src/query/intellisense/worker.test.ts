import { describe, expect, it } from "vitest";
import type { DatabaseCatalog } from "../catalog.svelte";
import { IntelliSenseClient, type WorkerLike } from "./client";
import { handle, type CompleteResponse, type Request, type Response } from "./worker";

const main: DatabaseCatalog = { stamp: "m", schemas: ["dbo"], types: [], objects: [{ name: "Main", schema: "dbo", kind: "table", columns: [] }] };
const sales: DatabaseCatalog = { stamp: "s", schemas: ["dbo"], types: [], objects: [{ name: "Invoice", schema: "dbo", kind: "table", columns: [] }] };
const options = { language: "tsql" as const };

describe("worker handle", () => {
  handle({ type: "catalog", key: "kMain", catalog: main });
  handle({ type: "catalog", key: "kSales", catalog: sales });
  const keys = { current: "kMain", databases: { main: "kMain", sales: "kSales" } };
  const completeAt = (text: string, k = keys) =>
    handle({ type: "complete", id: 1, text, offset: text.length, options, keys: k }) as CompleteResponse;

  it("completes from the current database and returns the replace start", () => {
    const r = completeAt("select * from Ma");
    expect(r.items.map((i) => i.label)).toEqual(["Main"]);
    expect(r.start).toBe("select * from ".length);
  });

  it("reads the database named by USE", () => {
    expect(completeAt("use Sales\nselect * from ").items.map((i) => i.label)).toEqual(["Invoice"]);
  });

  it("reports a USE database whose catalog has not arrived", () => {
    expect(completeAt("use Other\nselect * from ").missing).toBe("Other");
  });

  it("hovers", () => {
    const text = "select * from dbo.Main";
    expect(handle({ type: "hover", id: 2, text, offset: text.length, options, keys })).toEqual({ id: 2, markdown: "**dbo.Main** table" });
  });
});

/** Runs handle on a microtask, like a worker answering asynchronously. */
function fakeWorker(log: Request[]): WorkerLike {
  const worker: WorkerLike = {
    onmessage: null,
    postMessage(message) {
      log.push(message);
      queueMicrotask(() => {
        const response = handle(message);
        if (response) worker.onmessage?.({ data: response } as MessageEvent<Response>);
      });
    },
  };
  return worker;
}

describe("IntelliSenseClient", () => {
  it("sends a catalog once per version and creates the worker lazily", async () => {
    const log: Request[] = [];
    let created = 0;
    const client = new IntelliSenseClient(() => (created++, fakeWorker(log)));
    expect(created).toBe(0);
    client.sync("kc", main, 1);
    client.sync("kc", main, 1);
    client.sync("kc", main, 2);
    client.sync("kc", undefined, 3);
    expect(log.filter((m) => m.type === "catalog")).toHaveLength(2);
    expect(created).toBe(1);
    const r = await client.complete("select * from ", 14, options, { current: "kc", databases: {} });
    expect(r.items.map((i) => i.label)).toEqual(["Main"]);
  });

  it("resolves a superseded request empty", async () => {
    const client = new IntelliSenseClient(() => fakeWorker([]));
    client.sync("kc", main, 1);
    const keys = { current: "kc", databases: {} };
    const first = client.complete("select * from ", 14, options, keys);
    const second = client.complete("select * from M", 15, options, keys);
    expect((await first).items).toEqual([]);
    expect((await second).items.map((i) => i.label)).toEqual(["Main"]);
  });
});

describe("worker suggest and lint", () => {
  handle({ type: "catalog", key: "kS", catalog: { stamp: "x", schemas: ["dbo"], types: [], objects: [
    { name: "Contracts", schema: "dbo", kind: "table", columns: [{ name: "Signed", type: "date", nullable: true }] },
    { name: "Archive", schema: "dbo", kind: "proc", params: [] },
  ] } });
  const keys = { current: "kS", databases: { s: "kS" } };
  const suggest = (number: number, parts: string[], tables = [] as { name: string }[]) =>
    (handle({ type: "suggest", id: 3, number, parts, tables, keys }) as { suggestion?: { label: string } }).suggestion?.label;

  it("suggests an object for 208, a procedure for 2812 and a column for 207", () => {
    expect(suggest(208, ["contract"])).toBe("dbo.Contracts");
    expect(suggest(2812, ["Archiv"])).toBe("dbo.Archive");
    expect(suggest(207, ["Signd"], [{ name: "Contracts" }])).toBe("Signed");
    expect(suggest(4104, ["c", "Signd"], [{ name: "Contracts" }])).toBeUndefined();
  });

  it("lints the statement at the offset", () => {
    const text = "select * from Contrcts";
    expect(handle({ type: "lint", id: 4, text, offset: 0, keys })).toEqual({ id: 4, warnings: [{ start: 14, end: 22, message: "Unknown table or view 'Contrcts'." }] });
  });

  it("lints in the request's language", () => {
    const text = 'select * from "Contrcts"';
    expect(handle({ type: "lint", id: 5, text, offset: 0, keys, language: "pgsql" })).toEqual({
      id: 5, warnings: [{ start: 14, end: 24, message: "Unknown table or view 'Contrcts'." }],
    });
    expect(handle({ type: "lint", id: 6, text: "select $$ from Contrcts $$", offset: 0, keys, language: "pgsql" })).toEqual({ id: 6, warnings: [] });
  });

  it("adds T-SQL habit warnings for Postgres, with or without the unknown-name check", () => {
    handle({ type: "catalog", key: "kShim", catalog: { stamp: "h", schemas: ["public"], types: [], objects: [
      { name: "t", schema: "public", kind: "table", columns: [{ name: "a", type: "int", nullable: true }] },
      { name: "isnull", schema: "public", kind: "fn", params: [] },
    ] } });
    const shim = { current: "kShim", databases: {} };
    const text = "select top 1 isnull(a, 0), len(a) from tt";
    const covered = (r: Response | undefined) => (r as { warnings: { start: number; end: number }[] }).warnings.map((w) => text.slice(w.start, w.end));
    expect(covered(handle({ type: "lint", id: 7, text, offset: 0, keys: shim, language: "pgsql" }))).toEqual(["top 1", "len", "tt"]);
    expect(covered(handle({ type: "lint", id: 8, text, offset: 0, keys: shim, language: "pgsql", unknownNames: false }))).toEqual(["top 1", "len"]);
    expect(covered(handle({ type: "lint", id: 9, text: "select top 1 * from Contracts", offset: 0, keys }))).toEqual([]);
  });

  it("suggests for Postgres SQLSTATEs: 42P01 an object, 42703 a column, 42883 a routine", () => {
    handle({ type: "catalog", key: "kPg", catalog: { stamp: "p", schemas: ["public"], types: [], objects: [
      { name: "customer", schema: "public", kind: "table", columns: [{ name: "full_name", type: "text", nullable: true }] },
      { name: "order_total", schema: "public", kind: "fn", params: [] },
    ] } });
    const pgKeys = { current: "kPg", databases: {} };
    const pg = (state: string, parts: string[], tables = [] as { name: string }[]) =>
      (handle({ type: "suggest", id: 4, number: 0, state, language: "pgsql", parts, tables, keys: pgKeys }) as { suggestion?: { label: string } }).suggestion?.label;
    expect(pg("42P01", ["custmer"])).toBe("public.customer");
    expect(pg("42703", ["fullname"], [{ name: "customer" }])).toBe("full_name");
    expect(pg("42883", ["order_totl"])).toBe("public.order_total");
    expect(pg("42601", ["custmer"])).toBeUndefined();
  });

  it("does not let one suggestion supersede another", async () => {
    const client = new IntelliSenseClient(() => fakeWorker([]));
    const [a, b] = await Promise.all([
      client.suggest({ number: 208, parts: ["contract"], tables: [] }, keys),
      client.suggest({ number: 2812, parts: ["Archiv"], tables: [] }, keys),
    ]);
    expect([a.suggestion?.label, b.suggestion?.label]).toEqual(["dbo.Contracts", "dbo.Archive"]);
  });
});
