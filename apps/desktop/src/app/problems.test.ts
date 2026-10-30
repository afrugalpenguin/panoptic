import { describe, expect, it } from "vitest";
import { RpcError } from "../rpc";
import { errorText, errorTooltip, firstSentence, toNodeError } from "./problems";

describe("toNodeError", () => {
  it("uses the sidecar's structured error", () => {
    const data = { summary: "Login failed.", detail: "Login failed for user 'app'.", code: "18456", retryable: false };
    expect(toNodeError(new RpcError(-32000, "raw", data))).toBe(data);
  });

  it("falls back to the first sentence for anything else", () => {
    expect(toNodeError(new Error("tree.children timed out after 180000 ms"))).toEqual({
      summary: "tree.children timed out after 180000 ms",
      detail: "tree.children timed out after 180000 ms",
      retryable: true,
    });
    expect(toNodeError(new RpcError(-32000, "Connection no longer exists. Refresh.", { bogus: 1 })).summary).toBe("Connection no longer exists.");
  });
});

describe("firstSentence", () => {
  it("stops at a sentence end, semicolon or line break and caps the length", () => {
    expect(firstSentence("Forbidden (403); Substatus: 5300")).toBe("Forbidden (403)");
    expect(firstSentence("one\ntwo")).toBe("one");
    const long = firstSentence("x".repeat(200));
    expect(long.length).toBeLessThanOrEqual(80);
    expect(long.endsWith("…")).toBe(true);
    expect(firstSentence("  ")).toBe("The request failed.");
    expect(firstSentence(`${"word ".repeat(30)}end`)).toBe(`${"word ".repeat(15).trimEnd()}…`);
  });
});

describe("error text", () => {
  const e = { summary: "No data-plane access.", detail: "full detail", code: "403/5300", retryable: false };

  it("tooltip is the summary plus the code", () => {
    expect(errorTooltip(e)).toBe("No data-plane access. (403/5300)");
    expect(errorTooltip({ ...e, code: undefined })).toBe("No data-plane access.");
  });

  it("copy includes the detail", () => {
    expect(errorText(e)).toBe("No data-plane access. (403/5300)\n\nfull detail");
  });
});
