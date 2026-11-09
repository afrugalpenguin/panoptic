// The explorer's right-click menu for each kind of row (docs/explorer-ux.md). Pure: the app supplies what the menu
// reads and the actions it runs, and keeps the dialogs, confirmations and undo itself.
import type { ConnectionConfig, EnvironmentConfig, TreeNode } from "./api";
import { actionItems, actionLabel, queryItems, type NodeActionHandlers, type TabAction } from "./node-menu";
import { errorText } from "./problems";
import type { Row } from "./tree-model";

/** Structurally ContextMenu.svelte's MenuItem; plain .ts cannot import types from a .svelte module under tsc. */
export type MenuEntry = { label: string; run: () => void; danger?: boolean; disabled?: boolean } | "separator";

/** A connection and its environment, which is undefined for one in no environment. */
export interface FoundConnection {
  env?: EnvironmentConfig;
  connection: ConnectionConfig;
}

export interface RowMenuContext {
  /** Action labels from the sidecar (node.actionLabels). */
  labels: Record<string, string>;
  /** Environment ids in the tree's order, for Move up and Move down. */
  envOrder: string[];
  /** Connections in no environment, in order, for a loose connection's Move up and Move down. */
  looseConnections: ConnectionConfig[];
  environment: (id: string) => EnvironmentConfig | undefined;
  connection: (id: string) => FoundConnection | undefined;
  /** Writes text to the clipboard, straight from the click. */
  copy: (text: string) => void;
  /** Reloads a node's children: Retry on a failed or pending load. */
  retry: (parentId: string) => void;
  openProblems: (parentId: string) => void;
  openQuery: (row: Row, action: TabAction) => void;
  refresh: (nodeId: string) => void;
  /** Rebuilds the catalogs of query tabs open on a refreshed connection or database. */
  refreshQueryTabs: (nodeId: string) => void;
  invoke: (node: TreeNode, actionId: string) => void;
  newConnection: (environmentId?: string) => void;
  moveEnvironment: (environmentId: string, by: -1 | 1) => void;
  /** Asks, deletes and offers Undo. */
  deleteEnvironment: (env: EnvironmentConfig) => void;
  editConnection: (found: FoundConnection) => void;
  /** Move to environment...: the picker dialog. */
  moveConnection: (found: FoundConnection) => void;
  /** Move up (-1) or Move down (1) within the connection's environment, or within none. */
  stepConnection: (connectionId: string, by: -1 | 1) => void;
  removeFromEnvironment: (connectionId: string) => void;
  /** Asks, removes and offers Undo. */
  removeConnection: (found: FoundConnection) => void;
}

export function rowMenu(row: Row, ctx: RowMenuContext): MenuEntry[] {
  const items: MenuEntry[] = [];
  if (row.type === "group" || row.type === "env-empty") {
    // The Ungrouped header and the empty hint are not config of their own: nothing to edit or retry.
  } else if (row.type === "error") {
    items.push({ label: "Copy error", run: () => ctx.copy(errorText(row.error)) });
    if (row.error.retryable) items.push({ label: "Retry", run: () => ctx.retry(row.parentId) });
    items.push({ label: "Open Problems", run: () => ctx.openProblems(row.parentId) });
  } else if (row.type !== "node") {
    items.push({ label: "Retry", run: () => ctx.retry(row.parentId) });
  } else {
    const n = row.node;
    const on: NodeActionHandlers = {
      openQuery: (action) => ctx.openQuery(row, action),
      refresh: () => {
        ctx.refresh(n.id);
        if (n.kind === "database") ctx.refreshQueryTabs(n.id);
      },
      invoke: (actionId) => ctx.invoke(n, actionId),
      copy: ctx.copy,
    };
    items.push(...queryItems(n, ctx.labels, on));
    // Environments and connections are Panoptic's own config, so their menus also move and delete them, and edit a
    // connection; an environment's properties edit in place in its detail pane (docs/environment-pane.md).
    if (n.kind === "environment") items.push(...environmentItems(n, ctx));
    else if (n.kind === "connection") {
      const found = ctx.connection(n.meta!.connectionId);
      items.push({ label: "Edit connection...", run: () => found && ctx.editConnection(found) });
      const refresh = () => {
        ctx.refresh(n.id);
        ctx.refreshQueryTabs(n.id);
      };
      items.push(...actionItems(n, ctx.labels, { ...on, refresh }));
      items.push({ label: "Move to environment...", run: () => found && ctx.moveConnection(found) });
      const group = found ? (found.env?.connections ?? ctx.looseConnections) : [];
      const position = found ? group.findIndex((c) => c.id === found.connection.id) : -1;
      items.push({ label: "Move up", disabled: position <= 0, run: () => found && ctx.stepConnection(found.connection.id, -1) });
      items.push({ label: "Move down", disabled: position < 0 || position >= group.length - 1, run: () => found && ctx.stepConnection(found.connection.id, 1) });
      if (found?.env) items.push({ label: "Remove from environment", run: () => ctx.removeFromEnvironment(found.connection.id) });
      items.push("separator");
      items.push({ label: "Remove connection", danger: true, run: () => found && ctx.removeConnection(found) });
    } else items.push(...actionItems(n, ctx.labels, on));
  }
  return items;
}

function environmentItems(n: TreeNode, ctx: RowMenuContext): MenuEntry[] {
  const env = ctx.environment(n.meta!.environmentId);
  const position = env ? ctx.envOrder.indexOf(env.id) : -1;
  return [
    { label: "New connection...", run: () => ctx.newConnection(env?.id) },
    { label: "Move up", disabled: position <= 0, run: () => env && ctx.moveEnvironment(env.id, -1) },
    { label: "Move down", disabled: position < 0 || position >= ctx.envOrder.length - 1, run: () => env && ctx.moveEnvironment(env.id, 1) },
    { label: actionLabel("refresh", ctx.labels), run: () => ctx.refresh(n.id) },
    "separator",
    { label: "Delete environment", danger: true, run: () => env && ctx.deleteEnvironment(env) },
  ];
}
