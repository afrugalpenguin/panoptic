import { describe, expect, it } from "vitest";
import { startupText, startupTimings } from "./startup";

const ping = { startupMs: 84, version: "0.2.40", mode: "jit", pid: 1 };

describe("startupTimings", () => {
  it("measures first paint and engine ready from the shell's start", () => {
    const t = startupTimings({ mainStartEpochMs: 1000, benchMode: null }, ping, { sidecarReadyEpochMs: 1324.6, firstPaintEpochMs: 1361.4 });

    expect(t).toEqual({
      kind: "startup",
      mainStartEpochMs: 1000,
      firstPaintEpochMs: 1361.4,
      sidecarReadyEpochMs: 1324.6,
      mainToFirstPaintMs: 361,
      mainToSidecarReadyMs: 325,
      treeRenderedEpochMs: undefined,
      sidecarStartupMs: 84,
      sidecarMode: "jit",
    });
  });

  it("carries the tree-rendered time when the startup bench measured it", () => {
    const t = startupTimings({ mainStartEpochMs: 1000, benchMode: "startup" }, ping, { sidecarReadyEpochMs: 1324, firstPaintEpochMs: 1361, treeRenderedEpochMs: 1355 });
    expect(t.treeRenderedEpochMs).toBe(1355);
  });
});

describe("startupText", () => {
  it("is the status bar's start-up line", () => {
    const t = startupTimings({ mainStartEpochMs: 1000, benchMode: null }, ping, { sidecarReadyEpochMs: 1324.6, firstPaintEpochMs: 1361.4 });
    expect(startupText(t, ping)).toBe("First paint 361 ms, engine ready 325 ms (engine 84 ms, jit, v0.2.40)");
  });
});
