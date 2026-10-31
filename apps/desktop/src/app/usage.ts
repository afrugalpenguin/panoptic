// Where the user has been: per-environment last use and use count, the last place a query tab was opened, and the
// recent objects (docs/landing.md, "Usage"). Local storage only: a convenience on this machine, never sent anywhere.

export interface Place {
  envId: string;
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
  const env = usage.envs[place.envId];
  const recent = place.kind === "connection" ? usage.recent : [place, ...usage.recent.filter((r) => r.nodeId !== place.nodeId)].slice(0, RECENT_KEEP);
  return { envs: { ...usage.envs, [place.envId]: { last: now, uses: (env?.uses ?? 0) + 1 } }, last: place, recent };
}

export function loadUsage(storage: Storage | undefined = globalThis.localStorage): Usage {
  try {
    const raw = storage?.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Usage) : undefined;
    return parsed && typeof parsed.envs === "object" && Array.isArray(parsed.recent) ? parsed : EMPTY_USAGE;
  } catch {
    return EMPTY_USAGE;
  }
}

export function saveUsage(usage: Usage, storage: Storage | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, JSON.stringify(usage));
  } catch {
    // Private mode or full storage: the landing just has less to offer next time.
  }
}
