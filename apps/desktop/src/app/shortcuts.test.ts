import { describe, expect, it } from "vitest";
import { globalShortcut } from "./shortcuts";

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
