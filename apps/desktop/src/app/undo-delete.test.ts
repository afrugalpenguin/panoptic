import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "./api";
import { UNDO_MS, UndoDelete } from "./undo-delete";

const prior: AppConfig = {
  environments: [{ id: "prod", name: "Prod", color: "#e03131", readOnly: true, connections: [] }],
  connections: [],
};

function setup() {
  const restored: AppConfig[] = [];
  const purged: string[][] = [];
  const shown: (string | undefined)[] = [];
  const undo = new UndoDelete({
    restore: async (c) => void restored.push(c),
    purge: async (ids) => void purged.push(ids),
    changed: (text) => shown.push(text),
  });
  return { undo, restored, purged, shown };
}

describe("UndoDelete", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("offers undo for ten seconds, then removes the deleted connections' secrets", async () => {
    const { undo, purged, shown } = setup();
    undo.offer("Deleted environment Prod", prior, ["c1", "c2"]);
    expect(undo.text()).toBe("Deleted environment Prod");
    expect(shown).toEqual(["Deleted environment Prod"]);

    await vi.advanceTimersByTimeAsync(UNDO_MS - 1);
    expect(purged).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(purged).toEqual([["c1", "c2"]]);
    expect(undo.text()).toBeUndefined();
    expect(shown.at(-1)).toBeUndefined();
  });

  it("undo writes the prior config back and keeps the secrets", async () => {
    const { undo, restored, purged } = setup();
    undo.offer("Deleted environment Prod", prior, ["c1"]);
    await undo.undo();
    await vi.advanceTimersByTimeAsync(UNDO_MS);

    expect(restored).toEqual([prior]);
    expect(purged).toEqual([]);
    expect(undo.text()).toBeUndefined();
  });

  it("settle removes the secrets at once and drops the undo", async () => {
    const { undo, restored, purged } = setup();
    undo.offer("Removed connection sql-01", prior, ["c1"]);
    await undo.settle();
    await undo.undo();
    await vi.advanceTimersByTimeAsync(UNDO_MS);

    expect(purged).toEqual([["c1"]]);
    expect(restored).toEqual([]);
  });

  it("a second delete settles the first", async () => {
    const { undo, purged } = setup();
    undo.offer("Removed connection a", prior, ["a"]);
    undo.offer("Removed connection b", prior, ["b"]);
    expect(purged).toEqual([["a"]]);
    expect(undo.text()).toBe("Removed connection b");

    await vi.advanceTimersByTimeAsync(UNDO_MS);
    expect(purged).toEqual([["a"], ["b"]]);
  });

  it("settle and undo with nothing pending do nothing", async () => {
    const { undo, restored, purged } = setup();
    await undo.settle();
    await undo.undo();
    expect(restored).toEqual([]);
    expect(purged).toEqual([]);
  });
});
