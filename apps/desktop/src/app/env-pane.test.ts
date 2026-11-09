import { describe, expect, it } from "vitest";
import { engineCounts, formatMs, parseHex, plural, textOn } from "./env-pane";
import type { EnvConnection } from "./tree-model";

const conn = (id: string, kind: string): EnvConnection => ({
  id,
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

  it("puts dark text on light colours and white on dark ones", () => {
    expect(textOn("#f08c00")).toBe("#000000");
    expect(textOn("#ffc131")).toBe("#000000");
    expect(textOn("#1971c2")).toBe("#ffffff");
    expect(textOn("#7048e8")).toBe("#ffffff");
  });
});
