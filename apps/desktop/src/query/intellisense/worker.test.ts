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

  it("does not let one suggestion supersede another", async () => {
    const client = new IntelliSenseClient(() => fakeWorker([]));
    const [a, b] = await Promise.all([
      client.suggest({ number: 208, parts: ["contract"], tables: [] }, keys),
      client.suggest({ number: 2812, parts: ["Archiv"], tables: [] }, keys),
    ]);
    expect([a.suggestion?.label, b.suggestion?.label]).toEqual(["dbo.Contracts", "dbo.Archive"]);
  });
});
