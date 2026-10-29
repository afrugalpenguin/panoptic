import { describe, expect, it } from "vitest";
import { summarise } from "./stats";

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
