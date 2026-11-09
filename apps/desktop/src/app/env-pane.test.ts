import { describe, expect, it } from "vitest";
import { engineCounts, formatMs, parseHex, plural, probeState, reachability, textOn } from "./env-pane";
import type { EnvConnection } from "./tree-model";

const conn = (id: string, kind: string): EnvConnection => ({
  id,
  connectionId: id,
  kind,
  badge: { letters: kind.charAt(0).toUpperCase(), color: "#000000", name: kind.toUpperCase() },
  label: { prefix: "", core: id, suffix: "" },
});

describe("environment pane helpers", () => {
  it("counts engines in the order they first appear", () => {
    const counts = engineCounts([conn("a", "sql"), conn("b", "cosmos"), conn("c", "sql")]);
    expect(counts.map((c) => [c.kind, c.count])).toEqual([["sql", 2], ["cosmos", 1]]);
    expect(engineCounts([])).toEqual([]);
  });

  it("words counts in the singular and plural", () => {
    expect(plural(1, "connection")).toBe("1 connection");
    expect(plural(0, "engine")).toBe("0 engines");
  });

  it("shows a time with one decimal under 10 ms and whole above", () => {
    expect(formatMs(0.01)).toBe("<0.1");
    expect(formatMs(0.26)).toBe("0.3");
    expect(formatMs(3)).toBe("3.0");
    expect(formatMs(12.6)).toBe("13");
  });

  it("accepts #rrggbb with or without the #, and nothing else", () => {
    expect(parseHex("#E03131")).toBe("#e03131");
    expect(parseHex(" 2f9e44 ")).toBe("#2f9e44");
    expect(parseHex("#fff")).toBeUndefined();
    expect(parseHex("red")).toBeUndefined();
  });

  it("reads a probe as checking, reachable, slow over 40 ms, unreachable or unknown", () => {
    expect(probeState(undefined)).toEqual({ state: "checking", label: "Checking", ping: "-" });
    expect(probeState({ connectionId: "a", status: "reachable", ms: 3.4 })).toEqual({ state: "reachable", label: "Reachable", ping: "3 ms" });
    expect(probeState({ connectionId: "a", status: "reachable", ms: 40 }).state).toBe("reachable");
    expect(probeState({ connectionId: "a", status: "reachable", ms: 40.5 })).toEqual({ state: "slow", label: "Slow", ping: "41 ms" });
    expect(probeState({ connectionId: "a", status: "reachable", ms: 0.2 }).ping).toBe("<1 ms");
    expect(probeState({ connectionId: "a", status: "unreachable", error: "refused" })).toEqual({ state: "unreachable", label: "Unreachable", ping: "-", title: "refused" });
    expect(probeState({ connectionId: "a", status: "unknown" })).toEqual({ state: "unknown", label: "Unknown", ping: "-", title: "Panoptic cannot tell where to probe this connection without signing in." });
  });

  it("counts reachable connections once every probe is back", () => {
    expect(reachability([undefined, { connectionId: "a", status: "reachable", ms: 3 }])).toEqual({ checking: true, reachable: 1 });
    expect(reachability([{ connectionId: "a", status: "reachable", ms: 90 }, { connectionId: "b", status: "unreachable" }])).toEqual({ checking: false, reachable: 1 });
    expect(reachability([])).toEqual({ checking: false, reachable: 0 });
  });

  it("puts dark text on light colours and white on dark ones", () => {
    expect(textOn("#f08c00")).toBe("#000000");
    expect(textOn("#ffc131")).toBe("#000000");
    expect(textOn("#1971c2")).toBe("#ffffff");
    expect(textOn("#7048e8")).toBe("#ffffff");
  });
});
