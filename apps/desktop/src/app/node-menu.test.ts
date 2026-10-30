import { describe, expect, it, vi } from "vitest";
import type { TreeNode } from "./api";
import { actionItems, actionLabel, queryItems, shortcutAction, type NodeActionHandlers } from "./node-menu";

type MenuItem = { label: string; run: () => void };

const labels = { selectTop: "Select top 1000", newQuery: "New query", refresh: "Refresh", copyPath: "Copy path" };

const node = (actions: string[], label = "dbo.Orders", meta?: Record<string, string>): TreeNode => ({
  id: "opaque-id",
  kind: "anything",
  label,
  icon: "table",
  hasChildren: true,
  actions,
  meta,
});

function handlers() {
  return {
    openQuery: vi.fn((_: Parameters<NodeActionHandlers["openQuery"]>[0]) => {}),
    refresh: vi.fn(() => {}),
    invoke: vi.fn((_: string) => {}),
    copy: vi.fn((_: string) => {}),
  };
}

const text = (items: (MenuItem | "separator")[]) => items.map((i) => (i === "separator" ? "---" : i.label));

describe("node context menu", () => {
  it("renders today's menu for a table from the sidecar's labels", () => {
    const n = node(["selectTop", "newQuery", "refresh"], "dbo.Orders", { copyText: "[dbo].[Orders]" });
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
    const n = node(["refresh"], "dbo.Orders", { copyText: "[dbo].[Orders]" });
    expect(queryItems(n, labels, handlers())).toEqual([]);
    expect(text(actionItems(n, labels, handlers()))).toEqual(["Refresh", "Copy name"]);
  });

  it("offers Copy name only when the node has copyText", () => {
    expect(text(actionItems(node(["refresh"], "Tables"), labels, handlers()))).toEqual(["Refresh"]);
    expect(text(actionItems(node([], "Throughput: 400 RU/s", { value: "400" }), labels, handlers()))).toEqual([]);
    expect(text(actionItems(node([], "Partition key: /pk", { copyText: "/pk" }), labels, handlers()))).toEqual(["Copy name"]);
  });

  it("copies copyText at once, not the label and not through the sidecar", () => {
    const on = handlers();
    const [copy] = actionItems(node([], "Partition key: /pk", { copyText: "/pk" }), labels, on);
    copy.run();
    expect(on.copy).toHaveBeenCalledWith("/pk");
    expect(on.invoke).not.toHaveBeenCalled();
  });

  it("renders whatever actions a node carries: ones the UI does not know go to the sidecar", () => {
    const n = node(["copyPath", "somethingNew"]);
    const on = handlers();
    const items = actionItems(n, labels, on);
    expect(text(items)).toEqual(["Copy path", "somethingNew"]);
    items[0].run();
    expect(on.invoke).toHaveBeenCalledWith("copyPath");
    items[1].run();
    expect(on.invoke).toHaveBeenLastCalledWith("somethingNew");
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

  it("offers no query entry point on a node without query actions (a backend that cannot query)", () => {
    const browseOnly = node(["refresh"], "Thing", { copyText: "Thing" });
    const on = handlers();
    const items = [...queryItems(browseOnly, labels, on), ...actionItems(browseOnly, labels, on)];
    expect(text(items)).not.toContain("New query (Ctrl+N)");
    expect(text(items)).not.toContain("Select top 1000");
    for (const item of items) if (item !== "separator") item.run();
    expect(on.openQuery).not.toHaveBeenCalled();
    expect(shortcutAction({ ctrlKey: true, metaKey: false, key: "n" }, browseOnly)).toBeUndefined();
  });

  it("Ctrl+N (or Cmd+N) starts newQuery only on a node that carries it", () => {
    const queryable = node(["newQuery", "refresh"]);
    expect(shortcutAction({ ctrlKey: true, metaKey: false, key: "n" }, queryable)).toBe("newQuery");
    expect(shortcutAction({ ctrlKey: false, metaKey: true, key: "N" }, queryable)).toBe("newQuery");
    expect(shortcutAction({ ctrlKey: false, metaKey: false, key: "n" }, queryable)).toBeUndefined();
    expect(shortcutAction({ ctrlKey: true, metaKey: false, key: "m" }, queryable)).toBeUndefined();
    expect(shortcutAction({ ctrlKey: true, metaKey: false, key: "n" }, undefined)).toBeUndefined();
  });

  it("falls back to the action id before the labels arrive", () => {
    expect(actionLabel("copyPath", {})).toBe("copyPath");
    expect(actionLabel("newQuery", {})).toBe("newQuery (Ctrl+N)");
  });
});
