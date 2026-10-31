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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The footer's summary: `long` normally, `short` (no words) when the footer is under 260px. */
export function summaryText({ environments, connections, matching }: ExplorerSummary): { long: string; short: string } {
  if (matching < connections) return { long: `${matching} of ${connections} match`, short: `${matching} / ${connections}` };
  if (environments === 0) return { long: plural(connections, "connection"), short: String(connections) };
  return { long: `${plural(environments, "environment")} · ${plural(connections, "connection")}`, short: `${environments} · ${connections}` };
}
