// Connection kinds as the sidecar describes them (backends.describe, #203): the UI knows no engine of its own. App
// registers the descriptions once the sidecar answers, before the tree first loads.
import type { KindBadge, KindDescription } from "./api";

export type { KindBadge };

const registry = new Map<string, KindDescription>();

/** Replaces the known kinds with the sidecar's descriptions. */
export function registerKinds(kinds: KindDescription[]): void {
  registry.clear();
  for (const k of kinds) registry.set(k.kind, k);
}

export function kindDescription(kind: string): KindDescription | undefined {
  return registry.get(kind);
}

/** The badge for a kind (docs/explorer-ux.md, "Connection row"); an unknown kind gets its initial on neutral grey. */
export function kindBadge(kind: string): KindBadge {
  return registry.get(kind)?.badge ?? { letters: kind.charAt(0).toUpperCase() || "?", color: "#6a6a6a", name: kind };
}
