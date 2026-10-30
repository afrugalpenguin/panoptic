import type { TreeNode } from "./api";

/** Structurally ContextMenu.svelte's MenuItem; plain .ts cannot import types from a .svelte module under tsc. */
interface MenuItem {
  label: string;
  run: () => void;
}

/** The actions the UI performs itself, opening a query tab. refresh reloads the tree; every other id is node.invoke. */
const TAB_ACTIONS = ["selectTop", "newQuery"] as const;
export type TabAction = (typeof TAB_ACTIONS)[number];

/** Keyboard shortcuts are the UI's, so their hints are added here rather than sent by the sidecar. */
const SHORTCUTS: Record<string, string> = { newQuery: "Ctrl+N" };

export interface NodeActionHandlers {
  openQuery: (action: TabAction) => void;
  refresh: () => void;
  /** Runs the action in the sidecar (node.invoke); the app copies the text it returns. */
  invoke: (actionId: string) => void;
}

/**
 * The query action a keyboard shortcut starts on the selected node (Ctrl+N: newQuery), or undefined when the node does
 * not carry that action: a node whose backend cannot query never does.
 */
export function shortcutAction(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "key">, node: TreeNode | undefined): TabAction | undefined {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "n") return undefined;
  return node?.actions.includes("newQuery") ? "newQuery" : undefined;
}

/** What an invoked action puts on the clipboard: the sidecar's text, else the node's label (copyName on most nodes). */
export function copiedText(node: TreeNode, result: { text?: string | null }): string {
  return result.text ?? node.label;
}

/** The menu label for an action id: the sidecar's (node.actionLabels), else the id itself. */
export function actionLabel(id: string, labels: Record<string, string>): string {
  const label = labels[id] ?? id;
  return SHORTCUTS[id] ? `${label} (${SHORTCUTS[id]})` : label;
}

/** The node's query actions, then a separator, or nothing when it has none. */
export function queryItems(node: TreeNode, labels: Record<string, string>, on: NodeActionHandlers): (MenuItem | "separator")[] {
  const items: (MenuItem | "separator")[] = TAB_ACTIONS.filter((a) => node.actions.includes(a)).map((a) => ({
    label: actionLabel(a, labels),
    run: () => on.openQuery(a),
  }));
  return items.length ? [...items, "separator"] : [];
}

/** The node's other actions in the order the backend gave them: refresh reloads, anything else goes to the sidecar. */
export function actionItems(node: TreeNode, labels: Record<string, string>, on: NodeActionHandlers): MenuItem[] {
  return node.actions
    .filter((a) => !(TAB_ACTIONS as readonly string[]).includes(a))
    .map((a) => ({ label: actionLabel(a, labels), run: a === "refresh" ? on.refresh : () => on.invoke(a) }));
}
