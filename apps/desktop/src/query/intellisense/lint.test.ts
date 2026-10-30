import { describe, expect, it } from "vitest";
import type { DatabaseCatalog } from "../catalog.svelte";
import { Index, type Lookup } from "./engine";
import { unknownNames } from "./lint";

const catalog: DatabaseCatalog = {
  stamp: "s",
  schemas: ["dbo", "sales"],
  types: [],
  objects: [
    { name: "Customer", schema: "dbo", kind: "table", columns: [{ name: "Id", type: "int", nullable: false }, { name: "Name", type: "nvarchar(50)", nullable: true }] },
    { name: "Order", schema: "sales", kind: "table", columns: [{ name: "Id", type: "bigint", nullable: false }, { name: "CustomerId", type: "int", nullable: false }] },
    { name: "Orders", schema: "sales", kind: "synonym" },
  ],
};
const index = new Index(catalog);
const lookup: Lookup = (db) => (db === undefined || db.toLowerCase() === "orders" ? index : undefined);

/** Warnings for the statement at `|` (or the end), as the text each covers. */
function warn(source: string, l: Lookup = lookup): string[] {
  const offset = source.includes("|") ? source.indexOf("|") : source.length;
  const text = source.replace("|", "");
  return unknownNames(l, text, offset).map((w) => text.slice(w.start, w.end));
}

describe("unknownNames: tables", () => {
  it("warns about a table or view the catalog does not have", () => {
    expect(warn("select * from dbo.Contrcts")).toEqual(["dbo.Contrcts"]);
    expect(warn("select * from Customer c join sales.Ordr o on o.CustomerId = c.Id")).toEqual(["sales.Ordr"]);
  });

  it("says what is unknown, as a warning", () => {
    expect(unknownNames(lookup, "select * from dbo.Contrcts", 0)).toEqual([
      { start: 14, end: 26, message: "Unknown table or view 'dbo.Contrcts'." },
    ]);
  });

  it("accepts tables, synonyms and the default schema", () => {
    expect(warn("select * from Customer join sales.Orders o on 1 = 1 join sales.[Order] x on 1 = 1")).toEqual([]);
  });

  it("skips CTEs, temp tables, table variables and objects created earlier in the batch", () => {
    expect(warn("with recent (id) as (select Id from Customer), other as (select 1 as x) select * from recent join other on 1 = 1")).toEqual([]);
    expect(warn("select * from #work join ##shared on 1 = 1 join @t t on 1 = 1")).toEqual([]);
    expect(warn("create table dbo.Staging (x int);\ninsert into dbo.Staging values (1);\nselect * from Staging")).toEqual([]);
    expect(warn("select * into dbo.Copy from Customer;\nselect * from dbo.Copy")).toEqual([]);
    expect(warn("create table dbo.Staging (x int)\nGO\nselect * from Staging")).toEqual(["Staging"]);
  });

  it("skips three-part names, system views, functions and update aliases", () => {
    expect(warn("select * from Other.dbo.Thing join srv.db.dbo.T on 1 = 1 join Other..Thing on 1 = 1")).toEqual([]);
    expect(warn("select * from sys.objects join INFORMATION_SCHEMA.TABLES on 1 = 1 join string_split('a', ',') s on 1 = 1")).toEqual([]);
    expect(warn("update c set Name = 'x' from Customer c")).toEqual([]);
    expect(warn("delete c from Customer c")).toEqual([]);
  });

  it("ignores strings and comments", () => {
    expect(warn("select 'from nope' as x -- from nope\n/* join nope */ from Customer")).toEqual([]);
  });

  it("reads the database named by USE, and says nothing without a catalog", () => {
    expect(warn("use Other\nselect * from Nope")).toEqual([]);
    expect(warn("select * from Nope", () => undefined)).toEqual([]);
  });

  it("only checks the statement at the cursor", () => {
    expect(warn("select * from Nope1;\nselect * from Customer|")).toEqual([]);
    expect(warn("select * from Nope1|;\nselect * from Nope2")).toEqual(["Nope1"]);
  });
});

describe("unknownNames: columns", () => {
  it("warns about a qualified column the table does not have", () => {
    expect(warn("select c.Nmae, o.Id from Customer c join sales.[Order] o on o.CustomerId = c.Id")).toEqual(["Nmae"]);
    expect(warn("select Customer.Nmae from Customer")).toEqual(["Nmae"]);
  });

  it("warns about an unqualified column when the statement reads one table", () => {
    expect(warn("select Id, Nmae from Customer where Name is not null order by Id")).toEqual(["Nmae"]);
    expect(warn("update Customer set Nmae = 'x' where Id = 1")).toEqual(["Nmae"]);
  });

  it("does not take aliases, functions, keywords, types or date parts for columns", () => {
    expect(warn("select top 10 count(*) as n, Name label, total = Id, getdate(), cast(Id as bigint), datepart(day, getdate()), current_timestamp from Customer order by n")).toEqual([]);
    expect(warn("select case when Id > 1 then 'a' else 'b' end, Name collate Latin1_General_CI_AS from Customer")).toEqual([]);
  });

  it("does not check unqualified columns with several tables or a subquery", () => {
    expect(warn("select Nmae from Customer c join sales.[Order] o on 1 = 1")).toEqual([]);
    expect(warn("select Nmae from Customer where Id in (select CustomerId from sales.[Order])")).toEqual([]);
  });

  it("skips columns of tables it cannot check", () => {
    expect(warn("select s.Anything, x.Other from sales.Orders s join #t x on 1 = 1")).toEqual([]);
    expect(warn("select Anything from #t")).toEqual([]);
    expect(warn("select inserted.Anything from Customer")).toEqual([]);
  });
});
