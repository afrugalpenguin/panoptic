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

  const slice = (text: string, marker: string, language: Language = "tsql") => {
    const s = statementAt(text, text.indexOf(marker), language);
    return text.slice(s.start, s.end).trim();
  };

  it("does not split on a semicolon in a string, comment or quoted name", () => {
    const text = "select 'a;b', [c;d] -- e;f\nfrom t /* g; h */ where x = 1";
    expect(slice(text, "where")).toBe(text);
    expect(slice(`select c.x from c where c.y = "a;b"`, "where", "cosmos-sql")).toBe(`select c.x from c where c.y = "a;b"`);
  });

  it("does not split on GO inside a comment or string, or not alone on its line", () => {
    const text = "select 1 /*\nGO\n*/ from t\nwhere 'x\nGO\n' = '' go\nand 1 = 1";
    expect(slice(text, "and")).toBe(text);
  });

  it("keeps a CTE spanning several lines in one statement", () => {
    const text = "with recent as (\n  select Id from dbo.Orders\n)\nselect r.Id\nfrom recent r";
    expect(slice(text, "r.Id")).toBe(text);
    expect(at(text.replace("r.Id", "r.|")).context).toEqual({ kind: "aliasColumns", table: { name: "recent", alias: "r" } });
  });

  it("splits a procedure body at its semicolons but still sees the header's parameters", () => {
    const text = "create procedure dbo.P @since date as\nbegin\n  select 1;\n  select * from dbo.Orders o where o.At > @|\nend\nGO\nselect 2";
    const source = text.replace("|", "");
    expect(slice(source, "select *")).toBe("select * from dbo.Orders o where o.At > @\nend");
    expect(at(text)).toMatchObject({ context: { kind: "variables", names: ["@since"] }, prefix: "@" });
    expect(at(text.replace("@|", "o.|")).context).toEqual({ kind: "aliasColumns", table: { name: "Orders", schema: "dbo", alias: "o" } });
  });

  it("finds the same statements as splitting the full token list", () => {
    // Reference: the split this scanner did before it stopped tokenizing the whole script.
    const reference = (text: string, language: Language) => {
      const result: { start: number; end: number }[] = [];
      let start = 0;
      let previousEnd = 0;
      const blank = (to: number) => {
        const m = /\n[ \t\r]*\n/.exec(text.slice(previousEnd, to));
        if (m) result.push({ start, end: previousEnd + m.index }), (start = previousEnd + m.index + 1);
      };
      for (const t of tokenize(text, language)) {
        blank(t.start);
        const line = (from: number, to: number) => text.slice(from, to).trim() === "";
        const go =
          t.type === "word" &&
          t.text.toLowerCase() === "go" &&
          line(text.lastIndexOf("\n", t.start - 1) + 1, t.start) &&
          line(t.end, text.indexOf("\n", t.end) < 0 ? text.length : text.indexOf("\n", t.end));
        if (go || (t.type === "punct" && t.text === ";")) result.push({ start, end: t.start }), (start = t.end);
        previousEnd = t.end;
      }
      blank(text.length);
      result.push({ start, end: text.length });
      return result;
    };
    const scripts = [
      "select 1\nGO\nselect 2; select 3\n\nselect 4",
      "select 'a;\n\nb' ; [x;\n\ny] -- c;\n\n\n/* d;\n\nGO\n*/ select 5\n  go  \nselect 6;\n\n\n\n;",
      "declare @x int = (select count(*) from [a]]b].[c\" d] e) /* unterminated\n\nGO\n;",
      "select 'unterminated;\n\nGO\nfrom [x",
      "((((select from from from . . . , , @ @@ [ ] ) ) ;;;\n\n\nGO\ngo go\r\n\r\nselect\r\n \r\n1",
    ];
    for (const language of ["tsql", "cosmos-sql"] as const)
      for (const script of scripts) {
        const expected = reference(script, language);
        for (let o = 0; o <= script.length; o++) {
          const want = expected.find((s) => s.start <= o && o <= s.end);
          if (want) expect(statementAt(script, o, language), `${language} ${JSON.stringify(script)} @${o}`).toEqual(want);
        }
      }
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
