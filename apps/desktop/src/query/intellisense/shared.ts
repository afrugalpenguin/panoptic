// The one IntelliSense worker client, shared by the editor (completions, hover, unknown-name warnings) and the query
// store (suggestions for name errors), so the worker holds each catalog once. Creating it starts no worker: that
// happens on the first request. It does not import Monaco.

import { IntelliSenseClient } from "./client";
import type { ModelInfo } from "./providers";
import IntelliSenseWorker from "./worker-entry?worker";

export const intellisense = new IntelliSenseClient(() => new IntelliSenseWorker());

/** Sends the worker any of the model's catalogs it does not have yet. */
export function syncCatalogs(info: ModelInfo): void {
  for (const c of info.catalogs) intellisense.sync(c.key, c.catalog, c.version);
}
