/** Mirrors UpdateCheckModes in the sidecar's Model.cs. */
export type UpdateCheckMode = "startup" | "hourly" | "never";

export const HOUR_MS = 60 * 60 * 1000;

/**
 * Applies the user's update-check setting. "never" makes no calls at all; "startup" checks once at
 * launch; "hourly" checks at launch and then every hour. Returns a function that cancels the schedule.
 * atLaunch is false when the setting changes mid-session, so changing it never triggers a surprise check.
 */
export function scheduleUpdateChecks(mode: UpdateCheckMode, check: () => void, { atLaunch }: { atLaunch: boolean }): () => void {
  if (mode === "never") return () => {};
  if (atLaunch) check();
  if (mode !== "hourly") return () => {};
  const timer = setInterval(check, HOUR_MS);
  return () => clearInterval(timer);
}
