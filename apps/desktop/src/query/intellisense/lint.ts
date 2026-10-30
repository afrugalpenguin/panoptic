// Warnings for tables and columns the catalog does not know, in the statement at the cursor, before it runs
// (docs/query-editor.md, "Error location"). Pure: it runs in the IntelliSense worker on the scanner's tokens and the
// catalog snapshot, and never calls the sidecar. Precision over recall: anything it cannot be sure of is skipped,
// because a warning on valid SQL is worse than a missed one; the server still reports what this lets through.

import type { CatalogObject } from "../catalog.svelte";
import type { Lookup } from "./engine";
import { inColumnClause, nameChains, placedRefs, statementScan, type PlacedRef, type Token } from "./scanner";
import { TSQL_FUNCTIONS, TSQL_KEYWORDS, TSQL_TYPES } from "./tsql-words";

export interface Warning {
  start: number;
  end: number;
  message: string;
}

/** Words that can stand where a column does without being one. */
const NOT_COLUMNS = new Set(
  [
    ...TSQL_KEYWORDS, ...TSQL_FUNCTIONS, ...TSQL_TYPES,
    "collate", "current_user", "session_user", "system_user", "user", "current_date", "escape", "range", "preceding", "following",
    "unbounded", "current", "row", "first", "only", "nulls", "within", "inserted", "deleted",
  ].map((w) => w.toLowerCase()),
);
/** Functions whose first argument is a date part keyword (day, mm, ...), not a column. */
const DATE_PART_FUNCTIONS = new Set(["dateadd", "datediff", "datediff_big", "datename", "datepart", "datetrunc", "date_bucket"]);
const SYSTEM_SCHEMAS = new Set(["sys", "information_schema"]);
const CREATES = new Set(["table", "view", "synonym", "function", "proc", "procedure"]);

const lower = (t: Token | undefined) => (t && (t.type === "word" || t.type === "quoted") ? t.value.toLowerCase() : "");
const isWord = (t: Token | undefined) => t?.type === "word";

/** Names the batch defines before or in this statement: CREATE <object> x, SELECT ... INTO x, and CTE names. */
function definedNames(earlier: Token[], tokens: Token[]): Set<string> {
  const names = new Set<string>();
  const all = [...earlier, ...tokens];
  for (let i = 0; i < all.length; i++) {
    const w = lower(all[i]);
    let at = -1;
    if (w === "create" || w === "alter") {
      at = i + 1;
      if (lower(all[at]) === "or" && lower(all[at + 1]) === "alter") at += 2;
      at = CREATES.has(lower(all[at])) ? at + 1 : -1;
    } else if (w === "into" && all[i].type === "word") at = i + 1;
    if (at < 0) continue;
    const chain = nameChains(all.slice(at, at + 7))[0];
    if (chain && chain.tokens[0] === all[at]) names.add(chain.parts[chain.parts.length - 1].toLowerCase());
  }
  // CTEs: WITH name [(columns)] AS ( ... ) [, name [(columns)] AS ( ... )]
  if (lower(tokens[0]) === "with") {
    let i = 1;
    while (tokens[i] && (tokens[i].type === "word" || tokens[i].type === "quoted")) {
      names.add(lower(tokens[i]));
      i++;
      if (tokens[i]?.text === "(") i = close(tokens, i) + 1;
      if (lower(tokens[i]) !== "as" || tokens[i + 1]?.text !== "(") break;
      i = close(tokens, i + 1) + 1;
      if (tokens[i]?.text !== ",") break;
      i++;
    }
  }
  return names;
}

/** Index of the ")" closing the "(" at open, or the last index. */
function close(tokens: Token[], open: number): number {
  let depth = 0;
  for (let j = open; j < tokens.length; j++) {
    if (tokens[j].text === "(") depth++;
    else if (tokens[j].text === ")" && --depth === 0) return j;
  }
  return tokens.length - 1;
}

/**
 * Warnings for the statement around offset. Tables: any FROM, JOIN, UPDATE, INTO or DELETE name the catalog lacks,
 * except names defined earlier (CTEs, #temp, @table, created or selected INTO in the batch), names of three or more
 * parts, system views, function calls and an UPDATE or DELETE target that is another table's alias. Columns:
 * alias.column or table.column against that table's columns; a bare column only when the statement reads a single
 * table and has no subquery, and never for a word that could be an alias, keyword, function, type or date part.
 */
export function unknownNames(lookup: Lookup, text: string, offset: number): Warning[] {
  const { tokens, earlier, useDatabase } = statementScan(text, offset, "tsql");
  const index = lookup(useDatabase);
  if (!index || tokens.length === 0) return [];
  const warnings: Warning[] = [];

  const defined = definedNames(earlier, tokens);
  const refs = placedRefs(tokens);
  const aliases = new Set(refs.map((r) => r.ref.alias?.toLowerCase()).filter((a): a is string => !!a));
  const selectsInto = lower(tokens[0]) === "select" || lower(tokens[0]) === "with";
  /** Undefined: not a name the catalog should hold, so neither it nor its columns are checked. */
  const resolve = (r: PlacedRef): CatalogObject | null | undefined => {
    const { name, schema, database } = r.ref;
    if (r.call || r.dangling || database || name.startsWith("#")) return undefined;
    if (schema && SYSTEM_SCHEMAS.has(schema.toLowerCase())) return undefined;
    if (defined.has(name.toLowerCase()) || (r.keyword === "into" && selectsInto)) return undefined;
    if (!schema && (aliases.has(name.toLowerCase()) || NOT_COLUMNS.has(name.toLowerCase()))) return undefined;
    return index.find(name, schema) ?? null;
  };

  const tables = new Map<PlacedRef, CatalogObject | null | undefined>();
  for (const r of refs) {
    const found = resolve(r);
    tables.set(r, found);
    if (found === null) {
      const written = [r.ref.schema, r.ref.name].filter(Boolean).join(".");
      warnings.push({ start: r.first.start, end: r.last.end, message: `Unknown table or view '${written}'.` });
    }
  }

  const columnClause = inColumnClause(tokens);
  const position = new Map(tokens.map((t, i) => [t, i]));
  const missing = (object: CatalogObject, column: Token) => {
    if (!object.columns || object.columns.some((c) => c.name.toLowerCase() === column.value.toLowerCase())) return;
    warnings.push({ start: column.start, end: column.end, message: `Unknown column '${column.value}' in ${object.schema}.${object.name}.` });
  };

  // Qualified: alias.column, or table.column for a table without an alias.
  const qualified = new Set<Token>();
  for (const chain of nameChains(tokens)) {
    if (chain.parts.length !== 2) continue;
    const i = position.get(chain.tokens[1])!;
    for (const t of chain.tokens) qualified.add(t);
    if (!columnClause[i] || tokens[i + 1]?.text === "(") continue;
    const q = chain.parts[0].toLowerCase();
    const ref = refs.find((r) => r.ref.alias?.toLowerCase() === q) ?? refs.find((r) => !r.ref.alias && r.ref.name.toLowerCase() === q);
    const object = ref && tables.get(ref);
    if (object) missing(object, chain.tokens[1]);
  }

  // Bare: only with one real table (an alias-only UPDATE/DELETE target does not count) and no subquery.
  const real = refs.filter((r) => !(r.ref.schema === undefined && aliases.has(r.ref.name.toLowerCase())));
  const subquery = tokens.some((t, i) => t.text === "(" && lower(tokens[i + 1]) === "select");
  const only = real.length === 1 && !subquery ? tables.get(real[0]) : undefined;
  if (!only) return warnings;

  const selectAliases = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = tokens[i - 1];
    if (lower(prev) === "as" && isWord(prev)) selectAliases.add(lower(t));
    else if (tokens[i + 1]?.text === "=" && (lower(prev) === "select" || prev?.text === ",") && t.type !== "var") selectAliases.add(lower(t));
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if ((t.type !== "word" && t.type !== "quoted") || qualified.has(t) || !columnClause[i]) continue;
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    const word = t.value.toLowerCase();
    if (next?.text === "(" || next?.text === "." || prev?.text === "." || prev?.text === "$" || word.startsWith("#")) continue;
    if (t.type === "word" && NOT_COLUMNS.has(word)) continue;
    if (lower(prev) === "as" || lower(prev) === "collate" || selectAliases.has(word)) continue;
    // Another name, a literal or ")" just before: an alias written without AS (or TOP n), not a column.
    if (prev && (prev.type === "number" || prev.type === "string" || prev.text === ")" || ((prev.type === "word" || prev.type === "quoted") && !NOT_COLUMNS.has(lower(prev))))) continue;
    if (prev?.text === "(" && DATE_PART_FUNCTIONS.has(lower(tokens[i - 2]))) continue;
    missing(only, t);
  }
  return warnings;
}
