import type * as Monaco from "monaco-editor/editor/editor.api";
import { cssToken, EDITOR_THEME, editorTheme } from "./editor-theme";

let started = false;

/** Starts fetching the Monaco chunk ahead of the first query tab (docs/query-editor.md, "Monaco"). Idempotent. */
export function preloadMonaco(): void {
  if (started) return;
  started = true;
  void import("./monaco");
}

/** What every query editor is created with, the warm-up's included, so the font Monaco measures once is the one tabs use. */
export function createOptions(): Monaco.editor.IStandaloneEditorConstructionOptions {
  return {
    theme: EDITOR_THEME,
    automaticLayout: true,
    minimap: { enabled: false },
    fontFamily: cssToken("--font-mono").trim() || "Cascadia Mono, Consolas, monospace",
    fontSize: 13,
    scrollBeyondLastLine: false,
    renderLineHighlight: "line",
    tabSize: 4,
    wordWrap: "off",
    // Run errors get an icon in the gutter.
    glyphMargin: true,
    // Explorer rows drop their name as plain text; there is nothing else to offer, so no "drop as" picker.
    dropIntoEditor: { enabled: true, showDropSelector: "never" },
  };
}

/**
 * Once the tree has painted, in idle time (#190): loads Monaco, then creates and drops one editor off screen. The first
 * query tab then pays neither the module load nor the first editor's one-off set-up (services, font measurement),
 * which together put a cold Ctrl+N at about 190 ms against the 50 ms budget.
 */
export function warmEditorWhenIdle(): void {
  // A failure here is not the user's to see: the first tab loads Monaco again and reports it there.
  requestIdleCallback(() => void warmEditor().catch(() => {}), { timeout: 2000 });
}

async function warmEditor(): Promise<void> {
  const { monaco } = await import("./monaco");
  // The module's evaluation and the editor's set-up are each a long task: give input a turn between them.
  await new Promise((resolve) => requestIdleCallback(resolve, { timeout: 2000 }));
  monaco.editor.defineTheme(EDITOR_THEME, editorTheme(cssToken, window.matchMedia("(prefers-color-scheme: dark)").matches));
  const host = document.createElement("div");
  host.style.cssText = "position: fixed; left: -10000px; width: 400px; height: 200px; visibility: hidden";
  document.body.append(host);
  monaco.editor.create(host, { ...createOptions(), language: "tsql" }).dispose();
  host.remove();
}
