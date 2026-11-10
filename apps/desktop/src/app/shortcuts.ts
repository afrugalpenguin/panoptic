// App-wide shortcuts shown on the landing (docs/landing.md, "Keys"). Ctrl+N with a tree node selected is the node's
// New query (node-menu.ts) and is checked first; this is what the keys do otherwise.
import type { TreeNode } from "./api";
import { shortcutAction, type TabAction } from "./node-menu";

export type GlobalAction = "newQuery" | "newConnection" | "import" | "seek" | "settings";

export function globalShortcut(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, inEditor: boolean): GlobalAction | undefined {
  if (!(e.ctrlKey || e.metaKey)) return undefined;
  switch (e.key.toLowerCase()) {
    case "n":
      return e.shiftKey ? "newConnection" : "newQuery";
    case "i":
      // Monaco uses Ctrl+I to open suggestions.
      return inEditor ? undefined : "import";
    case "p":
      return "seek";
    case ",":
      return "settings";
  }
  return undefined;
}

/** What a key press does in the app: the selected node's query action, or an app-wide action. */
export type KeyCommand = { kind: "nodeQuery"; action: TabAction } | { kind: "global"; action: GlobalAction };

export interface KeyState {
  /** The Seek overlay is modal: its box keeps every key. */
  seeking: boolean;
  /** A dialog, confirm or context menu is open: it keeps every key, so nothing opens behind it (#212). */
  dialogOpen: boolean;
  /** Focus is in a Monaco editor, which has its own Ctrl+I. */
  inEditor: boolean;
  /** The tree's selected node, when the selection is a node. */
  selectedNode: TreeNode | undefined;
}

/** The command for a window keydown, or undefined to leave the key alone. */
export function keyCommand(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
  state: KeyState,
): KeyCommand | undefined {
  if (state.seeking || state.dialogOpen) return undefined;
  const action = shortcutAction(e, state.selectedNode);
  if (action) return { kind: "nodeQuery", action };
  const global = globalShortcut(e, state.inEditor);
  return global ? { kind: "global", action: global } : undefined;
}

/**
 * Delete on a connection selected in the tree, with focus in the tree and not in its filter: Remove connection, which
 * asks first (docs/connection-pane.md, "Keyboard"). The connection pane handles Delete within itself.
 */
export function removesConnection(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
  state: { seeking: boolean; dialogOpen: boolean; inTree: boolean; selectedNode: TreeNode | undefined },
): boolean {
  if (e.key !== "Delete" || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return false;
  return !state.seeking && !state.dialogOpen && state.inTree && state.selectedNode?.kind === "connection";
}
