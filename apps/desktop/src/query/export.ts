import type { CellValue, ResultColumn } from "./types";

/** RFC 4180 CSV with CRLF line endings, quoting only fields that need it. NULL is an empty field. */
export function toCsv(columns: ResultColumn[], rows: CellValue[][]): string {
  const field = (v: CellValue) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
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
