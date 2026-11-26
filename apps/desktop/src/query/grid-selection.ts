// The results grid's selection and what Copy puts on the clipboard (#374), as SSMS does: one rectangle, from the cell
// the selection started at (anchor) to the one it was extended to (focus).
import type { CellValue, ResultColumn } from "./types";

export interface Cell {
  row: number;
  col: number;
}

export interface Selection {
  anchor: Cell;
  focus: Cell;
}

export interface Bounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export function bounds(s: Selection): Bounds {
  return {
    top: Math.min(s.anchor.row, s.focus.row),
    left: Math.min(s.anchor.col, s.focus.col),
    bottom: Math.max(s.anchor.row, s.focus.row),
    right: Math.max(s.anchor.col, s.focus.col),
  };
}

export function rowFullySelected(b: Bounds, row: number, columnCount: number): boolean {
  return row >= b.top && row <= b.bottom && b.left === 0 && b.right === columnCount - 1;
}

/** A column's name as the grid's header shows it. */
export function columnLabel(c: ResultColumn, i: number): string {
  return c.name || `(column ${i + 1})`;
}

/** A value as copied: NULL is an empty field, bits are 1 and 0. */
function copyValue(v: CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v);
}

/** The selection as tab-separated text, rows separated by CRLF, optionally with the selected columns' names first. */
export function copyText(columns: ResultColumn[], rows: CellValue[][], b: Bounds, headers: boolean): string {
  const lines: string[] = [];
  if (headers) lines.push(columns.slice(b.left, b.right + 1).map((c, i) => columnLabel(c, b.left + i)).join("\t"));
  for (let r = b.top; r <= b.bottom; r++) {
    const row = rows[r] ?? [];
    const fields: string[] = [];
    for (let c = b.left; c <= b.right; c++) fields.push(copyValue(row[c]));
    lines.push(fields.join("\t"));
  }
  return lines.join("\r\n");
}
