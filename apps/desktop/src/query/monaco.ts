// Loaded on demand (ADR 0006): fetched when a connection is first selected, created when the first query tab opens,
// so Monaco never costs start-up time. Only the core editor, the contributions listed in docs/query-editor.md and
// the query languages are bundled; no other language services.
import * as monaco from "monaco-editor/editor/editor.api";
import { conf as sqlConf, language as sqlLanguage } from "monaco-editor/languages/definitions/sql/sql";
import "monaco-editor/editor/contrib/find/browser/findController";
import "monaco-editor/editor/contrib/suggest/browser/suggestController";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution";
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching";
import "monaco-editor/editor/contrib/folding/browser/folding";
import "monaco-editor/editor/contrib/comment/browser/comment";
import "monaco-editor/editor/contrib/multicursor/browser/multicursor";
import "monaco-editor/editor/contrib/dropOrPasteInto/browser/dropIntoEditorContribution";
import "monaco-editor/editor/contrib/codeAction/browser/codeActionContributions";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { COSMOS_FUNCTIONS, COSMOS_KEYWORDS } from "./intellisense/cosmos-words";
import { registerIntelliSense, registerQuickFixes } from "./intellisense/providers";
import { intellisense } from "./intellisense/shared";
import { PGSQL_FUNCTIONS, PGSQL_KEYWORDS, PGSQL_TYPES } from "./intellisense/pgsql-words";
import { TSQL_KEYWORDS } from "./intellisense/tsql-words";

Object.assign(self, { MonacoEnvironment: { getWorker: () => new EditorWorker() } });

// T-SQL: Monaco's sql grammar with the T-SQL keywords it lacks. Colouring never uses a parser.
monaco.languages.register({ id: "tsql", aliases: ["T-SQL"] });
monaco.languages.setMonarchTokensProvider("tsql", {
  ...sqlLanguage,
  keywords: [...new Set([...sqlLanguage.keywords, ...TSQL_KEYWORDS])],
});
monaco.languages.setLanguageConfiguration("tsql", sqlConf);

monaco.languages.register({ id: "cosmos-sql", aliases: ["Cosmos SQL"] });
monaco.languages.setMonarchTokensProvider("cosmos-sql", {
  ignoreCase: true,
  keywords: COSMOS_KEYWORDS,
  builtins: COSMOS_FUNCTIONS,
  tokenizer: {
    root: [
      [/--.*$/, "comment"],
      [/@[a-zA-Z_]\w*/, "variable"],
      [/[a-zA-Z_]\w*/, { cases: { "@keywords": "keyword", "@builtins": "predefined", "@default": "identifier" } }],
      [/\d+(\.\d+)?([eE][-+]?\d+)?/, "number"],
      [/'([^'\\]|\\.)*'/, "string"],
      [/"([^"\\]|\\.)*"/, "string"],
      [/[{}()[\]]/, "@brackets"],
      [/[<>=!]=?|[-+*/%|&^~?:.,]/, "operator"],
      [/\s+/, "white"],
    ],
  },
});
monaco.languages.setLanguageConfiguration("cosmos-sql", {
  comments: { lineComment: "--" },
  brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
  autoClosingPairs: [{ open: "(", close: ")" }, { open: "[", close: "]" }, { open: "{", close: "}" }, { open: "'", close: "'" }, { open: '"', close: '"' }],
});

// Postgres: its own quoting, so not Monaco's sql grammar. "names", E'escapes', $tag$ bodies $tag$, nested /* */
// comments, $1 parameters and :: casts.
monaco.languages.register({ id: "pgsql", aliases: ["PostgreSQL"] });
monaco.languages.setMonarchTokensProvider("pgsql", {
  ignoreCase: true,
  keywords: PGSQL_KEYWORDS,
  types: PGSQL_TYPES,
  builtins: PGSQL_FUNCTIONS,
  tokenizer: {
    root: [
      [/--.*$/, "comment"],
      [/\/\*/, { token: "comment", next: "@comment" }],
      [/[eE]'/, { token: "string", next: "@escapeString" }],
      [/'/, { token: "string", next: "@string" }],
      [/"/, { token: "identifier.quote", next: "@quoted" }],
      [/\$\d+/, "variable"],
      [/\$\$/, { token: "string", next: "@dollar" }],
      [/\$([a-zA-Z_]\w*)\$/, { token: "string", next: "@dollarTag.$1" }],
      [/[a-zA-Z_][\w$]*/, { cases: { "@keywords": "keyword", "@types": "type", "@builtins": "predefined", "@default": "identifier" } }],
      [/\d+(\.\d+)?([eE][-+]?\d+)?/, "number"],
      [/::/, "operator"],
      [/[{}()[\]]/, "@brackets"],
      [/[<>=!~@#%^&|*/+-]+/, "operator"],
      [/[;,.]/, "delimiter"],
      [/\s+/, "white"],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      [/\/\*/, { token: "comment", next: "@push" }],
      [/\*\//, { token: "comment", next: "@pop" }],
      [/[/*]/, "comment"],
    ],
    string: [
      [/[^']+/, "string"],
      [/''/, "string"],
      [/'/, { token: "string", next: "@pop" }],
    ],
    escapeString: [
      [/[^\\']+/, "string"],
      [/\\./, "string.escape"],
      [/''/, "string"],
      [/'/, { token: "string", next: "@pop" }],
    ],
    quoted: [
      [/[^"]+/, "identifier"],
      [/""/, "identifier"],
      [/"/, { token: "identifier.quote", next: "@pop" }],
    ],
    // $$ and $tag$ bodies are separate states: "$$" in a Monarch state name is an escape, not the tag.
    dollar: [
      [/\$\$/, { token: "string", next: "@pop" }],
      [/[^$]+/, "string"],
      [/\$/, "string"],
    ],
    dollarTag: [
      [/\$([a-zA-Z_]\w*)\$/, { cases: { "$1==$S2": { token: "string", next: "@pop" }, "@default": "string" } }],
      [/[^$]+/, "string"],
      [/\$/, "string"],
    ],
  },
});
monaco.languages.setLanguageConfiguration("pgsql", {
  comments: { lineComment: "--", blockComment: ["/*", "*/"] },
  brackets: [["(", ")"], ["[", "]"]],
  autoClosingPairs: [{ open: "(", close: ")" }, { open: "[", close: "]" }, { open: "'", close: "'" }, { open: '"', close: '"' }],
  surroundingPairs: [{ open: "(", close: ")" }, { open: "'", close: "'" }, { open: '"', close: '"' }],
});

registerIntelliSense(monaco, intellisense);
registerQuickFixes(monaco);

export { intellisense, monaco };
