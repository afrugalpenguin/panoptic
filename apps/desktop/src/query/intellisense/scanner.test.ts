import { describe, expect, it } from "vitest";
import { contextAt, isDdl, statementAt, tablesAt, tokenize, type Language } from "./scanner";

/** `|` marks the cursor. */
function at(source: string, language: Language = "tsql") {
  const offset = source.indexOf("|");
  return contextAt(source.replace("|", ""), offset, language);
}

describe("tokenize", () => {
  it("unquotes bracketed and double-quoted identifiers in T-SQL", () => {
    const tokens = tokenize(`[my table]."col ""x""" [a]]b]`, "tsql");
    expect(tokens.filter((t) => t.type === "quoted").map((t) => t.value)).toEqual(["my table", 'col "x"', "a]b"]);
  });

  it("treats double quotes as strings in Cosmos", () => {
    expect(tokenize(`c.name = "x"`, "cosmos-sql").map((t) => t.type)).toEqual(["word", "punct", "word", "punct", "string"]);
  });

  it("reads comments, N-strings, variables and numbers", () => {
    const tokens = tokenize("-- hi\nselect N'it''s', @a, @@rowcount, 1.5 /* x /* nested */ y */", "tsql");
    expect(tokens.map((t) => t.type)).toEqual(["comment", "word", "string", "punct", "var", "punct", "var", "punct", "number", "comment"]);
  });
});

describe("statementAt", () => {
  it("stops at GO lines, semicolons and blank lines", () => {
    const text = "select 1\nGO\nselect 2; select 3\n\nselect 4";
    const slice = (o: number) => {
      const s = statementAt(text, o);
      return text.slice(s.start, s.end).trim();
    };
    expect(slice(text.indexOf("2"))).toBe("select 2");
    expect(slice(text.indexOf("3"))).toBe("select 3");
    expect(slice(text.indexOf("4"))).toBe("select 4");
    expect(slice(text.indexOf("1"))).toBe("select 1");
  });

  it("does not split on a blank line inside a comment or string", () => {
    const text = "select 'a\n\nb', /* x\n\ny */ 2";
    const s = statementAt(text, text.length);
    expect(s.start).toBe(0);
  });
});

describe("contextAt: T-SQL", () => {
  it("objects after FROM, JOIN, UPDATE, INSERT INTO, DELETE and TRUNCATE TABLE", () => {
    for (const source of ["select * from |", "select * from a join |", "update |", "insert into |", "delete |", "delete from |", "truncate table |"])
      expect(at(source).context, source).toEqual({ kind: "objects", qualifier: [] });
  });

  it("objects with the qualifier typed so far, and the partial name as the prefix", () => {
    expect(at("select * from dbo.Ord|")).toMatchObject({ context: { kind: "objects", qualifier: ["dbo"] }, prefix: "Ord" });
    expect(at("select * from Sales.dbo.|").context).toEqual({ kind: "objects", qualifier: ["Sales", "dbo"] });
  });

  it("keywords once a FROM already has a table, objects again after a comma", () => {
    expect(at("select * from dbo.Orders o |").context.kind).toBe("keywords");
    expect(at("select * from dbo.Orders o, |").context.kind).toBe("objects");
  });

  it("columns of every table in the statement, with aliases, wherever the FROM is", () => {
    const { context } = at("select | from dbo.Orders o join sales.Lines as l on o.Id = l.OrderId");
    expect(context).toEqual({
      kind: "columns",
      tables: [
        { name: "Orders", schema: "dbo", alias: "o" },
        { name: "Lines", schema: "sales", alias: "l" },
      ],
    });
  });

  it("columns after WHERE, ON, GROUP BY, ORDER BY, HAVING, SET and a comma", () => {
    for (const source of [
      "select * from t where |",
      "select * from t join u on |",
      "select a from t group by |",
      "select a from t order by |",
      "select a from t group by a having |",
      "update t set |",
      "select a, | from t",
      "select * from t where a = 1 and |",
    ])
      expect(at(source).context.kind, source).toBe("columns");
  });

  it("only the aliased table's columns after alias dot", () => {
    expect(at("select o.| from dbo.Orders o").context).toEqual({ kind: "aliasColumns", table: { name: "Orders", schema: "dbo", alias: "o" } });
    expect(at("select * from dbo.Orders o join Lines l on l.|").context).toEqual({ kind: "aliasColumns", table: { name: "Lines", alias: "l" } });
  });

  it("an unaliased table is addressable by name", () => {
    expect(at("select Orders.| from dbo.Orders").context).toEqual({ kind: "aliasColumns", table: { name: "Orders", schema: "dbo" } });
  });

  it("an unknown qualifier in a column clause is passed through as a table name", () => {
    expect(at("select x.| from dbo.Orders o").context).toEqual({ kind: "aliasColumns", table: { name: "x" } });
  });

  it("procedures after EXEC, then that procedure's parameters", () => {
    expect(at("exec |").context).toEqual({ kind: "procs", qualifier: [] });
    expect(at("execute dbo.|").context).toEqual({ kind: "procs", qualifier: ["dbo"] });
    expect(at("exec dbo.GetThing |").context).toEqual({ kind: "params", proc: "GetThing", schema: "dbo" });
    expect(at("exec GetThing @a = 1, |").context).toEqual({ kind: "params", proc: "GetThing" });
  });

  it("variables from DECLARE lines and the procedure header after @", () => {
    const declared = at("declare @a int, @b varchar(10);\nselect @|");
    expect(declared.context).toEqual({ kind: "variables", names: ["@a", "@b"] });
    expect(declared.prefix).toBe("@");
    const proc = at("create procedure dbo.P @since date, @max int as\nselect * from t where d > @s|");
    expect(proc).toMatchObject({ context: { kind: "variables", names: ["@since", "@max"] }, prefix: "@s" });
  });

  it("types after CAST(x AS, CONVERT( and a declared variable", () => {
    expect(at("select cast(a as |").context.kind).toBe("types");
    expect(at("select convert(|").context.kind).toBe("types");
    expect(at("declare @x |").context.kind).toBe("types");
    expect(at("declare @x int, @y |").context.kind).toBe("types");
    expect(at("create proc p @a |").context.kind).toBe("types");
  });

  it("an alias AS in a select list is not a cast", () => {
    expect(at("select a as |").context.kind).not.toBe("types");
  });

  it("keywords at the start and after a bare statement", () => {
    expect(at("sel|")).toMatchObject({ context: { kind: "keywords" }, prefix: "sel" });
    expect(at("select 1;\n|").context.kind).toBe("keywords");
  });

  it("nothing inside strings and comments", () => {
    expect(at("select 'from |'").context.kind).toBe("none");
    expect(at("select 1 -- from |").context.kind).toBe("none");
    expect(at("select /* from | */ 1").context.kind).toBe("none");
  });

  it("brackets are unquoted and comments are skipped when resolving aliases", () => {
    expect(at("select [o].| from [dbo].[Orders] [o] -- from x").context).toEqual({
      kind: "aliasColumns",
      table: { name: "Orders", schema: "dbo", alias: "o" },
    });
  });

  it("a partial bracketed name is the prefix without its bracket", () => {
    expect(at("select * from [my Ta|").prefix).toBe("my Ta");
  });

  it("a subquery's own clause wins inside its parentheses", () => {
    expect(at("select * from t where id in (select | from u)").context).toEqual({ kind: "columns", tables: [{ name: "u" }] });
    expect(at("select * from t where id in (select x from |").context.kind).toBe("objects");
  });

  it("the last USE before the cursor names the database to read", () => {
    expect(at("use Other\nGO\nselect * from |").useDatabase).toBe("Other");
    expect(at("use [A]; use B\nselect * from |").useDatabase).toBe("B");
    expect(at("select * from |\nuse Later").useDatabase).toBeUndefined();
  });
});

describe("contextAt: Cosmos", () => {
  it("property paths after the alias, nested as the user types", () => {
    expect(at("select c.| from c", "cosmos-sql").context).toEqual({ kind: "cosmosPaths", prefix: [] });
    expect(at("select * from c where c.address.ci|", "cosmos-sql")).toMatchObject({ context: { kind: "cosmosPaths", prefix: ["address"] }, prefix: "ci" });
  });

  it("the container or alias after FROM, keywords elsewhere", () => {
    expect(at("select * from |", "cosmos-sql").context.kind).toBe("cosmosFrom");
    expect(at("select * from c |", "cosmos-sql").context.kind).toBe("keywords");
    expect(at("sel|", "cosmos-sql").context.kind).toBe("keywords");
  });
});

describe("isDdl", () => {
  it("finds CREATE, ALTER and DROP as keywords only", () => {
    expect(isDdl("create table t (a int)")).toBe(true);
    expect(isDdl("select 1\nGO\nALTER VIEW v AS select 1")).toBe(true);
    expect(isDdl("select 'drop' as x")).toBe(false);
    expect(isDdl("select 1 -- drop table t")).toBe(false);
    expect(isDdl("select [create] from t")).toBe(false);
  });
});

describe("contextAt: robustness", () => {
  const scripts = [
    "select a, b from dbo.T t join (select x from u) d on d.x = t.a where t.b in (select y from v where y > @p) order by 1;\nGO\nexec dbo.P @a = 1, @b = 'x';",
    "declare @x int = (select count(*) from [a]]b].[c\" d] e) /* unterminated",
    "create procedure p @a int, @b nvarchar(max) as begin select cast(@a as varchar(10)), convert(int, @b) end",
    "select 'unterminated, from [x",
    "((((select from from from . . . , , @ @@ [ ] ) ) ;;;\n\n\nGO\ngo go",
  ];
  for (const language of ["tsql", "cosmos-sql"] as const)
    it(`never throws at any offset (${language})`, () => {
      for (const script of scripts) for (let o = 0; o <= script.length; o++) expect(() => contextAt(script, o, language)).not.toThrow();
    });
});

describe("replace range and table refs", () => {
  it("start is where the raw prefix begins, bracket included", () => {
    expect(at("select * from [my Ta|").start).toBe("select * from ".length);
    expect(at("select @a|").start).toBe("select ".length);
    expect(at("select |").start).toBe("select ".length);
  });

  it("Cosmos array indexes become [] in the path prefix", () => {
    expect(at("select c.lines[0].| from c", "cosmos-sql").context).toEqual({ kind: "cosmosPaths", prefix: ["lines[]"] });
  });

  it("tablesAt lists the statement's tables for hover", () => {
    const text = "select o.Id from dbo.Orders o join Lines l on 1 = 1";
    expect(tablesAt(text, 8, "tsql")).toEqual([
      { name: "Orders", schema: "dbo", alias: "o" },
      { name: "Lines", alias: "l" },
    ]);
  });
});
