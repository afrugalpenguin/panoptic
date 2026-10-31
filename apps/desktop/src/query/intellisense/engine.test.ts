import { describe, expect, it } from "vitest";
import type { DatabaseCatalog } from "../catalog.svelte";
import { complete, hover, Index, type Lookup, type Options } from "./engine";
import { contextAt } from "./scanner";

const orders: DatabaseCatalog = {
  stamp: "s",
  schemas: ["dbo", "sales"],
  types: ["int", "nvarchar", "date"],
  objects: [
    { name: "Customer", schema: "dbo", kind: "table", columns: [{ name: "Id", type: "int", nullable: false }, { name: "Name", type: "nvarchar(50)", nullable: true }] },
    { name: "Recent", schema: "dbo", kind: "view", columns: [{ name: "Id", type: "int", nullable: false }] },
    { name: "GetOrders", schema: "sales", kind: "proc", params: [{ name: "@since", type: "date", output: false }, { name: "@count", type: "int", output: true }] },
    { name: "Order", schema: "sales", kind: "table", columns: [{ name: "Id", type: "bigint", nullable: false }, { name: "CustomerId", type: "int", nullable: false }, { name: "Total", type: "decimal(18, 2)", nullable: false }] },
    { name: "Orders", schema: "sales", kind: "synonym" },
  ],
};
const archive: DatabaseCatalog = { stamp: "a", schemas: ["dbo", "old"], types: [], objects: [{ name: "Log", schema: "old", kind: "table", columns: [] }] };
const cosmos: DatabaseCatalog = {
  stamp: "c", schemas: [], objects: [], types: [],
  containers: [{ name: "orders", partitionKey: "/tenantId", paths: [
    { path: "address", types: ["object"] }, { path: "address.city", types: ["string"] }, { path: "address.zip", types: ["number", "string"] },
    { path: "lines", types: ["array"] }, { path: "lines[]", types: ["object"] }, { path: "lines[].sku", types: ["string"] }, { path: "tenantId", types: ["string"] },
  ] }],
};

const indexes = new Map([["orders", new Index(orders)], ["archive", new Index(archive)], ["cosmos", new Index(cosmos)]]);
const lookup = (current: string): Lookup => (db) => indexes.get((db ?? current).toLowerCase());
const tsql: Options = { language: "tsql", keywordCase: "lower" };

/** Completes at `|` in source against the Orders catalog (or `current`). */
function run(source: string, options: Options = tsql, current = "orders") {
  const offset = source.indexOf("|");
  const ctx = contextAt(source.replace("|", ""), offset, options.language);
  return complete(lookup(current), ctx.context, options);
}
const labels = (source: string, options?: Options, current?: string) => run(source, options, current).items.map((i) => i.label);

describe("complete: objects", () => {
  it("lists tables, views and synonyms from every schema, dbo marked as dimmed", () => {
    const { items } = run("select * from |");
    expect(items.map((i) => i.label)).toEqual(["Customer", "Recent", "sales.Order", "sales.Orders"]);
    const customer = items[0];
    expect(customer).toMatchObject({ kind: "table", insertText: "dbo.Customer", filterText: "Customer", description: "dbo", dimmed: true });
    expect(items[2]).toMatchObject({ insertText: "sales.[Order]", filterText: "Order" });
  });

  it("only the typed schema's objects, inserting the bare name", () => {
    const { items } = run("select * from sales.|");
    expect(items.map((i) => i.insertText)).toEqual(["[Order]", "Orders"]);
  });

  it("a database qualifier lists its schemas, or reports it missing", () => {
    expect(labels("select * from archive.|")).toEqual(["dbo", "old"]);
    expect(run("select * from Elsewhere.|")).toEqual({ items: [], missing: "Elsewhere" });
    expect(labels("select * from archive.old.|")).toEqual(["Log"]);
  });
});

describe("complete: columns", () => {
  it("columns of every table with alias and type, qualifying names that clash", () => {
    const { items } = run("select | from dbo.Customer c join sales.[Order] o on o.CustomerId = c.Id");
    const columns = items.filter((i) => i.kind === "column");
    expect(columns.map((i) => [i.label, i.description, i.detail, i.insertText])).toEqual([
      ["Id", "c", "int", "c.Id"],
      ["Name", "c", "nvarchar(50)", "Name"],
      ["Id", "o", "bigint", "o.Id"],
      ["CustomerId", "o", "int", "CustomerId"],
      ["Total", "o", "decimal(18, 2)", "Total"],
    ]);
    // Keywords and functions follow, sorted after the columns.
    expect(items.some((i) => i.kind === "keyword")).toBe(true);
    expect(items.findIndex((i) => i.kind === "keyword")).toBeGreaterThan(items.findIndex((i) => i.label === "Total"));
  });

  it("only one table after alias dot", () => {
    expect(labels("select o.| from sales.[Order] o join dbo.Customer c on 1=1")).toEqual(["Id", "CustomerId", "Total"]);
  });

  it("an unknown alias gives nothing and does not throw", () => {
    expect(run("select zz.| from dbo.Customer c").items).toEqual([]);
  });
});

describe("complete: procs, params, variables, types, keywords", () => {
  it("procedures, then the chosen one's parameters", () => {
    expect(labels("exec |")).toEqual(["sales.GetOrders"]);
    expect(run("exec sales.GetOrders |").items.map((i) => [i.label, i.detail])).toEqual([["@since", "date"], ["@count", "int output"]]);
  });

  it("declared variables", () => {
    expect(labels("declare @a int; select @|")).toEqual(["@a"]);
  });

  it("types from the catalog", () => {
    expect(labels("select cast(1 as |")).toEqual(["date", "int", "nvarchar"]);
  });

  it("keyword case: lower, upper, preserve (lists are upper case)", () => {
    expect(labels("sel|")).toContain("select");
    expect(labels("sel|", { language: "tsql", keywordCase: "upper" })).toContain("SELECT");
    expect(labels("sel|", { language: "tsql", keywordCase: "preserve" })).toContain("SELECT");
    expect(labels("sel|", { language: "tsql" })).toContain("select");
    expect(labels("sel|", { language: "cosmos-sql" })).toContain("SELECT");
  });

  it("nothing inside a string or comment", () => {
    expect(run("select 'from |'").items).toEqual([]);
  });
});

describe("complete: Cosmos", () => {
  const options: Options = { language: "cosmos-sql", container: "orders" };
  it("top-level paths, then nested ones, array elements included", () => {
    expect(labels("select c.| from c", options, "cosmos")).toEqual(["address", "lines", "tenantId"]);
    expect(run("select c.address.| from c", options, "cosmos").items.map((i) => [i.label, i.detail])).toEqual([["city", "string"], ["zip", "number | string"]]);
    expect(labels("select c.lines[0].| from c", options, "cosmos")).toEqual(["sku"]);
  });

  it("the alias and the container after FROM", () => {
    expect(labels("select * from |", options, "cosmos")).toEqual(["c", "orders"]);
  });
});

describe("hover", () => {
  const at = (source: string, language: Options["language"] = "tsql", current = "orders", container?: string) => {
    const offset = source.indexOf("|");
    return hover(lookup(current), source.replace("|", ""), offset, { language, container });
  };

  it("an object shows its kind, schema and columns", () => {
    const md = at("select * from sales.Or|der o")!;
    expect(md).toContain("**sales.Order**");
    expect(md).toContain("table");
    expect(md).toContain("`CustomerId` int, not null");
  });

  it("a column shows its type and nullability", () => {
    expect(at("select c.Na|me from dbo.Customer c")).toBe("**Name** nvarchar(50), null (dbo.Customer)");
    expect(at("select Tot|al from sales.[Order]")).toBe("**Total** decimal(18, 2), not null (sales.Order)");
  });

  it("a Cosmos path shows the types seen", () => {
    expect(at("select c.address.zi|p from c", "cosmos-sql", "cosmos", "orders")).toBe("**address.zip** number | string");
  });

  it("nothing for a keyword or an unknown name", () => {
    expect(at("sel|ect 1")).toBeNull();
    expect(at("select * from nope|")).toBeNull();
  });
});

describe("pgsql dialect", () => {
  const shop: DatabaseCatalog = {
    stamp: "p",
    schemas: ["public", "sales"],
    types: [],
    objects: [
      { name: "customer", schema: "public", kind: "table", columns: [{ name: "id", type: "integer", nullable: false }, { name: "Full Name", type: "text", nullable: true }] },
      { name: "Order", schema: "sales", kind: "table", columns: [{ name: "id", type: "bigint", nullable: false }] },
      { name: "customer", schema: "sales", kind: "view", columns: [{ name: "id", type: "integer", nullable: false }] },
      { name: "refresh_totals", schema: "sales", kind: "proc", params: [{ name: "since", type: "date", output: false }] },
    ],
  };
  const pg = new Index(shop);
  const pgLookup: Lookup = (db) => (db ? undefined : pg);
  const pgsql: Options = { language: "pgsql" };
  const pgRun = (source: string) => {
    const offset = source.indexOf("|");
    return complete(pgLookup, contextAt(source.replace("|", ""), offset, "pgsql").context, pgsql);
  };

  it("dims public as the default schema and double-quotes names that are not plain lower case", () => {
    const { items } = pgRun("select * from |");
    expect(items.map((i) => i.label)).toEqual(["customer", "sales.Order", "sales.customer"]);
    expect(items[0]).toMatchObject({ insertText: "public.customer", description: "public", dimmed: true });
    expect(items[1]).toMatchObject({ insertText: 'sales."Order"' });
  });

  it("resolves an unqualified name to public, and quotes columns", () => {
    const { items } = pgRun("select | from customer");
    expect(items.filter((i) => i.kind === "column").map((i) => i.insertText)).toEqual(["id", '"Full Name"']);
  });

  it("offers Postgres keywords and functions in lower case", () => {
    const words = pgRun("select 1 |").items.map((i) => i.label);
    expect(words).toContain("limit");
    expect(words).toContain("coalesce");
    expect(words).not.toContain("getdate");
  });

  it("offers Postgres types when the catalog has none", () => {
    expect(pgRun("select x::|").items.map((i) => i.label)).toContain("jsonb");
  });

  it("lists a procedure's parameters after CALL", () => {
    expect(pgRun("call sales.refresh_totals(|").items.map((i) => i.label)).toEqual(["since"]);
  });

  it("never reads a qualifier as another database: Postgres cannot query across them", () => {
    expect(pgRun("select * from other.|")).toEqual({ items: [] });
    expect(pgRun("select * from other.public.|")).toEqual({ items: [] });
  });

  it("hovers a table in public", () => {
    const text = "select * from customer";
    expect(hover(pgLookup, text, text.length, pgsql)).toContain("**public.customer** table");
  });
});
