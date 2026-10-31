// Wording for ConfirmDialog (docs/explorer-ux.md, "Destructive actions").

export interface ConfirmText {
  title: string;
  /** One line. */
  body: string;
  /** The destructive button's label. */
  action: string;
}

/** count: the environment's connections; ignored for a connection. */
export function confirmText(kind: "environment" | "connection", name: string, count: number): ConfirmText {
  if (kind === "connection") return { title: "Remove connection", body: `Remove "${name}" from Panoptic?`, action: "Remove" };
  const body =
    count === 0 ? `Delete "${name}"? It has no connections.` : `Delete "${name}" and its ${count} connection${count === 1 ? "" : "s"}?`;
  return { title: "Delete environment", body, action: "Delete" };
}

/**
 * Read-only is an environment's setting, so moving a connection out of a read-only environment (into a writable one
 * or none) quietly lifts the guard. The question to ask first, or undefined when the move needs no asking.
 */
export function readOnlyMoveText(
  connection: string,
  from: { name: string; readOnly: boolean } | undefined,
  to: { name: string; readOnly: boolean } | undefined,
): ConfirmText | undefined {
  if (!from?.readOnly || to?.readOnly) return undefined;
  const body = to
    ? `Move "${connection}" from ${from.name} to ${to.name}? ${from.name} is read-only and ${to.name} is not, so its queries will no longer be rolled back.`
    : `Move "${connection}" out of ${from.name}? ${from.name} is read-only, so its queries will no longer be rolled back.`;
  return { title: "Leave read-only", body, action: "Move" };
}
