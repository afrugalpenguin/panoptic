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

/** A request its caller aborted. Callers that abort on purpose (collapsing a node) treat it as not an error. */
export class AbortError extends Error {
  constructor(method: string) {
    super(`${method} was cancelled`);
    this.name = "AbortError";
  }
}

export const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Detaches the abort listener. */
  release: () => void;
};

export const DEFAULT_TIMEOUT_MS = 10_000;

export class RpcClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly send: (line: string) => Promise<void>,
    private readonly onNotification: (method: string, params: unknown) => void = () => {},
  ) {}

  /**
   * Aborting `signal` rejects at once with an AbortError and sends $/cancelRequest so the sidecar stops
   * the work; its late response, if any, is ignored.
   */
  request<T = unknown>(method: string, params?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(new AbortError(method));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settle(id, undefined, new Error(`${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      const onAbort = () => {
        if (!this.pending.has(id)) return;
        this.settle(id, undefined, new AbortError(method));
        this.send(JSON.stringify({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id } })).catch(() => {});
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const release = () => signal?.removeEventListener("abort", onAbort);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer, release });

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
    p.release();
    if (error) p.reject(error);
    else p.resolve(result);
  }
}
