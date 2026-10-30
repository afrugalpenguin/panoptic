import { describe, expect, it } from "vitest";
import { findName, locatable, quotedName } from "./locate";

/** The text the found range covers. */
function found(text: string, line: number, name: string, number = 208) {
  const at = findName(text, line, name, number);
  return at && { text: text.slice(at.start, at.end), line: at.line };
}

const script = [
  "select 1 as a", //                                     1
  "", //                                                  2
  "select c.Id,", //                                      3
  "  c.Name", //                                          4
  "from", //                                              5
  "", //                                                  6
  "  dbo.Customer c", //                                  7
  "  join contracts k on k.CustomerId = c.Id", //         8
].join("\n");

describe("findName", () => {
  it("finds a single match in the statement that starts at the reported line", () => {
    expect(found(script, 3, "contracts")).toEqual({ text: "contracts", line: 8 });
  });

  it("finds it when the server reports the name's own line inside the statement", () => {
    expect(found(script, 4, "Nmae", 207)).toBeUndefined();
    expect(found(script.replace("c.Name", "c.Nmae"), 4, "Nmae", 207)).toEqual({ text: "Nmae", line: 4 });
  });

  it("finds nothing when the name is not in the statement", () => {
    expect(found(script, 3, "invoices")).toBeUndefined();
  });

  it("ignores a match inside a string literal", () => {
    const text = "select 'contracts' as label\nfrom contracts";
    expect(found(text, 1, "contracts")).toEqual({ text: "contracts", line: 2 });
    expect(found("select 'contracts' from t", 1, "contracts")).toBeUndefined();
  });

  it("ignores a match inside a comment", () => {
    const text = "select * -- from contracts\n/* contracts */ from contracts";
    expect(found(text, 1, "contracts")).toEqual({ text: "contracts", line: 2 });
  });

  it("matches a whole token only, case-insensitively", () => {
    expect(found("select * from contracts_old join Contracts on 1 = 1", 1, "contracts")).toEqual({ text: "Contracts", line: 1 });
  });

  it("matches a multi-part name, and the last part of a 4104 identifier", () => {
    expect(found("select *\nfrom sales.[Contracts]", 1, "sales.Contracts")).toEqual({ text: "sales.[Contracts]", line: 2 });
    expect(found("select k.Nmae\nfrom dbo.Customer c", 1, "c.Nmae", 4104)).toEqual({ text: "k.Nmae", line: 1 });
    expect(found("select c.Nmae\nfrom dbo.Customer c", 1, "c.Nmae", 4104)).toEqual({ text: "c.Nmae", line: 1 });
  });

  it("gives up when the identifier appears twice", () => {
    expect(found("select * from contracts a join contracts b on 1 = 1", 1, "contracts")).toBeUndefined();
  });

  it("only searches the statement at the line, not the rest of the batch", () => {
    const text = "select * from contracts;\nselect * from contracts";
    expect(found(text, 2, "contracts")).toEqual({ text: "contracts", line: 2 });
  });

  it("finds nothing past the end of the text", () => {
    expect(found("select 1", 5, "x")).toBeUndefined();
  });
});

describe("quotedName", () => {
  it("reads the identifier from single or double quotes", () => {
    expect(quotedName("Invalid object name 'dbo.contracts'.")).toBe("dbo.contracts");
    expect(quotedName('The multi-part identifier "c.Nmae" could not be bound.')).toBe("c.Nmae");
    expect(quotedName("Incorrect syntax near the keyword from.")).toBeUndefined();
  });
});

describe("locatable", () => {
  it("is decided by error number", () => {
    expect([208, 207, 4104, 2812, 102].map(locatable)).toEqual([true, true, true, true, false]);
  });
});
