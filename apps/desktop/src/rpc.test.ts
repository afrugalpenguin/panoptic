import { describe, expect, it, vi } from "vitest";
import { RpcClient, RpcError } from "./rpc";

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
});
