// Kind badges for connection rows (docs/explorer-ux.md, "Connection row"), keyed by backend kind.

export interface KindBadge {
  /** One or two letters shown in the 14px square. */
  letters: string;
  color: string;
  /** Name shown on the kind filter chip. */
  name: string;
}

const registry = new Map<string, KindBadge>([
  ["sql", { letters: "S", color: "#2d5aa0", name: "SQL" }],
  ["cosmos", { letters: "C", color: "#1f7a74", name: "Cosmos" }],
  ["synapse", { letters: "Sy", color: "#7b4fb5", name: "Synapse" }],
  ["postgres", { letters: "PG", color: "#5f7a2e", name: "Postgres" }],
]);

/** A new backend registers its badge alongside its connection kind. */
export function registerKindBadge(kind: string, badge: KindBadge): void {
  registry.set(kind, badge);
}

/** The badge for a kind; an unregistered kind gets its initial on neutral grey rather than nothing. */
export function kindBadge(kind: string): KindBadge {
  return registry.get(kind) ?? { letters: kind.charAt(0).toUpperCase() || "?", color: "#6a6a6a", name: kind };
}
