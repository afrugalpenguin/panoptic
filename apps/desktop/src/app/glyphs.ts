// Stroke icons drawn in more than one place, on a 16px grid in currentColor (docs/design-tokens.md): the explorer
// footer's buttons, the landing's actions, the detail panes' buttons and rows, and the folder in the tree and detail pane.

export const GLYPHS = {
  import: "M8 2.5v7 M5 6.5 8 9.5l3-3 M2.5 10.5v3h11v-3",
  environment: "M1.5 4.5h4l1.5 1.5h7.5v7.5h-13z M8 8v3.5 M6.25 9.75h3.5",
  connection: "M3 4c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2z M3 4v8c0 1.1 2.2 2 5 2 M13 4v4 M12 10v4 M10 12h4",
  "expand-all": "M4 3.5l4 3 4-3 M4 9l4 3 4-3",
  "collapse-all": "M4 7l4-3 4 3 M4 12.5l4-3 4 3",
  settings:
    "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z M8 1.5v2 M8 12.5v2 M1.5 8h2 M12.5 8h2 M3.4 3.4l1.4 1.4 M11.2 11.2l1.4 1.4 M3.4 12.6l1.4-1.4 M11.2 4.8l1.4-1.4",
  query: "M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3 M8 7.5v5 M5.5 10h5",
  folder: "M1.5 3.5h4l1.5 1.5h7.5v8h-13z",
  refresh: "M13 2.5v3.5h-3.5 M12.6 6A5 5 0 1 0 13 9",
  "arrow-up": "M8 12.5v-9 M4.5 7 8 3.5 11.5 7",
  "arrow-down": "M8 3.5v9 M4.5 9 8 12.5 11.5 9",
  chevron: "M5 6.5 8 9.5l3-3",
  copy: "M5.5 5.5h7v8h-7z M3.5 10.5v-8h7",
  lock: "M4 7.5h8v6H4z M5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5",
} as const;

export type GlyphName = keyof typeof GLYPHS;
