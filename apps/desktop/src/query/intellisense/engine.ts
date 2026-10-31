// Completions and hover from a database catalog (docs/query-editor.md, "Completion engine"). Pure and synchronous:
// it runs in the IntelliSense worker, answers from indexes built once per catalog, and never calls the sidecar.

import type { CatalogObject, ContainerRef, DatabaseCatalog, PathRef } from "../catalog.svelte";
import { COSMOS_FUNCTIONS, COSMOS_KEYWORDS } from "./cosmos-words";
import { mdCode, mdText } from "./markdown";
import { PGSQL_FUNCTIONS, PGSQL_KEYWORDS, PGSQL_TYPES } from "./pgsql-words";
import { statementTokens, tablesAt, type Context, type Language, type TableRef, type Token } from "./scanner";
import { TSQL_FUNCTIONS, TSQL_KEYWORDS, TSQL_TYPES } from "./tsql-words";

export type ItemKind =
  | "table" | "view" | "proc" | "fn" | "synonym" | "column" | "param" | "variable" | "schema" | "type" | "keyword" | "function"
  | "path" | "container";

export interface Item {
  label: string;
  kind: ItemKind;
  /** Type, for columns, parameters and paths. */
  detail?: string;
  /** Muted text beside the label: a column's alias or table, a dbo object's schema. */
  description?: string;
  insertText: string;
  /** What the typed prefix is matched against, when it differs from the label. */
  filterText?: string;
  sortText: string;
  /** dbo objects: the schema is shown muted, as in the explorer. */
  dimmed?: boolean;
}

export interface Options {
  language: Language;
  /** Default: lower for T-SQL, upper for Cosmos. "preserve" keeps the lists' upper case. */
  keywordCase?: "lower" | "upper" | "preserve";
  /** The Cosmos container a tab is bound to; paths come from it (or from every container when absent). */
  container?: string;
}

/** The current database's index (no name), or a named database's, if its catalog has arrived. */
export type Lookup = (database?: string) => Index | undefined;

export interface Completions {
  items: Item[];
  /** A database named in the text whose catalog is not loaded; the caller fetches it in the background. */
  missing?: string;
}

export class Index {
  readonly catalog: DatabaseCatalog;
  private readonly schemas: Set<string>;
  private readonly bySchemaName = new Map<string, CatalogObject>();
  private readonly byName = new Map<string, CatalogObject[]>();

  constructor(catalog: DatabaseCatalog) {
    this.catalog = catalog;
    this.schemas = new Set(catalog.schemas.map((s) => s.toLowerCase()));
    for (const o of catalog.objects) {
      this.bySchemaName.set(`${o.schema.toLowerCase()}.${o.name.toLowerCase()}`, o);
      const key = o.name.toLowerCase();
      const list = this.byName.get(key);
      if (list) list.push(o);
      else this.byName.set(key, [o]);
    }
  }

  hasSchema(schema: string): boolean {
    return this.schemas.has(schema.toLowerCase());
  }

  /** Without a schema, the default schema (dbo, or public in Postgres) wins, then the first by schema order. */
  find(name: string, schema?: string, fallback = "dbo"): CatalogObject | undefined {
    if (schema) return this.bySchemaName.get(`${schema.toLowerCase()}.${name.toLowerCase()}`);
    const list = this.byName.get(name.toLowerCase());
    return list?.find((o) => o.schema.toLowerCase() === fallback) ?? list?.[0];
  }
}

/** Where an unqualified name resolves first. */
export function defaultSchema(language: Language): string {
  return language === "pgsql" ? "public" : "dbo";
}

const RESERVED = new Set(TSQL_KEYWORDS.map((k) => k.toLowerCase()));
const PG_RESERVED = new Set(PGSQL_KEYWORDS.map((k) => k.toLowerCase()));

/**
 * Brackets a T-SQL name that is not a plain identifier or is a keyword. A Postgres name is double-quoted unless it is
 * plain lower case: unquoted names fold to lower case there, so "Order" written bare would name order.
 */
export function quote(name: string, language: Language = "tsql"): string {
  if (language === "pgsql")
    return /^[a-z_][a-z0-9_$]*$/.test(name) && !PG_RESERVED.has(name) ? name : `"${name.replaceAll('"', '""')}"`;
  return /^[A-Za-z_][\w@#$]*$/.test(name) && !RESERVED.has(name.toLowerCase()) ? name : `[${name.replaceAll("]", "]]")}]`;
}

const eq = (a: string | undefined, b: string | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function resolve(lookup: Lookup, ref: TableRef, language: Language): CatalogObject | undefined {
  return lookup(ref.database)?.find(ref.name, ref.schema, defaultSchema(language));
}

class Items {
  readonly list: Item[] = [];
  add(group: number, item: Omit<Item, "sortText">): void {
    this.list.push({ ...item, sortText: `${group}${String(this.list.length).padStart(6, "0")}` });
  }
}

const OBJECT_KINDS = new Set(["table", "view", "synonym"]);

function objectItems(items: Items, objects: CatalogObject[], qualified: boolean, kinds: (o: CatalogObject) => boolean, language: Language): void {
  const fallback = defaultSchema(language);
  for (const o of objects) {
    if (!kinds(o)) continue;
    const dimmed = o.schema.toLowerCase() === fallback;
    const insert = qualified ? `${quote(o.schema, language)}.${quote(o.name, language)}` : quote(o.name, language);
    items.add(0, {
      label: qualified && !dimmed ? `${o.schema}.${o.name}` : o.name,
      kind: o.kind,
      insertText: insert,
      filterText: o.name,
      ...(qualified && dimmed ? { description: fallback, dimmed: true } : {}),
    });
  }
}

/** Objects or procs for a dotted qualifier: [] every schema, [schema] or [database] (its schemas), [database, schema]. */
function qualified(lookup: Lookup, qualifier: string[], kinds: (o: CatalogObject) => boolean, language: Language): Completions {
  const items = new Items();
  const current = lookup();
  if (qualifier.length === 0) {
    if (current) objectItems(items, current.catalog.objects, true, kinds, language);
    return { items: items.list };
  }
  if (qualifier.length === 1) {
    const [name] = qualifier;
    if (current?.hasSchema(name)) {
      objectItems(items, current.catalog.objects.filter((o) => eq(o.schema, name)), false, kinds, language);
      return { items: items.list };
    }
    // Postgres cannot name another database, so a qualifier that is not a schema is not one either.
    if (language === "pgsql") return { items: [] };
    const other = lookup(name);
    if (!other) return { items: [], missing: name };
    for (const s of other.catalog.schemas) items.add(0, { label: s, kind: "schema", insertText: quote(s, language) });
    return { items: items.list };
  }
  if (language === "pgsql") return { items: [] };
  const [database, schema] = qualifier.slice(-2);
  const other = lookup(database);
  if (!other) return { items: [], missing: database };
  objectItems(items, other.catalog.objects.filter((o) => eq(o.schema, schema)), false, kinds, language);
  return { items: items.list };
}

function cased(word: string, options: Options): string {
  const mode = options.keywordCase ?? (options.language === "cosmos-sql" ? "upper" : "lower");
  return mode === "lower" ? word.toLowerCase() : mode === "upper" ? word.toUpperCase() : word;
}

const WORDS: Record<Language, [string[], string[]]> = {
  tsql: [TSQL_KEYWORDS, TSQL_FUNCTIONS],
  "cosmos-sql": [COSMOS_KEYWORDS, COSMOS_FUNCTIONS],
  pgsql: [PGSQL_KEYWORDS, PGSQL_FUNCTIONS],
};

function keywordItems(items: Items, options: Options): void {
  const [keywords, functions] = WORDS[options.language];
  for (const f of functions) items.add(2, { label: cased(f, options), kind: "function", insertText: cased(f, options) });
  for (const k of keywords) items.add(3, { label: cased(k, options), kind: "keyword", insertText: cased(k, options) });
}

function containersFor(lookup: Lookup, options: Options): ContainerRef[] {
  const containers = lookup()?.catalog.containers ?? [];
  const bound = options.container ? containers.filter((c) => eq(c.name, options.container)) : [];
  return bound.length ? bound : containers;
}

/** Direct children of a path prefix; array element paths (lines[]) fold into their array (lines). */
function childPaths(containers: ContainerRef[], prefix: string[]): { label: string; path: PathRef }[] {
  const base = prefix.join(".");
  const seen = new Map<string, PathRef>();
  for (const c of containers)
    for (const p of c.paths) {
      if (base && !p.path.startsWith(base + ".")) continue;
      const rest = base ? p.path.slice(base.length + 1) : p.path;
      if (rest.includes(".")) continue;
      const label = rest.replace(/\[\]$/, "");
      if (label && !seen.has(label)) seen.set(label, p);
    }
  return [...seen].map(([label, path]) => ({ label, path }));
}

export function complete(lookup: Lookup, ctx: Context, options: Options): Completions {
  const items = new Items();
  const { language } = options;
  const q = (name: string) => quote(name, language);
  switch (ctx.kind) {
    case "none":
      return { items: [] };
    case "objects":
      return qualified(lookup, ctx.qualifier, (o) => OBJECT_KINDS.has(o.kind) || (o.kind === "fn" && !!o.columns), language);
    case "procs":
      return qualified(lookup, ctx.qualifier, (o) => o.kind === "proc", language);
    case "columns": {
      const resolved = ctx.tables.map((t) => ({ ref: t, object: resolve(lookup, t, language) }));
      const counts = new Map<string, number>();
      for (const { object } of resolved)
        for (const c of object?.columns ?? []) counts.set(c.name.toLowerCase(), (counts.get(c.name.toLowerCase()) ?? 0) + 1);
      for (const { ref, object } of resolved) {
        const owner = ref.alias ?? ref.name;
        for (const c of object?.columns ?? []) {
          const clash = (counts.get(c.name.toLowerCase()) ?? 0) > 1;
          items.add(1, {
            label: c.name,
            kind: "column",
            detail: c.type,
            description: owner,
            insertText: clash ? `${q(owner)}.${q(c.name)}` : q(c.name),
            filterText: c.name,
          });
        }
      }
      keywordItems(items, options);
      return { items: items.list };
    }
    case "aliasColumns": {
      const object = resolve(lookup, ctx.table, language);
      if (!object && ctx.table.database && !lookup(ctx.table.database)) return { items: [], missing: ctx.table.database };
      for (const c of object?.columns ?? []) items.add(1, { label: c.name, kind: "column", detail: c.type, insertText: q(c.name) });
      return { items: items.list };
    }
    case "params": {
      const proc = lookup()?.find(ctx.proc, ctx.schema, defaultSchema(language));
      for (const p of proc?.params ?? [])
        items.add(1, { label: p.name, kind: "param", detail: p.output ? `${p.type} output` : p.type, insertText: p.name });
      return { items: items.list };
    }
    case "variables":
      for (const name of ctx.names) items.add(1, { label: name, kind: "variable", insertText: name });
      return { items: items.list };
    case "types": {
      const types = lookup()?.catalog.types.length ? lookup()!.catalog.types : language === "pgsql" ? PGSQL_TYPES : TSQL_TYPES;
      for (const t of [...types].sort()) items.add(1, { label: t, kind: "type", insertText: t });
      return { items: items.list };
    }
    case "keywords":
      keywordItems(items, options);
      return { items: items.list };
    case "cosmosPaths":
      for (const { label, path } of childPaths(containersFor(lookup, options), ctx.prefix))
        items.add(1, { label, kind: "path", detail: path.types.join(" | "), insertText: label });
      return { items: items.list };
    case "cosmosFrom":
      items.add(0, { label: "c", kind: "keyword", insertText: "c" });
      for (const c of containersFor(lookup, options)) items.add(1, { label: c.name, kind: "container", insertText: c.name });
      return { items: items.list };
  }
}

const isName = (t: Token | undefined) => !!t && (t.type === "word" || t.type === "quoted");

function objectMarkdown(o: CatalogObject): string {
  const lines = [
    ...(o.columns ?? []).map((c) => `${mdCode(c.name)} ${mdText(c.type)}, ${c.nullable ? "null" : "not null"}`),
    ...(o.params ?? []).map((p) => `${mdCode(p.name)} ${mdText(p.type)}${p.output ? " output" : ""}`),
  ];
  const shown = lines.slice(0, 40);
  if (lines.length > shown.length) shown.push(`and ${lines.length - shown.length} more`);
  return [`**${mdText(`${o.schema}.${o.name}`)}** ${o.kind}`, ...(shown.length ? ["", shown.join("  \n")] : [])].join("\n");
}

/** Markdown for the name under the cursor: an object, a column, or a Cosmos path. Null when there is nothing to say. */
export function hover(lookup: Lookup, text: string, offset: number, options: Pick<Options, "language" | "container">): string | null {
  const tokens = statementTokens(text, offset, options.language).filter((t) => t.type !== "comment");
  const at = tokens.findIndex((t) => isName(t) && t.start <= offset && offset <= t.end);
  if (at < 0) return null;
  const parts = [tokens[at].value];
  for (let i = at; i >= 2 && tokens[i - 1].text === "." && isName(tokens[i - 2]); i -= 2) parts.unshift(tokens[i - 2].value);

  if (options.language === "cosmos-sql") {
    if (parts.length < 2) return null;
    const path = parts.slice(1).join(".");
    for (const c of containersFor(lookup, options)) {
      const found = c.paths.find((p) => p.path === path);
      if (found) return `**${mdText(path)}** ${found.types.map(mdText).join(" | ")}`;
    }
    return null;
  }

  const name = parts[parts.length - 1];
  const fallback = defaultSchema(options.language);
  const object = lookup(parts.length >= 3 ? parts[parts.length - 3] : undefined)?.find(name, parts.length >= 2 ? parts[parts.length - 2] : undefined, fallback);
  if (object) return objectMarkdown(object);

  const tables = tablesAt(text, offset, options.language);
  const candidates =
    parts.length >= 2
      ? tables.filter((t) => eq(t.alias, parts[parts.length - 2])).concat(tables.filter((t) => eq(t.name, parts[parts.length - 2])))
      : tables;
  for (const ref of candidates) {
    const owner = resolve(lookup, ref, options.language);
    const column = owner?.columns?.find((c) => eq(c.name, name));
    if (owner && column) return `**${mdText(column.name)}** ${mdText(column.type)}, ${column.nullable ? "null" : "not null"} (${mdText(`${owner.schema}.${owner.name}`)})`;
  }
  return null;
}
