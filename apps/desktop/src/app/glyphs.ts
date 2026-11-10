// Icons drawn in more than one place, on a 16px grid in currentColor (docs/design-tokens.md), stroked unless FILLED
// says otherwise: the explorer footer's buttons, the status bar's Settings gear, the landing's actions, the detail
// panes' buttons and rows, and the folder in the tree and detail pane.

export const GLYPHS = {
  import: "M8 2.5v7 M5 6.5 8 9.5l3-3 M2.5 10.5v3h11v-3",
  environment: "M1.5 4.5h4l1.5 1.5h7.5v7.5h-13z M8 8v3.5 M6.25 9.75h3.5",
  connection: "M3 4c0-1.1 2.2-2 5-2s5 .9 5 2-2.2 2-5 2-5-.9-5-2z M3 4v8c0 1.1 2.2 2 5 2 M13 4v4 M12 10v4 M10 12h4",
  "expand-all": "M4 3.5l4 3 4-3 M4 9l4 3 4-3",
  "collapse-all": "M4 7l4-3 4 3 M4 12.5l4-3 4 3",
  // Filled, not stroked (FILLED below): the status bar gear (#366). An eight-tooth gear with a hole, even-odd.
  settings:
    "M6.79 2.74L7.03 1.07L8.97 1.07L9.21 2.74A5.4 5.4 0 0 1 10.86 3.42L12.21 2.41L13.59 3.79L12.58 5.14A5.4 5.4 0 0 1 13.26 6.79L14.93 7.03L14.93 8.97L13.26 9.21A5.4 5.4 0 0 1 12.58 10.86L13.59 12.21L12.21 13.59L10.86 12.58A5.4 5.4 0 0 1 9.21 13.26L8.97 14.93L7.03 14.93L6.79 13.26A5.4 5.4 0 0 1 5.14 12.58L3.79 13.59L2.41 12.21L3.42 10.86A5.4 5.4 0 0 1 2.74 9.21L1.07 8.97L1.07 7.03L2.74 6.79A5.4 5.4 0 0 1 3.42 5.14L2.41 3.79L3.79 2.41L5.14 3.42A5.4 5.4 0 0 1 6.79 2.74ZM10.2 8a2.2 2.2 0 1 0 -4.4 0a2.2 2.2 0 1 0 4.4 0z",
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

/** Glyphs drawn as a filled shape (fill-rule evenodd) rather than a 1.3px stroke. */
export const FILLED: ReadonlySet<GlyphName> = new Set<GlyphName>(["settings"]);
