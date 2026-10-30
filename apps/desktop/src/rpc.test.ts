import { describe, expect, it, vi } from "vitest";
import { isAbortError, RpcClient, RpcError } from "./rpc";

function setup() {
  const sent: string[] = [];
  const client = new RpcClient(async (line) => {
    sent.push(line);
  });
  const lastId = () => JSON.parse(sent[sent.length - 1]).id;
  return { client, sent, lastId };
}

describe("RpcClient", () => {
  it("sends a JSON-RPC 2.0 request line and resolves with the matching result", async () => {
    const { client, sent, lastId } = setup();
    const p = client.request("ping");
    await Promise.resolve();

    expect(JSON.parse(sent[0])).toMatchObject({ jsonrpc: "2.0", method: "ping" });
    client.receive(JSON.stringify({ jsonrpc: "2.0", id: lastId(), result: { startupMs: 12 } }));
    await expect(p).resolves.toEqual({ startupMs: 12 });
  });

  it("rejects with RpcError when the response is an error", async () => {
    const { client, lastId } = setup();
    const p = client.request("nope");
    await Promise.resolve();

    client.receive(JSON.stringify({ jsonrpc: "2.0", id: lastId(), error: { code: -32601, message: "Method not found" } }));
    await expect(p).rejects.toEqual(new RpcError(-32601, "Method not found"));
  });

  it("keeps the error's data", async () => {
    const { client, lastId } = setup();
    const p = client.request("tree.children");
    await Promise.resolve();

    const data = { summary: "Login failed.", detail: "full", code: "18456", retryable: false };
    client.receive(JSON.stringify({ jsonrpc: "2.0", id: lastId(), error: { code: -32000, message: "raw", data } }));
    await expect(p).rejects.toMatchObject({ code: -32000, message: "raw", data });
  });

  it("matches responses to requests by id when they arrive out of order", async () => {
    const { client, sent } = setup();
    const a = client.request("a");
    const b = client.request("b");
    await Promise.resolve();
    const [idA, idB] = sent.map((s) => JSON.parse(s).id);

    client.receive(JSON.stringify({ jsonrpc: "2.0", id: idB, result: "B" }));
    client.receive(JSON.stringify({ jsonrpc: "2.0", id: idA, result: "A" }));
    await expect(a).resolves.toBe("A");
    await expect(b).resolves.toBe("B");
  });

  it("times out a request that never gets a response", async () => {
    vi.useFakeTimers();
    const { client } = setup();
    const p = client.request("slow", undefined, 1000);
    vi.advanceTimersByTime(1001);
    await expect(p).rejects.toThrow(/timed out/);
    vi.useRealTimers();
  });

  it("rejects every pending request when the sidecar disconnects", async () => {
    const { client } = setup();
    const p = client.request("ping");
    client.disconnect("sidecar exited");
    await expect(p).rejects.toThrow("sidecar exited");
  });

  it("ignores lines that are not responses to pending requests", () => {
    const { client } = setup();
    expect(() => client.receive("garbage")).not.toThrow();
    expect(() => client.receive(JSON.stringify({ jsonrpc: "2.0", id: 999, result: 1 }))).not.toThrow();
  });

  it("on abort, rejects with an AbortError, sends $/cancelRequest for the id and ignores the late response", async () => {
    const { client, sent, lastId } = setup();
    const abort = new AbortController();
    const p = client.request("tree.children", { nodeId: "x" }, 180_000, abort.signal);
    await Promise.resolve();
    const id = lastId();

    abort.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    await expect(p).rejects.toSatisfy(isAbortError);
    expect(JSON.parse(sent[1])).toEqual({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id } });

    expect(() => client.receive(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32800, message: "Request cancelled" } }))).not.toThrow();
  });

  it("rejects an already aborted request without sending it", async () => {
    const { client, sent } = setup();
    const abort = new AbortController();
    abort.abort();
    await expect(client.request("tree.children", undefined, 1000, abort.signal)).rejects.toSatisfy(isAbortError);
    expect(sent).toEqual([]);
  });

  it("aborting after the response arrived does nothing", async () => {
    const { client, sent, lastId } = setup();
    const abort = new AbortController();
    const p = client.request("tree.children", undefined, 1000, abort.signal);
    await Promise.resolve();
    client.receive(JSON.stringify({ jsonrpc: "2.0", id: lastId(), result: [] }));
    await expect(p).resolves.toEqual([]);

    abort.abort();
    expect(sent).toHaveLength(1);
  });

  it("does not treat timeouts or server errors as aborts", () => {
    expect(isAbortError(new Error("tree.children timed out after 10 ms"))).toBe(false);
    expect(isAbortError(new RpcError(-32000, "Login failed"))).toBe(false);
  });

  it("passes server notifications to the notification handler", () => {
    const seen: [string, unknown][] = [];
    const client = new RpcClient(async () => {}, (method, params) => seen.push([method, params]));
    client.receive(JSON.stringify({ jsonrpc: "2.0", method: "auth.deviceCode", params: { userCode: "ABC" } }));
    expect(seen).toEqual([["auth.deviceCode", { userCode: "ABC" }]]);
  });
});
