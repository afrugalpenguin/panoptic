// The IntelliSense worker's message handling (docs/query-editor.md, "Completion engine"). It holds its own copy of
// each catalog, indexed once on arrival, and answers completion and hover requests from them, plus the "did you mean"
// and unknown-name lookups of "Error location". worker-entry.ts wires this to the worker's message port.

import type { DatabaseCatalog } from "../catalog.svelte";
import { complete, hover, Index, type Item, type Lookup, type Options } from "./engine";
import { unknownNames, type Warning } from "./lint";
import { contextAt, type Language, type TableRef } from "./scanner";
import { suggestColumn, suggestObject, type Suggestion } from "./suggest";

/** Which catalogs a request reads: the tab's own, and any other databases on its connection known so far. */
export interface Keys {
  current?: string;
  /** Lower-cased database name to catalog key. */
  databases: Record<string, string>;
}

/** A name error to suggest a fix for: the error number and what the statement says around the name. */
export interface SuggestRequest {
  /** SQL Server's error number; 0 for Postgres, which sends state instead. */
  number: number;
  /** Postgres SQLSTATE: 42P01 undefined table, 42703 undefined column, 42883 undefined function. */
  state?: string;
  /** Default tsql. */
  language?: Language;
  /** The name's parts as written ([schema, name] or [name]; a column's name alone). */
  parts: string[];
  /** A column's alias or table qualifier. */
  qualifier?: string;
  /** The statement's FROM and JOIN tables, for columns. */
  tables: TableRef[];
  /** The database named by the last USE before the statement. */
  useDatabase?: string;
}

export type Request =
  | { type: "catalog"; key: string; catalog: DatabaseCatalog }
  | { type: "complete"; id: number; text: string; offset: number; options: Options; keys: Keys }
  | { type: "hover"; id: number; text: string; offset: number; options: Options; keys: Keys }
  | ({ type: "suggest"; id: number; keys: Keys } & SuggestRequest)
  | { type: "lint"; id: number; text: string; offset: number; keys: Keys; language?: Language };

export type CompleteResponse = { id: number; items: Item[]; start: number; missing?: string };
export type HoverResponse = { id: number; markdown: string | null };
export type SuggestResponse = { id: number; suggestion?: Suggestion };
export type LintResponse = { id: number; warnings: Warning[] };
export type Response = CompleteResponse | HoverResponse | SuggestResponse | LintResponse;

const indexes = new Map<string, Index>();

function lookup(keys: Keys, useDatabase?: string): Lookup {
  const byName = (name: string) => {
    const key = keys.databases[name.toLowerCase()];
    return key ? indexes.get(key) : undefined;
  };
  return (database) => {
    if (database) return byName(database);
    if (useDatabase) return byName(useDatabase);
    return keys.current ? indexes.get(keys.current) : undefined;
  };
}

function suggest(message: SuggestRequest & { keys: Keys }): Suggestion | undefined {
  const { number, state, language = "tsql" } = message;
  const find = lookup(message.keys, message.useDatabase);
  if (number === 207 || state === "42703") return suggestColumn(find, message.tables, message.parts[message.parts.length - 1], message.qualifier, language);
  const index = find();
  if (!index) return undefined;
  if (number === 208 || state === "42P01") return suggestObject(index, message.parts, "objects", language);
  if (number === 2812) return suggestObject(index, message.parts, "procs", language);
  if (state === "42883") return suggestObject(index, message.parts, "routines", language);
  return undefined;
}

export function handle(message: Request): Response | undefined {
  switch (message.type) {
    case "catalog":
      indexes.set(message.key, new Index(message.catalog));
      return undefined;
    case "complete": {
      const ctx = contextAt(message.text, message.offset, message.options.language);
      const result = complete(lookup(message.keys, ctx.useDatabase), ctx.context, message.options);
      // A USE naming a database whose catalog has not arrived yet is missing too.
      const missing = result.missing ?? (ctx.useDatabase && !lookup(message.keys, ctx.useDatabase)() ? ctx.useDatabase : undefined);
      return missing ? { id: message.id, items: result.items, start: ctx.start, missing } : { id: message.id, items: result.items, start: ctx.start };
    }
    case "hover": {
      const ctx = contextAt(message.text, message.offset, message.options.language);
      return { id: message.id, markdown: hover(lookup(message.keys, ctx.useDatabase), message.text, message.offset, message.options) };
    }
    case "suggest": {
      const suggestion = suggest(message);
      return suggestion ? { id: message.id, suggestion } : { id: message.id };
    }
    case "lint":
      return { id: message.id, warnings: unknownNames(lookup(message.keys), message.text, message.offset, message.language) };
  }
}
