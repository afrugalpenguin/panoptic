// The environment picker in New connection, Import and Move to environment... (docs/explorer-ux.md, "Grouping").
// Environments are optional grouping, so None comes first and is the default.

import type { EnvironmentConfig } from "./api";
import { envStyleFor } from "./import-plan";

/** Select values that are not environment ids. Environment ids are UUIDs or import names, never these. */
export const NO_ENV = "#none";
export const NEW_ENV = "#new";

export interface PickerOption {
  value: string;
  label: string;
}

/** None, the environments in config order, then New environment... */
export function pickerOptions(envs: EnvironmentConfig[], { none = true, exclude }: { none?: boolean; exclude?: string } = {}): PickerOption[] {
  return [
    ...(none ? [{ value: NO_ENV, label: "None" }] : []),
    ...envs.filter((e) => e.id !== exclude).map((e) => ({ value: e.id, label: e.name })),
    { value: NEW_ENV, label: "New environment..." },
  ];
}

/** What config.saveConnection takes for a picked value: null for None. */
export const toEnvironmentId = (value: string): string | null => (value === NO_ENV ? null : value);

/**
 * The environment New environment... stands for: an existing one with that name (case-insensitive), or a new one
 * styled the way import styles them, with no connections.
 */
export function newEnvironment(
  name: string,
  existing: EnvironmentConfig[],
  id: string = crypto.randomUUID(),
): { environment: EnvironmentConfig; created: boolean } | { error: string } {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Name the environment." };
  const same = existing.find((e) => e.name.toLowerCase() === trimmed.toLowerCase());
  if (same) return { environment: same, created: false };
  return { environment: { id, name: trimmed, ...envStyleFor(trimmed, existing.length), connections: [] }, created: true };
}

/**
 * Read-only is an environment's setting, so moving a connection out of a read-only environment (into a writable one
 * or none) quietly lifts the guard. Returns the question to ask first, or undefined when the move needs no asking.
 */
export function readOnlyMoveWarning(connection: string, from: EnvironmentConfig | undefined, to: EnvironmentConfig | undefined): string | undefined {
  if (!from?.readOnly || to?.readOnly) return undefined;
  return to
    ? `Move "${connection}" from ${from.name} to ${to.name}? ${from.name} is read-only and ${to.name} is not, so its queries will no longer be rolled back.`
    : `Move "${connection}" out of ${from.name}? ${from.name} is read-only, so its queries will no longer be rolled back.`;
}
