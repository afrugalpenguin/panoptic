// Explorer filter bar and footer decisions (docs/explorer-ux.md, "Layout (top to bottom)"), kept out of the
// components so they can be tested without a DOM.
import type { ExplorerSummary } from "./tree-model";

/** Filter bar geometry: 6px padding each side, 6px between the filter and the engine control. */
const BAR_CHROME = 6 + 6 + 6;
/** The filter input keeps at least this much before the toggles give way to the menu. */
const FILTER_MIN = 80;
const TOGGLE = 22;
const TOGGLE_GAP = 2;

/**
 * Which engine control the filter bar shows at its current width: icon toggles while they fit at 22px each plus
 * 2px gaps, otherwise the "Engine n/total" button with its popover. The threshold depends on how many engines there
 * are, which a CSS container query cannot express, so the bar's own width (not the window's) is measured.
 */
export function engineControl(barWidth: number, engines: number): "none" | "toggles" | "menu" {
  if (engines < 2) return "none";
  const toggles = engines * TOGGLE + (engines - 1) * TOGGLE_GAP;
  return barWidth - BAR_CHROME - FILTER_MIN >= toggles ? "toggles" : "menu";
}

/** Toggles never show engine names in a bar this wide or narrower. */
const NAMES_FROM = 380;

/**
 * Whether the toggles also name their engines: over 380px, and only while the named toggles (namedWidth, measured
 * at their natural width; 0 until measured) still leave the filter its 80px. The names give way before the filter does.
 */
export function toggleNames(barWidth: number, namedWidth: number): boolean {
  return namedWidth > 0 && barWidth > NAMES_FROM && barWidth - BAR_CHROME - FILTER_MIN >= namedWidth;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The footer's summary: `long` normally, `short` (no words) when the footer is under 260px. */
export function summaryText({ environments, connections, matching }: ExplorerSummary): { long: string; short: string } {
  if (matching < connections) return { long: `${matching} of ${connections} match`, short: `${matching} / ${connections}` };
  if (environments === 0) return { long: plural(connections, "connection"), short: String(connections) };
  return { long: `${plural(environments, "environment")} · ${plural(connections, "connection")}`, short: `${environments} · ${connections}` };
}

/** The explorer is laid out down to 220px (docs/explorer-ux.md, "Principles"); the content beside it keeps 240px. */
const EXPLORER_MIN = 220;
const CONTENT_MIN = 240;
/** The splitter's arrow-key steps, small and with Shift. */
const SPLITTER_STEP = 10;
const SPLITTER_STEP_SHIFT = 50;

/** The explorer's width clamped to what the window allows. */
export function explorerWidth(width: number, windowWidth: number): number {
  return Math.max(EXPLORER_MIN, Math.min(windowWidth - CONTENT_MIN, width));
}

/** The explorer splitter's keys: Left and Right move it (further with Shift), Home and End go to the limits. */
export function splitterKey(e: { key: string; shiftKey: boolean }, width: number, windowWidth: number): number | undefined {
  const step = e.shiftKey ? SPLITTER_STEP_SHIFT : SPLITTER_STEP;
  switch (e.key) {
    case "ArrowLeft":
      return explorerWidth(width - step, windowWidth);
    case "ArrowRight":
      return explorerWidth(width + step, windowWidth);
    case "Home":
      return explorerWidth(EXPLORER_MIN, windowWidth);
    case "End":
      return explorerWidth(Infinity, windowWidth);
  }
  return undefined;
}
