// Main-thread side of the IntelliSense worker: sends each catalog once per version and turns requests into promises.
// A newer request of the same type supersedes an older one, which then resolves empty.

import type { DatabaseCatalog } from "../catalog.svelte";
import type { Options } from "./engine";
import type { CompleteResponse, HoverResponse, Keys, Request, Response } from "./worker";

export interface WorkerLike {
  postMessage(message: Request): void;
  onmessage: ((e: MessageEvent<Response>) => void) | null;
}

export class IntelliSenseClient {
  private worker?: WorkerLike;
  private nextId = 1;
  private readonly sent = new Map<string, number>();
  private readonly pending = new Map<number, { type: "complete" | "hover"; resolve: (r: Response) => void }>();

  constructor(private readonly create: () => WorkerLike) {}

  private get port(): WorkerLike {
    if (!this.worker) {
      this.worker = this.create();
      this.worker.onmessage = (e) => {
        const waiting = this.pending.get(e.data.id);
        if (!waiting) return;
        this.pending.delete(e.data.id);
        waiting.resolve(e.data);
      };
    }
    return this.worker;
  }

  /** Sends the catalog if the worker does not have this version of it yet. */
  sync(key: string, catalog: DatabaseCatalog | undefined, version: number): void {
    if (!catalog || this.sent.get(key) === version) return;
    this.sent.set(key, version);
    this.port.postMessage({ type: "catalog", key, catalog });
  }

  complete(text: string, offset: number, options: Options, keys: Keys): Promise<CompleteResponse> {
    return this.request("complete", { text, offset, options, keys }) as Promise<CompleteResponse>;
  }

  hover(text: string, offset: number, options: Options, keys: Keys): Promise<HoverResponse> {
    return this.request("hover", { text, offset, options, keys }) as Promise<HoverResponse>;
  }

  private request(type: "complete" | "hover", body: { text: string; offset: number; options: Options; keys: Keys }): Promise<Response> {
    for (const [id, waiting] of this.pending)
      if (waiting.type === type) {
        this.pending.delete(id);
        waiting.resolve(type === "complete" ? { id, items: [], start: body.offset } : { id, markdown: null });
      }
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, { type, resolve });
      this.port.postMessage({ type, id, ...body } as Request);
    });
  }
}
