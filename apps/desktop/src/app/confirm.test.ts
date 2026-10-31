import { describe, expect, it } from "vitest";
import { confirmText, readOnlyMoveText } from "./confirm";

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

describe("readOnlyMoveText", () => {
  const prod = { name: "Prod", readOnly: true };
  const uat = { name: "UAT", readOnly: false };
  const dr = { name: "DR", readOnly: true };

  it("asks before a move takes a connection out of a read-only environment", () => {
    expect(readOnlyMoveText("uk-sql", prod, uat)).toEqual({
      title: "Leave read-only",
      body: 'Move "uk-sql" from Prod to UAT? Prod is read-only and UAT is not, so its queries will no longer be rolled back.',
      action: "Move",
    });
    expect(readOnlyMoveText("uk-sql", prod, undefined)?.body).toBe(
      'Move "uk-sql" out of Prod? Prod is read-only, so its queries will no longer be rolled back.',
    );
  });

  it("asks nothing when the connection stays read-only or was not read-only", () => {
    expect(readOnlyMoveText("uk-sql", prod, dr)).toBeUndefined();
    expect(readOnlyMoveText("uk-sql", uat, undefined)).toBeUndefined();
    expect(readOnlyMoveText("uk-sql", undefined, uat)).toBeUndefined();
  });
});
