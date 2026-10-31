import { describe, expect, it } from "vitest";
import { tsqlHabits, type Warning } from "./habits";

/** Each warning as the text it covers. */
const covered = (text: string, defines?: (name: string) => boolean) => tsqlHabits(text, defines).map((w) => text.slice(w.start, w.end));

/** The text after applying a warning's fix. */
function fixed(text: string, w: Warning): string {
  const edits = [...w.fix!.edits].sort((a, b) => b.start - a.start);
  for (const e of edits) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  return text;
}

const only = (text: string) => {
  const warnings = tsqlHabits(text);
  expect(warnings).toHaveLength(1);
  return warnings[0];
};

describe("tsqlHabits: fixes", () => {
  it("TOP n becomes LIMIT n at the end of the query, in the case TOP was written", () => {
    const w = only("select top 10 * from t where a = 1;\nselect 2");
    expect(w.message).toMatch(/LIMIT 10/);
    expect(w.fix!.label).toBe("limit 10");
    expect(fixed("select top 10 * from t where a = 1;\nselect 2", w)).toBe("select * from t where a = 1 limit 10;\nselect 2");
    expect(fixed("SELECT DISTINCT TOP (5) a FROM t -- note", only("SELECT DISTINCT TOP (5) a FROM t -- note"))).toBe("SELECT DISTINCT a FROM t LIMIT 5 -- note");
  });

  it("puts the LIMIT inside the subquery the TOP is in", () => {
    const text = "select * from (select top 3 a from t order by a) x";
    expect(fixed(text, only(text))).toBe("select * from (select a from t order by a limit 3) x");
  });

  it("explains TOP without a fix when it cannot be moved as is", () => {
    for (const text of ["select top 10 percent * from t", "select top 5 with ties a from t order by a", "select top 3 * from t limit 2", "select top (@n) * from t"])
      expect(tsqlHabits(text)[0]?.fix, text).toBeUndefined();
  });

  it('[Name] becomes "Name", with a note that unquoted names fold to lower case', () => {
    const text = "select [Order Id], t.[Total] from dbo.[Order] t";
    expect(covered(text)).toEqual(["[Order Id]", "[Total]", "[Order]"]);
    const [w] = tsqlHabits(text);
    expect(w.message).toMatch(/lower case/);
    expect(fixed(text, w)).toBe('select "Order Id", t.[Total] from dbo.[Order] t');
  });

  it("leaves array subscripts and constructors alone", () => {
    expect(covered("select a[1], b[i], c[1:2], array[1, 2], '{}'::int[], (f(x))[1] from t")).toEqual([]);
  });

  it("GETDATE() and SYSDATETIME() become now(), ISNULL coalesce, LEN length", () => {
    const text = "select GETDATE(), sysdatetime(), isnull(a, 0), Len(b) from t";
    expect(tsqlHabits(text).map((w) => fixed(text, w))).toEqual([
      "select now(), sysdatetime(), isnull(a, 0), Len(b) from t",
      "select GETDATE(), now(), isnull(a, 0), Len(b) from t",
      "select GETDATE(), sysdatetime(), coalesce(a, 0), Len(b) from t",
      "select GETDATE(), sysdatetime(), isnull(a, 0), length(b) from t",
    ]);
  });

  it("does not flag Postgres's own ISNULL operator, or a function the database defines", () => {
    expect(covered("select * from t where a isnull")).toEqual([]);
    expect(covered("select isnull(a, 0), len(b) from t", (name) => name === "isnull")).toEqual(["len"]);
  });

  it("+ next to a text literal becomes ||", () => {
    const text = "select 'Hello, ' + name, first + ' ' + last from t";
    expect(covered(text)).toEqual(["+", "+", "+"]);
    expect(fixed(text, tsqlHabits(text)[0])).toBe("select 'Hello, ' || name, first + ' ' + last from t");
  });

  it("leaves arithmetic with literals that Postgres casts alone", () => {
    expect(covered("select now() + '1 day', d + '2020-01-01', id + '1', date '2020-01-01' + 1, a + b from t")).toEqual([]);
  });
});

describe("tsqlHabits: explained only", () => {
  it("@variables, #temp tables, NOLOCK and GO", () => {
    const text = "declare @n int;\nselect * from #recent r with (nolock) where r.id = @n\nGO\nselect a @> b, c # d, e @@ f from t";
    const warnings = tsqlHabits(text);
    expect(warnings.map((w) => text.slice(w.start, w.end))).toEqual(["@n", "#recent", "with (nolock)", "@n", "GO"]);
    expect(warnings.every((w) => !w.fix)).toBe(true);
    expect(warnings[0].message).toMatch(/DO/);
    expect(warnings[1].message).toMatch(/CREATE TEMP TABLE/);
    expect(warnings[2].message).toMatch(/never block/);
    expect(warnings[4].message).toMatch(/semicolon/);
  });

  it("looks past strings, comments, quoted names and dollar-quoted bodies", () => {
    expect(covered(`select 'top 10 [x] getdate()' as "[y] @z", 1 -- go\n/* #t */ from t; do $$ begin perform getdate(); end $$`)).toEqual([]);
  });

  it("finds GO only alone on its line", () => {
    expect(covered("select 1 as go\nselect 2")).toEqual([]);
    expect(covered("select 1\n  go  \nselect 2")).toEqual(["go"]);
  });
});
