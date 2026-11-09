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
  /** The database it is in, as the tree labels it, when it is below one; absent for places recorded before. */
  database?: string;
}

export interface Usage {
  envs: Record<string, { last: number; uses: number }>;
  last?: Place;
  /** Places below connection level, newest first. */
  recent: Place[];
  /** The environment pane's Recent card (docs/environment-pane.md): places below connection level per environment node
   * id, newest first, each with when it was used. Absent in usage saved before it existed. */
  envRecent?: Record<string, RecentPlace[]>;
  /** The connection pane's Recent card (docs/connection-pane.md): the same, per connection node id, whether or not the
   * connection is in an environment. Absent in usage saved before it existed. */
  hostRecent?: Record<string, RecentPlace[]>;
}

export interface RecentPlace extends Place {
  /** When it was opened or queried, in ms since the epoch. */
  at: number;
}

export const EMPTY_USAGE: Usage = { envs: {}, recent: [] };
export const RECENT_KEEP = 20;
export const ENV_RECENT_KEEP = 50;
export const HOST_RECENT_KEEP = 20;
const KEY = "panoptic.usage";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/** A newest-first list with the place put first, once, and cut to keep. */
const push = (list: RecentPlace[] | undefined, place: Place, now: number, keep: number): RecentPlace[] =>
  [{ ...place, at: now }, ...(list ?? []).filter((r) => r.nodeId !== place.nodeId)].slice(0, keep);

export function recordUse(usage: Usage, place: Place, now: number): Usage {
  if (place.kind === "connection") {
    if (!place.envId) return { ...usage, last: place };
    const env = usage.envs[place.envId];
    return { ...usage, envs: { ...usage.envs, [place.envId]: { last: now, uses: (env?.uses ?? 0) + 1 } }, last: place };
  }
  const recent = [place, ...usage.recent.filter((r) => r.nodeId !== place.nodeId)].slice(0, RECENT_KEEP);
  const hostRecent = { ...usage.hostRecent, [place.hostId]: push(usage.hostRecent?.[place.hostId], place, now, HOST_RECENT_KEEP) };
  if (!place.envId) return { ...usage, last: place, recent, hostRecent };
  const env = usage.envs[place.envId];
  const envs = { ...usage.envs, [place.envId]: { last: now, uses: (env?.uses ?? 0) + 1 } };
  const envRecent = { ...usage.envRecent, [place.envId]: push(usage.envRecent?.[place.envId], place, now, ENV_RECENT_KEEP) };
  return { ...usage, envs, last: place, recent, envRecent, hostRecent };
}

/** An environment's most recent objects, newest first: the Recent card's rows. */
export function envRecent(usage: Usage, envId: string, limit = 5): RecentPlace[] {
  return (usage.envRecent?.[envId] ?? []).slice(0, limit);
}

/**
 * A connection's most recent objects, newest first: the connection pane's Recent card. Its own list, plus what the
 * environments' lists hold for it from before it had one (or from an environment it has since left), each place once.
 */
export function connectionRecent(usage: Usage, hostId: string, limit = 5): RecentPlace[] {
  const all = [...(usage.hostRecent?.[hostId] ?? []), ...Object.values(usage.envRecent ?? {}).flat().filter((r) => r.hostId === hostId)];
  const newest = new Map<string, RecentPlace>();
  for (const r of all) if ((newest.get(r.nodeId)?.at ?? -1) < r.at) newest.set(r.nodeId, r);
  return [...newest.values()].sort((a, b) => b.at - a.at).slice(0, limit);
}

/** How long ago, as the Recent card shows it: "now", "4m", "1h", "2d". */
export function age(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

// Storage is looked up inside the try: with site data blocked, merely reading localStorage throws.
export function loadUsage(storage?: Storage): Usage {
  try {
    const raw = (storage ?? globalThis.localStorage)?.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as Usage) : undefined;
    if (!parsed || typeof parsed.envs !== "object" || !Array.isArray(parsed.recent)) return EMPTY_USAGE;
    const recentMap = (map: unknown): Record<string, RecentPlace[]> | undefined =>
      map && typeof map === "object" && !Array.isArray(map)
        ? Object.fromEntries(
            Object.entries(map as Record<string, unknown>)
              .filter((entry): entry is [string, RecentPlace[]] => Array.isArray(entry[1]))
              .map(([key, list]) => [key, list.map((p) => ({ ...withoutEnvSegment(p), at: Number(p.at) || 0 }))]),
          )
        : undefined;
    const envRecent = recentMap(parsed.envRecent);
    const hostRecent = recentMap(parsed.hostRecent);
    return {
      ...parsed,
      last: parsed.last && withoutEnvSegment(parsed.last),
      recent: parsed.recent.map(withoutEnvSegment),
      envRecent,
      ...(hostRecent ? { hostRecent } : {}),
    };
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
