// The environment detail pane's pure parts (docs/environment-pane.md): counts, wording and colour choices it shows.
import type { EnvironmentConfig } from "./api";
import type { KindBadge } from "./kinds";
import type { EnvConnection } from "./tree-model";

/** What the environment detail pane reads and runs; App supplies it for the selected environment. */
export interface EnvironmentPaneProps {
  env: EnvironmentConfig;
  /** 1-based place in the tree's order, and how many environments there are. */
  position: number;
  total: number;
  /** Builds the connection list from the store; the pane times the call for its footer and card header. */
  connections: () => EnvConnection[];
  /** Writes the changed environment through the environment store; rejects when the write fails. */
  onSave: (env: EnvironmentConfig) => Promise<void>;
  /** Move up (-1) or down (1), as the tree's Move up and Move down. */
  onMove: (by: -1 | 1) => void;
  onNewConnection: () => void;
  onRefresh: () => void;
  /** Asks, deletes and offers Undo, as the tree's Delete environment. */
  onDelete: () => void;
  /** Selects the connection in the tree, as clicking it there. */
  onSelectConnection: (id: string) => void;
  /** Selects and expands the connection in the tree. */
  onExpandConnection: (id: string) => void;
  /** The tree's context menu for the connection, at x, y in the viewport. */
  onConnectionMenu: (id: string, x: number, y: number) => void;
}

/** One engine present in the environment, for the Connections card's pills: the tree's badge and how many. */
export interface EngineCount {
  kind: string;
  badge: KindBadge;
  count: number;
}

/** Engines in the order they first appear in the list. */
export function engineCounts(list: EnvConnection[]): EngineCount[] {
  const counts = new Map<string, EngineCount>();
  for (const c of list) {
    const found = counts.get(c.kind);
    if (found) found.count++;
    else counts.set(c.kind, { kind: c.kind, badge: c.badge, count: 1 });
  }
  return [...counts.values()];
}

/** "1 connection", "9 connections". */
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A measured time in ms: one decimal under 10 ms, whole above; below what one decimal can show, "<0.1". */
export function formatMs(ms: number): string {
  if (ms < 0.05) return "<0.1";
  return ms < 10 ? ms.toFixed(1) : String(Math.round(ms));
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A colour the hex field accepts: #rrggbb, with or without the #, lower-cased. Undefined when it is not one. */
export function parseHex(text: string): string | undefined {
  const t = text.trim();
  const hex = t.startsWith("#") ? t : `#${t}`;
  return HEX.test(hex) ? hex.toLowerCase() : undefined;
}

const channel = (v: number) => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of #rrggbb. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** The identity tile's letter colour: black or white, whichever contrasts more with the environment colour. */
export function textOn(color: string): "#000000" | "#ffffff" {
  const hex = parseHex(color);
  if (!hex) return "#ffffff";
  const l = luminance(hex);
  // Contrast with black is (l + 0.05) / 0.05, with white 1.05 / (l + 0.05).
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? "#000000" : "#ffffff";
}
