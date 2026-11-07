import { describe, expect, it } from "vitest";
import { editorTheme } from "./editor-theme";

const tokens: Record<string, string> = {
  "--bg-pane": " #1d1f23",
  "--text": "#e6e7ea",
  "--text-muted": "#9198a1",
  "--bg-hover": "#26292e",
  "--bg-selected": "#23395d",
  "--accent": "#4c8dff",
  "--border": "color-mix(in srgb, #fff 10%, transparent)",
};
const read = (name: string) => tokens[name] ?? "";

describe("editorTheme", () => {
  it("builds on the stock theme for the scheme and takes the editor's colours from the CSS tokens", () => {
    const t = editorTheme(read, true);
    expect(t.base).toBe("vs-dark");
    expect(t.inherit).toBe(true);
    expect(t.colors).toEqual({
      "editor.background": "#1d1f23",
      "editor.foreground": "#e6e7ea",
      "editorLineNumber.foreground": "#9198a1",
      "editor.lineHighlightBackground": "#26292e",
      "editor.selectionBackground": "#23395d",
      "editorCursor.foreground": "#4c8dff",
    });
  });

  it("skips a token that is not a plain hex colour, which Monaco cannot read", () => {
    expect(editorTheme(read, false).colors).not.toHaveProperty("editorWidget.border");
    expect(editorTheme(() => "", false)).toEqual({ base: "vs", inherit: true, rules: [], colors: {} });
  });
});
