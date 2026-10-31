// Undo for Delete environment and Remove connection (docs/explorer-ux.md, "Destructive actions"). The sidecar keeps a
// deleted connection's secret until the undo window closes, so Undo can write the prior config back with nothing lost.

import type { AppConfig } from "./api";

export const UNDO_MS = 10_000;

export interface UndoHost {
  /** Writes the config as it was before the delete; the sidecar still holds its secrets. */
  restore: (prior: AppConfig) => Promise<void>;
  /** Drops the secrets of these connections, now the delete stands. */
  purge: (connectionIds: string[]) => Promise<void>;
  /** The status bar text, or undefined when there is nothing to undo. */
  changed: (text: string | undefined) => void;
}

interface Pending {
  text: string;
  prior: AppConfig;
  connectionIds: string[];
  timer: ReturnType<typeof setTimeout>;
}

/** One delete can be undone at a time; a newer delete, or any other config change, makes the last one stand. */
export class UndoDelete {
  #pending: Pending | undefined;

  constructor(private readonly host: UndoHost) {}

  text(): string | undefined {
    return this.#pending?.text;
  }

  offer(text: string, prior: AppConfig, connectionIds: string[]) {
    void this.settle();
    const timer = setTimeout(() => void this.settle(), UNDO_MS);
    this.#pending = { text, prior, connectionIds, timer };
    this.host.changed(text);
  }

  async undo() {
    const p = this.#take();
    if (p) await this.host.restore(p.prior);
  }

  /** Makes a pending delete stand now: its secrets go and Undo is no longer offered. */
  async settle() {
    const p = this.#take();
    if (p) await this.host.purge(p.connectionIds);
  }

  #take(): Pending | undefined {
    const p = this.#pending;
    if (!p) return undefined;
    clearTimeout(p.timer);
    this.#pending = undefined;
    this.host.changed(undefined);
    return p;
  }
}
