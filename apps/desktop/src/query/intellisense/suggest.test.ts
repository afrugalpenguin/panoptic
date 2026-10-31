import { describe, expect, it } from "vitest";
import type { DatabaseCatalog } from "../catalog.svelte";
import { Index, type Lookup } from "./engine";
import { distance, suggestColumn, suggestObject } from "./suggest";

const catalog: DatabaseCatalog = {
  stamp: "s",
  schemas: ["dbo", "sales"],
  types: [],
  objects: [
    { name: "Contracts", schema: "dbo", kind: "table", columns: [{ name: "Id", type: "int", nullable: false }, { name: "Signed", type: "date", nullable: true }] },
    { name: "Customer", schema: "dbo", kind: "table", columns: [{ name: "Id", type: "int", nullable: false }, { name: "Name", type: "nvarchar(50)", nullable: true }] },
    { name: "GetOrders", schema: "sales", kind: "proc", params: [] },
    { name: "Invoice", schema: "sales", kind: "table", columns: [{ name: "Total", type: "money", nullable: false }] },
    { name: "Order", schema: "sales", kind: "table", columns: [{ name: "Id", type: "bigint", nullable: false }, { name: "CustomerId", type: "int", nullable: false }] },
  ],
};
const index = new Index(catalog);
const lookup: Lookup = (db) => (db === undefined || db.toLowerCase() === "orders" ? index : undefined);

describe("suggestObject", () => {
  it("prefers the same name in another schema, matched case-insensitively", () => {
    expect(suggestObject(index, ["Invoice"], "objects")).toEqual({ label: "sales.Invoice", insertText: "sales.Invoice" });
    expect(suggestObject(index, ["contracts"], "objects")).toEqual({ label: "dbo.Contracts", insertText: "dbo.Contracts" });
  });

  it("then a name the typed one starts", () => {
    expect(suggestObject(index, ["Contr"], "objects")?.label).toBe("dbo.Contracts");
  });

  it("then a name within two edits, quoting where needed", () => {
    expect(suggestObject(index, ["Ordr"], "objects")).toEqual({ label: "sales.Order", insertText: "sales.[Order]" });
    expect(suggestObject(index, ["dbo", "Custmer"], "objects")?.label).toBe("dbo.Customer");
  });

  it("suggests nothing beyond two edits or for three-part names", () => {
    expect(suggestObject(index, ["Shipments"], "objects")).toBeUndefined();
    expect(suggestObject(index, ["Orders", "dbo", "Contract"], "objects")).toBeUndefined();
  });

  it("only procedures for 2812, only tables, views and synonyms otherwise", () => {
    expect(suggestObject(index, ["GetOrder"], "procs")?.label).toBe("sales.GetOrders");
    expect(suggestObject(index, ["GetOrder"], "objects")).toBeUndefined();
    expect(suggestObject(index, ["Invoices"], "procs")).toBeUndefined();
  });
});

describe("suggestColumn", () => {
  it("looks in the statement's tables", () => {
    expect(suggestColumn(lookup, [{ name: "Customer", schema: "dbo" }], "Nmae")).toEqual({ label: "Name", insertText: "Name" });
    expect(suggestColumn(lookup, [{ name: "Customer" }, { name: "Order", schema: "sales" }], "CustomerI")?.label).toBe("CustomerId");
  });

  it("only in the aliased table when the column is qualified", () => {
    const tables = [{ name: "Customer", alias: "c" }, { name: "Invoice", schema: "sales", alias: "i" }];
    expect(suggestColumn(lookup, tables, "Totl", "i")?.label).toBe("Total");
    expect(suggestColumn(lookup, tables, "Totl", "c")).toBeUndefined();
  });

  it("suggests nothing when no table resolves", () => {
    expect(suggestColumn(lookup, [{ name: "Nope" }], "Nmae")).toBeUndefined();
    expect(suggestColumn(lookup, [], "Nmae")).toBeUndefined();
  });
});

describe("distance", () => {
  it("counts insertions, deletions and substitutions, ignoring case", () => {
    expect([distance("Ordr", "order"), distance("abc", "abc"), distance("abc", "xbz"), distance("", "ab")]).toEqual([1, 0, 2, 2]);
  });
});

describe("pgsql", () => {
  const shop: DatabaseCatalog = {
    stamp: "p",
    schemas: ["public", "sales"],
    types: [],
    objects: [
      { name: "customer", schema: "public", kind: "table", columns: [{ name: "full_name", type: "text", nullable: true }, { name: "Signed On", type: "date", nullable: true }] },
      { name: "Order", schema: "sales", kind: "table", columns: [] },
      { name: "order_total", schema: "sales", kind: "fn", params: [] },
      { name: "refresh_totals", schema: "public", kind: "proc", params: [] },
    ],
  };
  const pg = new Index(shop);

  it("double-quotes names that are not plain lower case", () => {
    expect(suggestObject(pg, ["ordr"], "objects", "pgsql")).toEqual({ label: "sales.Order", insertText: 'sales."Order"' });
    expect(suggestColumn(() => pg, [{ name: "customer" }], "signed_on", undefined, "pgsql")).toEqual({ label: "Signed On", insertText: '"Signed On"' });
  });

  it("suggests functions and procedures for an undefined routine", () => {
    expect(suggestObject(pg, ["order_totl"], "routines", "pgsql")?.label).toBe("sales.order_total");
    expect(suggestObject(pg, ["refresh_total"], "routines", "pgsql")?.label).toBe("public.refresh_totals");
    expect(suggestObject(pg, ["ordr"], "routines", "pgsql")).toBeUndefined();
  });

  it("skips the public object the name already resolves to", () => {
    expect(suggestObject(pg, ["customer"], "objects", "pgsql")).toBeUndefined();
  });
});
