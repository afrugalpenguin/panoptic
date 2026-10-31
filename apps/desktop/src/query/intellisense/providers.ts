// Monaco completion and hover providers for tsql, cosmos-sql and pgsql: thin adapters that ask the IntelliSense worker.
// Monaco is passed in (this module never imports it at runtime), so the mapping is testable without an editor.

import type * as Monaco from "monaco-editor/editor/editor.api";
import type { DatabaseCatalog } from "../catalog.svelte";
import type { IntelliSenseClient } from "./client";
import type { Item, ItemKind, Options } from "./engine";
import type { Keys } from "./worker";

/** What a query tab's model completes against. Read on every request, so setting changes apply at once. */
export interface ModelInfo {
  enabled: boolean;
  options: Options;
  keys: Keys;
  catalogs: { key: string; catalog?: DatabaseCatalog; version: number }[];
  /** Underline unknown tables and columns in the statement at the cursor (T-SQL and Postgres). */
  warnUnknownNames: boolean;
  /** A database named in the text has no catalog yet: fetch it in the background. */
  onMissing(database: string): void;
}

/** Set by QueryEditor for each model it creates. */
export const models = new WeakMap<object, () => ModelInfo | undefined>();

/** A quick fix on a mark (a run error's name, or a lint warning): offered where range is, applied as edits. */
export interface QuickFix {
  range: Monaco.IRange;
  label: string;
  edits: { range: Monaco.IRange; text: string }[];
}

/** Set by QueryEditor for each model: the fixes for its current error marks and warnings, at their current ranges. */
export const quickFixes = new WeakMap<object, () => QuickFix[]>();

const touches = (a: Monaco.IRange, b: Monaco.IRange) =>
  !(a.endLineNumber < b.startLineNumber || (a.endLineNumber === b.startLineNumber && a.endColumn < b.startColumn) ||
    b.endLineNumber < a.startLineNumber || (b.endLineNumber === a.startLineNumber && b.endColumn < a.startColumn));

/**
 * "Did you mean" fixes from run errors (docs/query-editor.md, "Error location") and the Postgres T-SQL habit fixes,
 * offered on their marks.
 */
export function registerQuickFixes(monaco: typeof Monaco): void {
  for (const language of ["tsql", "pgsql"]) {
    monaco.languages.registerCodeActionProvider(language, {
      provideCodeActions(model, range, context) {
        const actions = (quickFixes.get(model)?.() ?? [])
          .filter((f) => touches(f.range, range))
          .map((f): Monaco.languages.CodeAction => ({
            title: `Change to ${f.label}`,
            kind: "quickfix",
            isPreferred: true,
            diagnostics: context.markers.filter((m) => touches(m, f.range)),
            edit: { edits: f.edits.map((e) => ({ resource: model.uri, textEdit: { range: e.range, text: e.text }, versionId: undefined })) },
          }));
        return { actions, dispose() {} };
      },
    });
  }
}

type Kinds = Record<string, number>;

const KIND: Record<ItemKind, string> = {
  table: "Struct", view: "Interface", synonym: "Reference", proc: "Method", fn: "Function", column: "Field", param: "Variable",
  variable: "Variable", schema: "Module", type: "TypeParameter", keyword: "Keyword", function: "Function", path: "Property",
  container: "Folder",
};

export function toMonacoItem(item: Item, range: Monaco.IRange, kinds: Kinds): Monaco.languages.CompletionItem {
  const label: Monaco.languages.CompletionItemLabel = { label: item.label };
  if (item.detail) label.detail = ` ${item.detail}`;
  if (item.description) label.description = item.description;
  const result: Monaco.languages.CompletionItem = { label, kind: kinds[KIND[item.kind]], insertText: item.insertText, sortText: item.sortText, range };
  if (item.filterText) result.filterText = item.filterText;
  return result;
}

const LEADS_INTO_NAMES = new Set([
  "from", "join", "update", "into", "table", "exec", "execute", "select", "where", "on", "by", "having", "set", "and", "or", "as",
  "call", "returning",
]);

/** Space is a trigger character, but only a keyword that leads into names should open the list. */
export function shouldSuggestAfterSpace(linePrefix: string): boolean {
  if ((linePrefix.match(/'/g)?.length ?? 0) % 2 === 1) return false;
  const match = /([A-Za-z_]+)\s$/.exec(linePrefix);
  return !!match && LEADS_INTO_NAMES.has(match[1].toLowerCase());
}

export function registerIntelliSense(monaco: typeof Monaco, client: IntelliSenseClient): void {
  const info = (model: Monaco.editor.ITextModel) => {
    const current = models.get(model)?.();
    if (!current?.enabled) return undefined;
    for (const c of current.catalogs) client.sync(c.key, c.catalog, c.version);
    return current;
  };

  for (const language of ["tsql", "cosmos-sql", "pgsql"]) {
    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: [".", "@", " "],
      async provideCompletionItems(model, position, context) {
        const current = info(model);
        if (!current) return { suggestions: [] };
        if (context.triggerCharacter === " ") {
          const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
          if (!shouldSuggestAfterSpace(line)) return { suggestions: [] };
        }
        const offset = model.getOffsetAt(position);
        const response = await client.complete(model.getValue(), offset, current.options, current.keys);
        if (response.missing) current.onMissing(response.missing);
        const start = model.getPositionAt(response.start);
        const range = { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: position.lineNumber, endColumn: position.column };
        return { suggestions: response.items.map((i) => toMonacoItem(i, range, monaco.languages.CompletionItemKind as unknown as Kinds)) };
      },
    });

    monaco.languages.registerHoverProvider(language, {
      async provideHover(model, position) {
        const current = info(model);
        if (!current) return null;
        const response = await client.hover(model.getValue(), model.getOffsetAt(position), current.options, current.keys);
        return response.markdown ? { contents: [{ value: response.markdown }] } : null;
      },
    });
  }
}
