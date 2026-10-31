import { describe, expect, it } from "vitest";
import { confirmText } from "./confirm";

describe("confirmText", () => {
  it("counts an environment's connections in the plural", () => {
    expect(confirmText("environment", "Prod", 3)).toEqual({
      title: "Delete environment",
      body: 'Delete "Prod" and its 3 connections?',
      action: "Delete",
    });
  });

  it("uses the singular for one connection", () => {
    expect(confirmText("environment", "Prod", 1).body).toBe('Delete "Prod" and its 1 connection?');
  });

  it("does not mention connections for an empty environment", () => {
    expect(confirmText("environment", "Prod", 0).body).toBe('Delete "Prod"? It has no connections.');
  });

  it("asks to remove a connection", () => {
    expect(confirmText("connection", "sql-01", 1)).toEqual({
      title: "Remove connection",
      body: 'Remove "sql-01" from Panoptic?',
      action: "Remove",
    });
  });
});
