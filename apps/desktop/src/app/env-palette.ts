// Environment colours: one palette for the swatches (New environment, the environment pane's Colour) and the colours
// Import assigns. They are saved in config as hex, so they are values here rather than CSS tokens
// (docs/design-tokens.md).

export const ENV_COLORS = {
  red: "#e03131",
  deepOrange: "#e8590c",
  orange: "#f08c00",
  green: "#2f9e44",
  blue: "#1971c2",
  teal: "#0c8599",
  violet: "#7048e8",
  pink: "#d6336c",
  lime: "#66a80f",
  indigo: "#5c7cfa",
  grey: "#868e96",
} as const;

const c = ENV_COLORS;

/** The swatches New environment and the environment pane offer, in order. */
export const ENV_PICKER: string[] = [c.green, c.blue, c.orange, c.red, c.violet, c.teal, c.grey];

/** Colours Import gives environments whose names it does not recognise, in turn. */
export const ENV_EXTRA: string[] = [c.violet, c.teal, c.pink, c.lime, c.indigo];
