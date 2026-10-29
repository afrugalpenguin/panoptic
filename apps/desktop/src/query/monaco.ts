// Loaded on demand when the first query tab opens (ADR 0006), so Monaco never costs start-up time.
// Only the core editor and the SQL grammar are bundled; no TypeScript or JSON language services.
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/languages/definitions/sql/register";
import "monaco-editor/editor/contrib/find/browser/findController";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

Object.assign(self, { MonacoEnvironment: { getWorker: () => new EditorWorker() } });

const COSMOS_KEYWORDS = [
  "SELECT", "VALUE", "TOP", "DISTINCT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "BETWEEN", "LIKE", "ESCAPE",
  "EXISTS", "AS", "JOIN", "ORDER", "BY", "ASC", "DESC", "GROUP", "OFFSET", "LIMIT", "ARRAY", "UNDEFINED",
  "NULL", "TRUE", "FALSE",
];

const COSMOS_FUNCTIONS = [
  "COUNT", "SUM", "AVG", "MIN", "MAX", "ABS", "CEILING", "FLOOR", "ROUND", "POWER", "SQRT", "ARRAY_CONCAT",
  "ARRAY_CONTAINS", "ARRAY_LENGTH", "ARRAY_SLICE", "IS_ARRAY", "IS_BOOL", "IS_DEFINED", "IS_NULL", "IS_NUMBER",
  "IS_OBJECT", "IS_PRIMITIVE", "IS_STRING", "CONCAT", "CONTAINS", "ENDSWITH", "STARTSWITH", "INDEX_OF", "LEFT",
  "RIGHT", "LENGTH", "LOWER", "UPPER", "LTRIM", "RTRIM", "TRIM", "REPLACE", "REPLICATE", "REVERSE", "SUBSTRING",
  "TOSTRING", "STRINGTOARRAY", "STRINGTONUMBER", "STRINGTOOBJECT", "GETCURRENTDATETIME", "GETCURRENTTIMESTAMP",
  "DATETIMEADD", "DATETIMEDIFF", "DATETIMEPART", "ST_DISTANCE", "ST_WITHIN", "ST_INTERSECTS", "RegexMatch",
];

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
