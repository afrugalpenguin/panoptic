import { describe, expect, it } from "vitest";
import { RpcError } from "../rpc";
import { appProblem, errorText, errorTooltip, firstSentence, toNodeError } from "./problems";

describe("appProblem", () => {
  it("files a failure outside the tree under Panoptic, with what was being done as its path (#197)", () => {
    expect(appProblem(3, "Loading the explorer", new Error("config timed out after 10000 ms. Retry later."), 1234)).toEqual({
      nodeId: "app:3",
      env: "",
      connection: "Panoptic",
      path: ["Loading the explorer"],
      error: { summary: "config timed out after 10000 ms.", detail: "config timed out after 10000 ms. Retry later.", retryable: true },
      at: 1234,
    });
  });

  it("takes a plain reason as well as an error", () => {
    expect(appProblem(1, "Database engine output", "Not a JSON-RPC message", 1).error.detail).toBe("Not a JSON-RPC message");
  });
});

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
