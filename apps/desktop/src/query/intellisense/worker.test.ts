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
