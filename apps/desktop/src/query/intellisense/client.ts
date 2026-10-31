// Main-thread side of the IntelliSense worker: sends each catalog once per version and turns requests into promises.
// A newer completion, hover or lint request supersedes an older one of the same type, which then resolves empty.
// Suggestions are one per error and never supersede each other.

import type { DatabaseCatalog } from "../catalog.svelte";
import type { Options } from "./engine";
import type { Language } from "./scanner";
import type { CompleteResponse, HoverResponse, Keys, LintResponse, Request, Response, SuggestRequest, SuggestResponse } from "./worker";

export interface WorkerLike {
  postMessage(message: Request): void;
  onmessage: ((e: MessageEvent<Response>) => void) | null;
}

type Kind = "complete" | "hover" | "suggest" | "lint";

const EMPTY: Record<Exclude<Kind, "suggest">, (id: number, offset: number) => Response> = {
  complete: (id, offset) => ({ id, items: [], start: offset }),
  hover: (id) => ({ id, markdown: null }),
  lint: (id) => ({ id, warnings: [] }),
};

export class IntelliSenseClient {
  private worker?: WorkerLike;
  private nextId = 1;
  private readonly sent = new Map<string, number>();
  private readonly pending = new Map<number, { type: Kind; offset: number; resolve: (r: Response) => void }>();

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
    return this.request("complete", offset, { text, offset, options, keys }) as Promise<CompleteResponse>;
  }

  hover(text: string, offset: number, options: Options, keys: Keys): Promise<HoverResponse> {
    return this.request("hover", offset, { text, offset, options, keys }) as Promise<HoverResponse>;
  }

  suggest(request: SuggestRequest, keys: Keys): Promise<SuggestResponse> {
    return this.request("suggest", 0, { ...request, keys }) as Promise<SuggestResponse>;
  }

  lint(text: string, offset: number, keys: Keys, language: Language = "tsql", unknownNames = true): Promise<LintResponse> {
    return this.request("lint", offset, { text, offset, keys, language, unknownNames }) as Promise<LintResponse>;
  }

  private request(type: Kind, offset: number, body: object): Promise<Response> {
    if (type !== "suggest")
      for (const [id, waiting] of this.pending)
        if (waiting.type === type) {
          this.pending.delete(id);
          waiting.resolve(EMPTY[type](id, waiting.offset));
        }
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, { type, offset, resolve });
      this.port.postMessage({ type, id, ...body } as Request);
    });
  }
}
