// JSON-RPC 2.0 client for the sidecar. Transport-agnostic: the caller supplies `send`
// and feeds every incoming line to `receive`.

export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
    /** The error's `data` member, when the sidecar sent one (a NodeError for tree loads). */
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export const DEFAULT_TIMEOUT_MS = 10_000;

export class RpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly send: (line: string) => Promise<void>,
    private readonly onNotification: (method: string, params: unknown) => void = () => {},
  ) {}

  request<T = unknown>(method: string, params?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });

      const message = params === undefined ? { jsonrpc: "2.0", id, method } : { jsonrpc: "2.0", id, method, params };
      this.send(JSON.stringify(message)).catch((err) => this.settle(id, undefined, err instanceof Error ? err : new Error(String(err))));
    });
  }

  receive(line: string): void {
    let msg: { id?: unknown; method?: unknown; params?: unknown; result?: unknown; error?: { code: number; message: string; data?: unknown } };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof msg?.method === "string" && msg.id === undefined) {
      this.onNotification(msg.method, msg.params);
      return;
    }
    if (typeof msg?.id !== "number") return;
    this.settle(msg.id, msg.result, msg.error ? new RpcError(msg.error.code, msg.error.message, msg.error.data) : undefined);
  }

  disconnect(reason: string): void {
    for (const id of [...this.pending.keys()]) this.settle(id, undefined, new Error(reason));
  }

  private settle(id: number, result: unknown, error?: Error): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    clearTimeout(p.timer);
    if (error) p.reject(error);
    else p.resolve(result);
  }
}
