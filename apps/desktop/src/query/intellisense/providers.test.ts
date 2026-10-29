import { describe, expect, it } from "vitest";
import { shouldSuggestAfterSpace, toMonacoItem } from "./providers";

const kinds = { Struct: 1, Field: 2, Keyword: 3, Function: 4, Method: 5, Variable: 6, Module: 7, TypeParameter: 8, Interface: 9, Reference: 10, Property: 11, Folder: 12 };
const range = { startLineNumber: 1, startColumn: 15, endLineNumber: 1, endColumn: 18 };

describe("toMonacoItem", () => {
  it("maps label parts, kind, insert and sort text", () => {
    const item = toMonacoItem(
      { label: "Customer", kind: "table", insertText: "dbo.Customer", filterText: "Customer", sortText: "0000001", description: "dbo", dimmed: true },
      range,
      kinds,
    );
    expect(item).toEqual({
      label: { label: "Customer", description: "dbo" },
      kind: kinds.Struct,
      insertText: "dbo.Customer",
      filterText: "Customer",
      sortText: "0000001",
      range,
    });
  });

  it("puts a type beside the label and the owner at the end", () => {
    const item = toMonacoItem({ label: "Total", kind: "column", detail: "decimal(18, 2)", description: "o", insertText: "Total", sortText: "1" }, range, kinds);
    expect(item.label).toEqual({ label: "Total", detail: " decimal(18, 2)", description: "o" });
    expect(item.kind).toBe(kinds.Field);
  });
});

describe("shouldSuggestAfterSpace", () => {
  it("opens the list after a space only when a keyword leads into names", () => {
    for (const line of ["select * from ", "  JOIN ", "exec ", "select ", "where a = 1 and ", "order by ", "update ", "insert into "])
      expect(shouldSuggestAfterSpace(line), line).toBe(true);
    for (const line of ["select a ", "select a, b ", "begin ", "", "from", "select 'from "]) expect(shouldSuggestAfterSpace(line), line).toBe(false);
  });
});
