// WCAG AA contrast for the role tokens that carry the logo's hues (app.css). The logo colours themselves
// (--brand-primary, --brand-secondary) are too light for text or indicators on the light theme's white panes.
// A browser test only because the unit project's CSS handling empties a ?raw import of a .css file.
import { mount, unmount } from "svelte";
import { describe, expect, it } from "vitest";
import "./app.css";
import css from "./app.css?raw";
import { ENV_COLORS } from "./env-palette";
import ReadOnlyPill from "./rows/ReadOnlyPill.svelte";

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
/** A computed colour, rgb(r, g, b) or color(srgb r g b) as Chromium serialises a color-mix, as hex. */
function hexOf(computed: string): string {
  const n = computed.match(/[\d.]+/g)!.map(Number);
  const [r, g, b] = computed.startsWith("color(") ? n.slice(0, 3).map((v) => v * 255) : n.slice(0, 3);
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

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

  it("placeholders (--text-muted) are AA text on an input and on a pane (#239)", () => {
    expect(contrast(t["--text-muted"], t["--bg"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["--text-muted"], t["--bg-pane"])).toBeGreaterThanOrEqual(4.5);
  });

  // Icon.svelte: the letter on a 16% tint of its colour, on a row or hovered row; the folder outline bare.
  for (const kind of ["database", "table", "view", "proc", "function", "key", "policy", "neutral"])
    it(`the ${kind} glyph is a 3:1 indicator on its tint and bare (#239)`, () => {
      const g = t[`--glyph-${kind}`];
      expect(g).toBeDefined();
      for (const back of [t["--bg-pane"], t["--bg-hover"]]) {
        expect(contrast(g, mix(g, back, 0.16))).toBeGreaterThanOrEqual(3);
        expect(contrast(g, back)).toBeGreaterThanOrEqual(3);
      }
    });

  // The READ ONLY pill in each environment colour, as the browser mixes it, on the env header's washes (Tree.svelte:
  // 14, 22 and 30%) and on a Seek row, plain or hovered.
  for (const [name, env] of Object.entries(ENV_COLORS))
    it(`the READ ONLY pill is AA text in ${name} (#239)`, () => {
      const host = document.createElement("div");
      host.style.setProperty("--text", t["--text"]);
      host.style.setProperty("--env", env);
      document.body.append(host);
      const app = mount(ReadOnlyPill, { target: host });
      try {
        const fg = hexOf(getComputedStyle(host.querySelector(".read-only")!).color);
        for (const back of [mix(env, t["--bg-pane"], 0.14), mix(env, t["--bg-pane"], 0.22), mix(env, t["--bg-pane"], 0.3), t["--bg-pane"], t["--bg-hover"]])
          expect(contrast(fg, back), `${fg} on ${back}`).toBeGreaterThanOrEqual(4.5);
      } finally {
        unmount(app);
        host.remove();
      }
    });
});

it("inputs draw their placeholder in --text-muted, not the engine's grey (#239)", () => {
  const input = document.createElement("input");
  input.placeholder = "Filter";
  document.body.append(input);
  try {
    expect(hexOf(getComputedStyle(input, "::placeholder").color)).toBe(light["--text-muted"]);
  } finally {
    input.remove();
  }
});
