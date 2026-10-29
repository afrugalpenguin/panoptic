// Loaded on demand (ADR 0006): fetched when a connection is first selected, created when the first query tab opens,
// so Monaco never costs start-up time. Only the core editor, the contributions listed in docs/query-editor.md and
// the two query languages are bundled; no other language services.
import * as monaco from "monaco-editor/editor/editor.api";
import { conf as sqlConf, language as sqlLanguage } from "monaco-editor/languages/definitions/sql/sql";
import "monaco-editor/editor/contrib/find/browser/findController";
import "monaco-editor/editor/contrib/suggest/browser/suggestController";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution";
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching";
import "monaco-editor/editor/contrib/folding/browser/folding";
import "monaco-editor/editor/contrib/comment/browser/comment";
import "monaco-editor/editor/contrib/multicursor/browser/multicursor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import IntelliSenseWorker from "./intellisense/worker-entry?worker";
import { IntelliSenseClient } from "./intellisense/client";
import { COSMOS_FUNCTIONS, COSMOS_KEYWORDS } from "./intellisense/cosmos-words";
import { registerIntelliSense } from "./intellisense/providers";
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

registerIntelliSense(monaco, new IntelliSenseClient(() => new IntelliSenseWorker()));

export { monaco };
