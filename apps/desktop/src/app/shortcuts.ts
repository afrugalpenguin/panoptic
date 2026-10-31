// App-wide shortcuts shown on the landing (docs/landing.md, "Keys"). Ctrl+N with a tree node selected is the node's
// New query (node-menu.ts) and is checked first; this is what the keys do otherwise.

export type GlobalAction = "newQuery" | "newConnection" | "import" | "seek";

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
  }
  return undefined;
}
