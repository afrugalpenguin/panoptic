// Monaco's themes from the app's CSS tokens (#236), so the editor follows the palette instead of Monaco's stock
// colours. Syntax colours still come from the stock theme for the scheme; only the editor's surfaces change.

/** Monaco's IStandaloneThemeData, structurally (this module stays importable without Monaco). */
export interface EditorTheme {
  base: "vs" | "vs-dark";
  inherit: boolean;
  rules: [];
  colors: Record<string, string>;
}

/** Editor colour ids and the token each takes. */
const COLORS: [string, string][] = [
  ["editor.background", "--bg-pane"],
  ["editor.foreground", "--text"],
  ["editorLineNumber.foreground", "--text-muted"],
  ["editor.lineHighlightBackground", "--bg-hover"],
  ["editor.selectionBackground", "--bg-selected"],
  ["editorCursor.foreground", "--accent"],
];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** read: a CSS custom property's value (getComputedStyle). Monaco takes hex only, so anything else keeps the stock colour. */
export function editorTheme(read: (name: string) => string, dark: boolean): EditorTheme {
  const colors: Record<string, string> = {};
  for (const [id, token] of COLORS) {
    const value = read(token).trim();
    if (HEX.test(value)) colors[id] = value;
  }
  return { base: dark ? "vs-dark" : "vs", inherit: true, rules: [], colors };
}

/** The live document's token values. */
export const cssToken = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name);

export const EDITOR_THEME = "panoptic";
