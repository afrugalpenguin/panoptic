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
