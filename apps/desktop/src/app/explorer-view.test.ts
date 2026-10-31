import { describe, expect, it } from "vitest";
import { engineControl, summaryText } from "./explorer-view";

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
