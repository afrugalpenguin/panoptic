// Monaco ships no declaration for its sql Monarch definition; monaco.ts extends it into the tsql language.
declare module "monaco-editor/languages/definitions/sql/sql" {
  import type { languages } from "monaco-editor/editor/editor.api";
  export const conf: languages.LanguageConfiguration;
  export const language: languages.IMonarchLanguage & { keywords: string[] };
}
