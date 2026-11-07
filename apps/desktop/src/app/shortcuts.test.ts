import { describe, expect, it } from "vitest";
import type { TreeNode } from "./api";
import { globalShortcut, keyCommand } from "./shortcuts";

const k = (key: string, mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}, inEditor = false) =>
  globalShortcut({ key, ctrlKey: !!mods.ctrlKey, metaKey: false, shiftKey: !!mods.shiftKey }, inEditor);

describe("globalShortcut", () => {
  it("maps Ctrl+N, Ctrl+Shift+N (New connection), Ctrl+I and Ctrl+P", () => {
    expect(k("n", { ctrlKey: true })).toBe("newQuery");
    expect(k("N", { ctrlKey: true, shiftKey: true })).toBe("newConnection");
    expect(k("i", { ctrlKey: true })).toBe("import");
    expect(k("p", { ctrlKey: true })).toBe("seek");
  });

  it("leaves Ctrl+I to the editor, and plain keys alone", () => {
    expect(k("i", { ctrlKey: true }, true)).toBeUndefined();
    expect(k("n")).toBeUndefined();
  });
});

describe("keyCommand", () => {
  const table: TreeNode = { id: "t", kind: "table", label: "t", icon: "table", hasChildren: false, actions: ["newQuery"] };
  const folder: TreeNode = { ...table, id: "f", kind: "folder", actions: [] };
  const ctrl = (key: string, shiftKey = false) => ({ key, ctrlKey: true, metaKey: false, shiftKey, altKey: false });
  const idle = { seeking: false, dialogOpen: false, inEditor: false, selectedNode: undefined as TreeNode | undefined };

  it("opens the selected node's New query on Ctrl+N, else an unconnected one", () => {
    expect(keyCommand(ctrl("n"), { ...idle, selectedNode: table })).toEqual({ kind: "nodeQuery", action: "newQuery" });
    expect(keyCommand(ctrl("n"), { ...idle, selectedNode: folder })).toEqual({ kind: "global", action: "newQuery" });
    expect(keyCommand(ctrl("n"), idle)).toEqual({ kind: "global", action: "newQuery" });
  });

  it("leaves every key to the Seek overlay while it is open", () => {
    expect(keyCommand(ctrl("n"), { ...idle, seeking: true, selectedNode: table })).toBeUndefined();
    expect(keyCommand(ctrl("p"), { ...idle, seeking: true })).toBeUndefined();
  });

  it("a node's New query still works with a dialog open, but global shortcuts wait for it to close", () => {
    expect(keyCommand(ctrl("n"), { ...idle, dialogOpen: true, selectedNode: table })).toEqual({ kind: "nodeQuery", action: "newQuery" });
    expect(keyCommand(ctrl("p"), { ...idle, dialogOpen: true })).toBeUndefined();
  });

  it("maps the global shortcuts, leaving Ctrl+I to the editor", () => {
    expect(keyCommand(ctrl("n", true), idle)).toEqual({ kind: "global", action: "newConnection" });
    expect(keyCommand(ctrl("p"), idle)).toEqual({ kind: "global", action: "seek" });
    expect(keyCommand(ctrl("i"), idle)).toEqual({ kind: "global", action: "import" });
    expect(keyCommand(ctrl("i"), { ...idle, inEditor: true })).toBeUndefined();
  });
});
