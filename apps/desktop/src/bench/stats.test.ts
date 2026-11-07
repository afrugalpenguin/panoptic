import { describe, expect, it } from "vitest";
import { median, summarise } from "./stats";

describe("summarise", () => {
  it("computes percentiles and counts late and dropped frames", () => {
    const deltas = [...Array(90).fill(10), ...Array(9).fill(20), 50];
    const s = summarise(deltas);

    expect(s.frames).toBe(100);
    expect(s.p50).toBe(10);
    expect(s.p95).toBe(20);
    expect(s.max).toBe(50);
    expect(s.over25).toBe(1);
    expect(s.over33).toBe(1);
  });

  it("handles no frames", () => {
    expect(summarise([]).frames).toBe(0);
  });
});

describe("median", () => {
  it("takes the middle value of an odd count", () => {
    expect(median([30, 10, 20])).toBe(20);
  });

  it("averages the two middle values of an even count", () => {
    expect(median([40, 10, 30, 20])).toBe(25);
  });
});
