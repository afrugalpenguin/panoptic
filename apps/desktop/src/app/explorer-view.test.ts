import { describe, expect, it } from "vitest";
import { engineControl, explorerWidth, splitterKey, summaryText, toggleNames } from "./explorer-view";

describe("summaryText", () => {
  it("counts environments and connections when nothing is hidden", () => {
    expect(summaryText({ environments: 3, connections: 20, matching: 20 })).toEqual({ long: "3 environments · 20 connections", short: "3 · 20" });
  });

  it("uses the singular for one", () => {
    expect(summaryText({ environments: 1, connections: 1, matching: 1 }).long).toBe("1 environment · 1 connection");
  });

  it("leaves environments out when there are none", () => {
    expect(summaryText({ environments: 0, connections: 4, matching: 4 })).toEqual({ long: "4 connections", short: "4" });
  });

  it("says how many match when a filter hides anything", () => {
    expect(summaryText({ environments: 3, connections: 20, matching: 9 })).toEqual({ long: "9 of 20 match", short: "9 / 20" });
    expect(summaryText({ environments: 3, connections: 20, matching: 0 })).toEqual({ long: "0 of 20 match", short: "0 / 20" });
  });
});

describe("engineControl", () => {
  it("is not shown for one engine or none", () => {
    expect(engineControl(400, 0)).toBe("none");
    expect(engineControl(400, 1)).toBe("none");
  });

  it("uses toggles while they fit at 22px each with 2px gaps beside the filter", () => {
    expect(engineControl(220, 4)).toBe("toggles");
    expect(engineControl(220, 5)).toBe("toggles");
    expect(engineControl(220, 6)).toBe("menu");
    expect(engineControl(250, 6)).toBe("toggles");
  });

  it("uses the menu for 8 engines at 250px", () => {
    expect(engineControl(250, 8)).toBe("menu");
    expect(engineControl(420, 8)).toBe("toggles");
  });
});

describe("toggleNames", () => {
  it("names the toggles only over 380px", () => {
    expect(toggleNames(380, 100)).toBe(false);
    expect(toggleNames(381, 100)).toBe(true);
  });

  it("drops the names when they would leave the filter under 80px", () => {
    // 6px padding each side and a 6px gap: 400 - 18 - 302 = 80.
    expect(toggleNames(400, 302)).toBe(true);
    expect(toggleNames(400, 303)).toBe(false);
  });

  it("waits until the toggles have been measured", () => {
    expect(toggleNames(1000, 0)).toBe(false);
  });
});

describe("explorer splitter", () => {
  const key = (k: string, shiftKey = false) => ({ key: k, shiftKey });

  it("keeps the explorer at 220px or wider and leaves the content 240px", () => {
    expect(explorerWidth(100, 1200)).toBe(220);
    expect(explorerWidth(1100, 1200)).toBe(960);
    expect(explorerWidth(400, 1200)).toBe(400);
  });

  it("moves 10px per arrow, 50px with Shift", () => {
    expect(splitterKey(key("ArrowRight"), 360, 1200)).toBe(370);
    expect(splitterKey(key("ArrowLeft"), 360, 1200)).toBe(350);
    expect(splitterKey(key("ArrowRight", true), 360, 1200)).toBe(410);
    expect(splitterKey(key("ArrowLeft", true), 360, 1200)).toBe(310);
  });

  it("goes to the narrowest and widest with Home and End", () => {
    expect(splitterKey(key("Home"), 360, 1200)).toBe(220);
    expect(splitterKey(key("End"), 360, 1200)).toBe(960);
  });

  it("stops at the limits", () => {
    expect(splitterKey(key("ArrowLeft"), 225, 1200)).toBe(220);
    expect(splitterKey(key("ArrowRight"), 955, 1200)).toBe(960);
  });

  it("leaves other keys alone", () => {
    expect(splitterKey(key("Enter"), 360, 1200)).toBeUndefined();
    expect(splitterKey(key("ArrowUp"), 360, 1200)).toBeUndefined();
  });
});
