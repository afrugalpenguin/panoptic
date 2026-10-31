// Where the user has been: per-environment last use and use count, the last place a query tab was opened, and the
// recent objects (docs/landing.md, "Usage"). Local storage only: a convenience on this machine, never sent anywhere.

export interface Place {
  /** The environment's node id when recorded; absent for a connection in no environment. Seek looks the current one
   * up from the connection (liveUsage), since a connection can move. */
  envId?: string;
  /** The connection's node id and display name. */
  hostId: string;
  hostName: string;
  /** The node the tab was opened on: the connection itself, a database or an object. */
  nodeId: string;
  label: string;
  kind: string;
}

export interface Usage {
  envs: Record<string, { last: number; uses: number }>;
  last?: Place;
  /** Places below connection level, newest first. */
  recent: Place[];
}

export const EMPTY_USAGE: Usage = { envs: {}, recent: [] };
export const RECENT_KEEP = 20;
const KEY = "panoptic.usage";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

export function recordUse(usage: Usage, place: Place, now: number): Usage {
  const recent = place.kind === "connection" ? usage.recent : [place, ...usage.recent.filter((r) => r.nodeId !== place.nodeId)].slice(0, RECENT_KEEP);
  if (!place.envId) return { envs: usage.envs, last: place, recent };
  const env = usage.envs[place.envId];
  return { envs: { ...usage.envs, [place.envId]: { last: now, uses: (env?.uses ?? 0) + 1 } }, last: place, recent };
}

// Storage is looked up inside the try: with site data blocked, merely reading localStorage throws.
export function loadUsage(storage?: Storage): Usage {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Usage) : undefined;
    if (!parsed || typeof parsed.envs !== "object" || !Array.isArray(parsed.recent)) return EMPTY_USAGE;
    return { ...parsed, last: parsed.last && withoutEnvSegment(parsed.last), recent: parsed.recent.map(withoutEnvSegment) };
  } catch {
    return EMPTY_USAGE;
  }
}

/**
 * Connection ids used to start with their environment (env:x/conn:y/...); they no longer do (docs/explorer-ux.md,
 * "Grouping"). Places saved before that would otherwise look like removed connections and be dropped.
 */
const withoutEnvSegment = (p: Place): Place => ({
  ...p,
  hostId: p.hostId.replace(/^env:[^/]*\//, ""),
  nodeId: p.nodeId.replace(/^env:[^/]*\/(?=conn:)/, ""),
});

export function saveUsage(usage: Usage, storage?: Storage): void {
  try {
    (storage ?? globalThis.localStorage)?.setItem(KEY, JSON.stringify(usage));
  } catch {
    // Private mode or full storage: the landing just has less to offer next time.
  }
}
