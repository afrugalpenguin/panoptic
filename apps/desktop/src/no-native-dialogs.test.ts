// Tauri's webview does not implement window.confirm, alert or prompt, so a call silently does nothing (confirm returns
// as if confirmed). Ask with ConfirmDialog instead (docs/explorer-ux.md, "Destructive actions").
import { describe, expect, it } from "vitest";

// A call, bare or on window, but not a method of something else (dialog.confirm) or a longer name (confirmText).
const CALL = /(?<![\w$.])(?:window\.)?(confirm|alert|prompt)\s*\(/g;

// Every source file under src, as text. Tests are skipped: they hold these names in string fixtures.
const SOURCES = import.meta.glob<string>(["./**/*.ts", "./**/*.svelte", "!./**/*.test.ts", "!**/node_modules/**"], {
  query: "?raw",
  import: "default",
  eager: true,
});

function nativeDialogCalls(source: string): string[] {
  return [...source.matchAll(CALL)].map((m) => m[0]);
}

describe("native dialogs", () => {
  it("finds bare and window calls but not methods or longer names", () => {
    expect(nativeDialogCalls('if (confirm("x")) alert(1); window.prompt("y")')).toEqual(['confirm(', 'alert(', 'window.prompt(']);
    expect(nativeDialogCalls("confirmText(a); dialog.confirm(); onalert(); x.prompt (1)")).toEqual([]);
  });

  it("are never called: use ConfirmDialog (apps/desktop/src/app/ConfirmDialog.svelte)", () => {
    const files = Object.entries(SOURCES);
    expect(files.length).toBeGreaterThan(50);
    const found = files.flatMap(([file, text]) => nativeDialogCalls(text).map((call) => `${file}: ${call}`));
    expect(found, "window.confirm/alert/prompt do nothing in Tauri; use ConfirmDialog").toEqual([]);
  });
});
