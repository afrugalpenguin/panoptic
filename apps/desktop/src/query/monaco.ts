// Loaded on demand when the first query tab opens (ADR 0006), so Monaco never costs start-up time.
// Only the core editor and the SQL grammar are bundled; no TypeScript or JSON language services.
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/languages/definitions/sql/register";
import "monaco-editor/editor/contrib/find/browser/findController";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import { COSMOS_FUNCTIONS, COSMOS_KEYWORDS } from "./intellisense/cosmos-words";

Object.assign(self, { MonacoEnvironment: { getWorker: () => new EditorWorker() } });

monaco.languages.register({ id: "cosmos", aliases: ["Cosmos SQL"] });
monaco.languages.setMonarchTokensProvider("cosmos", {
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
monaco.languages.setLanguageConfiguration("cosmos", {
  comments: { lineComment: "--" },
  brackets: [["{", "}"], ["[", "]"], ["(", ")"]],
  autoClosingPairs: [{ open: "(", close: ")" }, { open: "[", close: "]" }, { open: "{", close: "}" }, { open: "'", close: "'" }, { open: '"', close: '"' }],
});

export { monaco };
