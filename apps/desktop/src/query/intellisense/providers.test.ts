import { describe, expect, it } from "vitest";
import type * as Monaco from "monaco-editor/editor/editor.api";
import type { IntelliSenseClient } from "./client";
import { quickFixes, registerIntelliSense, registerQuickFixes, shouldSuggestAfterSpace, toMonacoItem } from "./providers";

const kinds = { Struct: 1, Field: 2, Keyword: 3, Function: 4, Method: 5, Variable: 6, Module: 7, TypeParameter: 8, Interface: 9, Reference: 10, Property: 11, Folder: 12 };
const range = { startLineNumber: 1, startColumn: 15, endLineNumber: 1, endColumn: 18 };

describe("toMonacoItem", () => {
  it("maps label parts, kind, insert and sort text", () => {
    const item = toMonacoItem(
      { label: "Customer", kind: "table", insertText: "dbo.Customer", filterText: "Customer", sortText: "0000001", description: "dbo", dimmed: true },
      range,
      kinds,
    );
    expect(item).toEqual({
      label: { label: "Customer", description: "dbo" },
      kind: kinds.Struct,
      insertText: "dbo.Customer",
      filterText: "Customer",
      sortText: "0000001",
      range,
    });
  });

  it("puts a type beside the label and the owner at the end", () => {
    const item = toMonacoItem({ label: "Total", kind: "column", detail: "decimal(18, 2)", description: "o", insertText: "Total", sortText: "1" }, range, kinds);
    expect(item.label).toEqual({ label: "Total", detail: " decimal(18, 2)", description: "o" });
    expect(item.kind).toBe(kinds.Field);
  });
});

describe("shouldSuggestAfterSpace", () => {
  it("opens the list after a space only when a keyword leads into names", () => {
    for (const line of ["select * from ", "  JOIN ", "exec ", "select ", "where a = 1 and ", "order by ", "update ", "insert into "])
      expect(shouldSuggestAfterSpace(line), line).toBe(true);
    for (const line of ["select a ", "select a, b ", "begin ", "", "from", "select 'from "]) expect(shouldSuggestAfterSpace(line), line).toBe(false);
  });
});

describe("registration", () => {
  it("serves completion, hover and quick fixes to the Postgres editor too", () => {
    const registered: Record<string, string[]> = { completion: [], hover: [], codeAction: [] };
    const monaco = {
      languages: {
        CompletionItemKind: {},
        registerCompletionItemProvider: (language: string) => void registered.completion.push(language),
        registerHoverProvider: (language: string) => void registered.hover.push(language),
        registerCodeActionProvider: (language: string) => void registered.codeAction.push(language),
      },
    } as unknown as typeof Monaco;
    registerIntelliSense(monaco, {} as IntelliSenseClient);
    registerQuickFixes(monaco);
    expect(registered).toEqual({ completion: ["tsql", "cosmos-sql", "pgsql"], hover: ["tsql", "cosmos-sql", "pgsql"], codeAction: ["tsql", "pgsql"] });
  });

  it("opens the list after CALL and RETURNING", () => {
    expect(shouldSuggestAfterSpace("call ")).toBe(true);
    expect(shouldSuggestAfterSpace("delete from t returning ")).toBe(true);
  });
});

describe("quick fixes", () => {
  it("apply every edit of a fix whose mark touches the range", () => {
    let provider: Monaco.languages.CodeActionProvider | undefined;
    const monaco = { languages: { registerCodeActionProvider: (_: string, p: Monaco.languages.CodeActionProvider) => void (provider = p) } } as unknown as typeof Monaco;
    registerQuickFixes(monaco);
    const at = (line: number, start: number, end: number) => ({ startLineNumber: line, startColumn: start, endLineNumber: line, endColumn: end });
    const model = { uri: "file:///q" };
    quickFixes.set(model, () => [
      { range: at(1, 8, 14), label: "limit 10", edits: [{ range: at(1, 8, 15), text: "" }, { range: at(1, 30, 30), text: " limit 10" }] },
      { range: at(3, 1, 3), label: "now()", edits: [{ range: at(3, 1, 3), text: "now()" }] },
    ]);
    const result = provider!.provideCodeActions(model as never, at(1, 9, 9) as never, { markers: [] } as never, {} as never) as Monaco.languages.CodeActionList;
    expect(result.actions.map((a) => [a.title, a.edit!.edits.map((e) => (e as Monaco.languages.IWorkspaceTextEdit).textEdit.text)])).toEqual([
      ["Change to limit 10", ["", " limit 10"]],
    ]);
  });
});
