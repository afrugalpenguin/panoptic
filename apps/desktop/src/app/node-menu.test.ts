import { describe, expect, it, vi } from "vitest";
import type { TreeNode } from "./api";
import { actionItems, actionLabel, copiedText, queryItems, type NodeActionHandlers } from "./node-menu";

type MenuItem = { label: string; run: () => void };

const labels = { selectTop: "Select top 1000", newQuery: "New query", refresh: "Refresh", copyName: "Copy name", copyPath: "Copy path" };

const node = (actions: string[], label = "dbo.Orders"): TreeNode => ({ id: "opaque-id", kind: "anything", label, icon: "table", hasChildren: true, actions });

function handlers() {
  return {
    openQuery: vi.fn((_: Parameters<NodeActionHandlers["openQuery"]>[0]) => {}),
    refresh: vi.fn(() => {}),
    invoke: vi.fn((_: string) => {}),
  };
}

const text = (items: (MenuItem | "separator")[]) => items.map((i) => (i === "separator" ? "---" : i.label));

describe("node context menu", () => {
  it("renders today's menu for a table from the sidecar's labels", () => {
    const n = node(["selectTop", "newQuery", "refresh", "copyName"]);
    const on = handlers();
    expect(text([...queryItems(n, labels, on), ...actionItems(n, labels, on)])).toEqual([
      "Select top 1000",
      "New query (Ctrl+N)",
      "---",
      "Refresh",
      "Copy name",
    ]);
  });

  it("has no query section or separator for a node without query actions", () => {
    const n = node(["refresh", "copyName"]);
    expect(queryItems(n, labels, handlers())).toEqual([]);
    expect(text(actionItems(n, labels, handlers()))).toEqual(["Refresh", "Copy name"]);
  });

  it("renders whatever actions a node carries: ones the UI does not know go to the sidecar", () => {
    const n = node(["copyName", "copyPath", "somethingNew"]);
    const on = handlers();
    const items = actionItems(n, labels, on);
    expect(text(items)).toEqual(["Copy name", "Copy path", "somethingNew"]);
    items[1].run();
    expect(on.invoke).toHaveBeenCalledWith("copyPath");
    items[0].run();
    expect(on.invoke).toHaveBeenLastCalledWith("copyName");
    expect(on.refresh).not.toHaveBeenCalled();
  });

  it("runs query actions and refresh in the UI", () => {
    const n = node(["selectTop", "newQuery", "refresh"]);
    const on = handlers();
    const [select, query] = queryItems(n, labels, on) as MenuItem[];
    select.run();
    query.run();
    actionItems(n, labels, on)[0].run();
    expect(on.openQuery.mock.calls).toEqual([["selectTop"], ["newQuery"]]);
    expect(on.refresh).toHaveBeenCalledTimes(1);
    expect(on.invoke).not.toHaveBeenCalled();
  });

  it("falls back to the action id before the labels arrive", () => {
    expect(actionLabel("copyName", {})).toBe("copyName");
    expect(actionLabel("newQuery", {})).toBe("newQuery (Ctrl+N)");
  });

  it("copies the sidecar's text, else the node's label (a Cosmos property leaf)", () => {
    expect(copiedText(node([], "dbo.a]b"), { text: "[dbo].[a]b]" })).toBe("[dbo].[a]b]");
    expect(copiedText(node([], "Partition key: /pk"), {})).toBe("Partition key: /pk");
    expect(copiedText(node([], "Tables"), { text: null })).toBe("Tables");
  });
});
