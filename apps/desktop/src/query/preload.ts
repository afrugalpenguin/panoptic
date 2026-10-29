let started = false;

/** Starts fetching the Monaco chunk ahead of the first query tab (docs/query-editor.md, "Monaco"). Idempotent. */
export function preloadMonaco(): void {
  if (started) return;
  started = true;
  void import("./monaco");
}
