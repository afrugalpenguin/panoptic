// "Did you mean" for name errors (docs/query-editor.md, "Error location"). Pure: it runs in the IntelliSense worker
// against the catalog snapshot it already holds, and never calls the sidecar.

import type { CatalogObject, ColumnRef } from "../catalog.svelte";
import { defaultSchema, quote, type Index, type Lookup } from "./engine";
import type { Language, TableRef } from "./scanner";

export interface Suggestion {
  /** As shown in the message: dbo.Contracts. */
  label: string;
  /** What the quick fix writes in place of the name. */
  insertText: string;
}

/** Levenshtein distance, case-insensitive. */
export function distance(a: string, b: string): number {
  a = a.toLowerCase();
  b = b.toLowerCase();
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length];
}

/**
 * The closest candidate to typed: the same name ignoring case, then a name typed is the start of (shortest first),
 * then the nearest within two edits. Candidates come in preference order; the first of equals wins.
 */
function closest<T>(typed: string, candidates: T[], nameOf: (c: T) => string): T | undefined {
  const lower = typed.toLowerCase();
  const exact = candidates.find((c) => nameOf(c).toLowerCase() === lower);
  if (exact) return exact;
  const prefixed = candidates.filter((c) => nameOf(c).toLowerCase().startsWith(lower));
  if (prefixed.length) return prefixed.reduce((best, c) => (nameOf(c).length < nameOf(best).length ? c : best));
  let best: T | undefined;
  let bestDistance = 3;
  for (const c of candidates) {
    if (Math.abs(nameOf(c).length - typed.length) >= bestDistance) continue;
    const d = distance(typed, nameOf(c));
    if (d < bestDistance) [best, bestDistance] = [c, d];
  }
  return best;
}

const KINDS = { objects: new Set(["table", "view", "synonym"]), procs: new Set(["proc"]), routines: new Set(["fn", "proc"]) };

/**
 * An object for an invalid object name (208, 42P01), a missing procedure (2812) or an undefined Postgres function or
 * procedure (42883), from [name] or [schema, name]. The one the name already resolves to exactly is skipped: the
 * server could not use it, so suggesting it would not help.
 */
export function suggestObject(index: Index, parts: string[], kind: keyof typeof KINDS, language: Language = "tsql"): Suggestion | undefined {
  if (parts.length === 0 || parts.length > 2) return undefined;
  const name = parts[parts.length - 1];
  const schema = parts.length === 2 ? parts[0] : undefined;
  const fallback = defaultSchema(language);
  const inSchema = (o: CatalogObject) => !!schema && o.schema.toLowerCase() === schema.toLowerCase();
  const candidates = index.catalog.objects
    .filter((o) => KINDS[kind].has(o.kind) && !(o.name === name && (schema ? o.schema === schema : o.schema.toLowerCase() === fallback)))
    .sort((a, b) => Number(inSchema(b)) - Number(inSchema(a)));
  const found = closest(name, candidates, (o) => o.name);
  return found && { label: `${found.schema}.${found.name}`, insertText: `${quote(found.schema, language)}.${quote(found.name, language)}` };
}

/**
 * A column for an invalid column name (207, 42703), from the columns of the statement's tables that resolve in the
 * catalog, or only the table qualifier names (an alias or a table name) when the column is qualified.
 */
export function suggestColumn(lookup: Lookup, tables: TableRef[], name: string, qualifier?: string, language: Language = "tsql"): Suggestion | undefined {
  const eq = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
  const refs = qualifier ? tables.filter((t) => eq(t.alias, qualifier) || (!t.alias && eq(t.name, qualifier))) : tables;
  const columns: ColumnRef[] = [];
  for (const ref of refs) columns.push(...(lookup(ref.database)?.find(ref.name, ref.schema, defaultSchema(language))?.columns ?? []));
  const found = closest(name, columns.filter((c) => c.name !== name), (c) => c.name);
  return found && { label: found.name, insertText: quote(found.name, language) };
}
