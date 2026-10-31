import type { CellValue, ResultColumn } from "./types";

/** Text a spreadsheet would run as a formula: starts with = + - @, a tab or a carriage return. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Numbers the engine sends as text (decimals): never formulas, and a prefix would corrupt them. */
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/**
 * RFC 4180 CSV with CRLF line endings, quoting only fields that need it. NULL is an empty field. Text that starts
 * like a formula gets a leading ' so Excel and its kin show it instead of running it (CSV injection).
 */
export function toCsv(columns: ResultColumn[], rows: CellValue[][]): string {
  const field = (v: CellValue) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    if (typeof v === "string" && FORMULA_START.test(s) && !NUMERIC.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => field(c.name)).join(",")];
  for (const row of rows) lines.push(columns.map((_, i) => field(row[i])).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** An array of objects keyed by column name. Duplicate or empty names get a suffix so no value is lost. */
export function toJson(columns: ResultColumn[], rows: CellValue[][]): string {
  const seen = new Map<string, number>();
  const keys = columns.map((c, i) => {
    const base = c.name || `column${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
  const objects = rows.map((row) => Object.fromEntries(keys.map((k, i) => [k, row[i] ?? null])));
  return JSON.stringify(objects, null, 2);
}
