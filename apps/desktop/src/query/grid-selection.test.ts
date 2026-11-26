import { describe, expect, it } from "vitest";
import { bounds, copyText, rowFullySelected } from "./grid-selection";

const columns = [{ name: "id", type: "int" }, { name: "name", type: "nvarchar" }, { name: "ok", type: "bit" }];
const rows = [
  [1, "a", true],
  [2, null, false],
  [3, "c", null],
];

describe("bounds", () => {
  it("orders the corners whichever way the selection was made", () => {
    expect(bounds({ anchor: { row: 2, col: 2 }, focus: { row: 0, col: 1 } })).toEqual({ top: 0, left: 1, bottom: 2, right: 2 });
  });
});

describe("copyText", () => {
  it("copies one cell as its bare value", () => {
    expect(copyText(columns, rows, { top: 0, left: 1, bottom: 0, right: 1 }, false)).toBe("a");
  });

  it("copies a block tab-separated with CRLF between rows, NULL empty and bits as 1/0", () => {
    expect(copyText(columns, rows, { top: 0, left: 0, bottom: 2, right: 2 }, false)).toBe("1\ta\t1\r\n2\t\t0\r\n3\tc\t");
  });

  it("puts the selected columns' names first with headers", () => {
    expect(copyText(columns, rows, { top: 1, left: 1, bottom: 2, right: 2 }, true)).toBe("name\tok\r\n\t0\r\nc\t");
  });

  it("names an unnamed column as the grid shows it", () => {
    expect(copyText([{ name: "", type: "int" }], [[5]], { top: 0, left: 0, bottom: 0, right: 0 }, true)).toBe("(column 1)\r\n5");
  });
});

describe("rowFullySelected", () => {
  it("is true only when every column of the row is in the selection", () => {
    const b = { top: 1, left: 0, bottom: 2, right: 2 };
    expect(rowFullySelected(b, 1, 3)).toBe(true);
    expect(rowFullySelected(b, 0, 3)).toBe(false);
    expect(rowFullySelected({ ...b, left: 1 }, 1, 3)).toBe(false);
  });
});
