// The IntelliSense worker's message handling (docs/query-editor.md, "Completion engine"). It holds its own copy of
// each catalog, indexed once on arrival, and answers completion and hover requests from them. worker-entry.ts wires
// this to the worker's message port.

import type { DatabaseCatalog } from "../catalog.svelte";
import { complete, hover, Index, type Item, type Lookup, type Options } from "./engine";
import { contextAt } from "./scanner";

/** Which catalogs a request reads: the tab's own, and any other databases on its connection known so far. */
export interface Keys {
  current?: string;
  /** Lower-cased database name to catalog key. */
  databases: Record<string, string>;
}

export type Request =
  | { type: "catalog"; key: string; catalog: DatabaseCatalog }
  | { type: "complete"; id: number; text: string; offset: number; options: Options; keys: Keys }
  | { type: "hover"; id: number; text: string; offset: number; options: Options; keys: Keys };

export type CompleteResponse = { id: number; items: Item[]; start: number; missing?: string };
export type HoverResponse = { id: number; markdown: string | null };
export type Response = CompleteResponse | HoverResponse;

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
  }
}
