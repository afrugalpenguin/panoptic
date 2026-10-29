import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";

// The update check is the only outbound call outside configured connections (ADR 0009, 0010).
const CHECK_TIMEOUT_MS = 15_000;

export type UpdateState =
  | { kind: "idle"; current: string }
  | { kind: "available"; current: string; next: string }
  | { kind: "downloading"; current: string; next: string }
  | { kind: "ready"; current: string; next: string; install: () => Promise<void> }
  | { kind: "error"; current: string; message: string };

/** Checks GitHub Releases on launch and downloads in the background; installing waits for the user. */
export async function checkForUpdates(onState: (s: UpdateState) => void): Promise<void> {
  const current = await getVersion();
  onState({ kind: "idle", current });
  try {
    const update = await check({ timeout: CHECK_TIMEOUT_MS });
    if (!update) return;

    // A portable copy can't be updated in place; just say a new version exists.
    if (!(await invoke<boolean>("is_installed"))) {
      onState({ kind: "available", current, next: update.version });
      return;
    }

    onState({ kind: "downloading", current, next: update.version });
    await update.download();
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
  }
}
