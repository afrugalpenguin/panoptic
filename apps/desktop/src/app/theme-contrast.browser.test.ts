// WCAG AA contrast for the role tokens that carry the logo's hues (app.css). The logo colours themselves
// (--brand-primary, --brand-secondary) are too light for text or indicators on the light theme's white panes.
// A browser test only because the unit project's CSS handling empties a ?raw import of a .css file.
import { describe, expect, it } from "vitest";
import css from "./app.css?raw";

/** The custom properties set to plain hex in a block of app.css. */
function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}
const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
const light = tokens(css.slice(0, darkStart));
const dark = { ...light, ...tokens(css.slice(darkStart)) };

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const channel = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** color-mix(in srgb, a p, b): the tag backgrounds in WhatsNewView.svelte. */
const mix = (a: string, b: string, p: number) =>
  "#" + rgb(a).map((v, i) => Math.round(v * p + rgb(b)[i] * (1 - p)).toString(16).padStart(2, "0")).join("");

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme", (_, t) => {
  for (const name of ["--text-brand-secondary", "--text-brand-primary"]) {
    it(`${name} is AA text on panes and on its own tag tint`, () => {
      expect(t[name], name).toBeDefined();
      expect(contrast(t[name], t["--bg-pane"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t[name], t["--bg"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t[name], mix(t[name], t["--bg-pane"], 0.15))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("--focus-ring is a 3:1 indicator on panes and the page", () => {
    expect(t["--focus-ring"]).toBeDefined();
    expect(contrast(t["--focus-ring"], t["--bg-pane"])).toBeGreaterThanOrEqual(3);
    expect(contrast(t["--focus-ring"], t["--bg"])).toBeGreaterThanOrEqual(3);
  });

  it("text on a filled accent button (Run, Save, Update) is AA (#234)", () => {
    expect(t["--accent-fill"], "--accent-fill").toBeDefined();
    expect(t["--on-accent"], "--on-accent").toBeDefined();
    expect(contrast(t["--on-accent"], t["--accent-fill"])).toBeGreaterThanOrEqual(4.5);
  });

  it("the tree's dimmed name parts are AA text on a row, hovered or not, and on a selected row (#233)", () => {
    expect(contrast(t["--tree-dim"], t["--bg-pane"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--tree-dim"], t["--bg-hover"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--tree-dim-selected"], t["--bg-selected"])).toBeGreaterThanOrEqual(4.5);
  });
});
