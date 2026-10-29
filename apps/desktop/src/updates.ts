import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

// The update check is the only outbound call outside configured connections (ADR 0009, 0010), and
// the user can turn it off entirely (Settings, "Never"). Nothing in this module runs on its own:
// it checks only when update-schedule.ts or the user's "Check now" asks it to.
const CHECK_TIMEOUT_MS = 15_000;

export type UpdateState =
  | { kind: "idle"; current: string }
  | { kind: "checking"; current: string }
  | { kind: "upToDate"; current: string; checkedAt: number }
  | { kind: "available"; current: string; next: string }
  | { kind: "downloading"; current: string; next: string }
  | { kind: "ready"; current: string; next: string; install: () => Promise<void> }
  | { kind: "error"; current: string; message: string };

/**
 * Returns a function that checks GitHub Releases once and, for an installed copy, downloads the
 * update in the background. Installing always waits for the user. Overlapping calls are ignored,
 * and once an update is downloaded there is nothing more to check until the user restarts.
 */
export function createUpdateChecker(onState: (s: UpdateState) => void): () => Promise<void> {
  let busy = false;
  let ready = false;

  return async () => {
    if (busy || ready) return;
    busy = true;
    const current = await getVersion();
    onState({ kind: "checking", current });
    try {
      const update = await check({ timeout: CHECK_TIMEOUT_MS });
      if (!update) {
        onState({ kind: "upToDate", current, checkedAt: Date.now() });
        return;
      }

      // A portable copy can't be updated in place; just say a new version exists.
      if (!(await invoke<boolean>("is_installed"))) {
        onState({ kind: "available", current, next: update.version });
        return;
      }

      onState({ kind: "downloading", current, next: update.version });
      await update.download();
      ready = true;
      onState({
        kind: "ready",
        current,
        next: update.version,
        install: async () => {
          await invoke("sidecar_stop");
          await update.install();
          await relaunch();
        },
      });
    } catch (e) {
      onState({ kind: "error", current, message: String(e) });
    } finally {
      busy = false;
    }
  };
}

export const currentVersion = () => getVersion();
