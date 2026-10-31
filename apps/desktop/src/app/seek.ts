// Seek (docs/landing.md, "Seek"): one index over environments, their connections, connections in no environment
// and recent objects, ranked for a query. Pure, so the landing box, the query tab's connection picker and a later
// Ctrl+P palette all share it.

import type { Place, Usage } from "./usage";

export interface SeekHost {
  /** The connection's node id. */
  id: string;
  name: string;
  /** The environment's node id; absent for a connection in no environment. */
  envId?: string;
}

export interface SeekEnv {
  /** The environment's node id. */
  id: string;
  name: string;
  /** The environment's colour from config, for the row's swatch. */
  color?: string;
  hosts: SeekHost[];
}

export interface SeekIndex {
  envs: SeekEnv[];
  /** Connections in no environment. They rank on their own name only and never show as, or under, an environment. */
  hosts?: SeekHost[];
  usage: Usage;
}

export type SeekRow =
  | { kind: "resume"; group: "resume"; place: Place }
  | { kind: "env"; group: "envs"; env: SeekEnv }
  /** A hint, not selectable: how many environments (or connections in none) the cap hid. */
  | { kind: "more"; group: "envs" | "hosts"; count: number }
  /** env is absent for a connection in no environment. */
  | { kind: "host"; group: "hosts"; host: SeekHost; env?: SeekEnv }
  | { kind: "recent"; group: "recent"; place: Place };

export const ENV_CAP = 5;
/** Connections in no environment shown with nothing typed. */
export const HOST_CAP = 5;
export const RECENT_CAP = 3;
/** Selectable rows; the "more" hints do not count. */
export const MAX_ROWS = 9;

export const selectable = (r: SeekRow) => r.kind !== "more";

/** 3 for a prefix of the text, 2 for the start of a word in it, 1 anywhere in it, 0 not in it. */
function score(text: string, token: string): number {
  const t = text.toLowerCase();
  const at = t.indexOf(token);
  if (at < 0) return 0;
  if (at === 0) return 3;
  return /[\s._\-/]/.test(t[at - 1]) ? 2 : 1;
}

const best = (texts: string[], token: string) => Math.max(0, ...texts.map((x) => score(x, token)));

function cap(rows: SeekRow[]): SeekRow[] {
  const out: SeekRow[] = [];
  let count = 0;
  for (const r of rows) {
    if (selectable(r) && ++count > MAX_ROWS) break;
    out.push(r);
  }
  return out;
}

/** Environments by last use, then use count, then name. */
function byUse(usage: Usage) {
  return (a: SeekEnv, b: SeekEnv) =>
    (usage.envs[b.id]?.last ?? 0) - (usage.envs[a.id]?.last ?? 0) ||
    (usage.envs[b.id]?.uses ?? 0) - (usage.envs[a.id]?.uses ?? 0) ||
    a.name.localeCompare(b.name);
}

/**
 * Usage outlives config, and a connection can move: each remembered place takes its connection's current
 * environment (none for a connection in none), and a place whose connection has been removed is dropped.
 */
export function liveUsage(index: SeekIndex): Usage {
  const homes = new Map<string, string | undefined>();
  for (const env of index.envs) for (const h of env.hosts) homes.set(h.id, env.id);
  for (const h of index.hosts ?? []) homes.set(h.id, undefined);
  const live = (p: Place): Place | undefined => (homes.has(p.hostId) ? { ...p, envId: homes.get(p.hostId) } : undefined);
  return {
    ...index.usage,
    last: index.usage.last && live(index.usage.last),
    recent: index.usage.recent.flatMap((r) => live(r) ?? []),
  };
}

/** The last place, unless its connection has since been removed from config. */
export const livePlace = (index: SeekIndex): Place | undefined => liveUsage(index).last;

/** The landing's muted line: environments when there are any, otherwise connections. */
export function seekSummary(envCount: number, connectionCount: number): string {
  const hint = "Type a table, container, proc or host.";
  if (envCount === 1) return `Objects across 1 environment. ${hint}`;
  if (envCount) return `Objects across all ${envCount} environments. ${hint}`;
  if (connectionCount === 1) return `Objects across 1 connection. ${hint}`;
  if (connectionCount) return `Objects across all ${connectionCount} connections. ${hint}`;
  return "No connections yet";
}

export function seek(index: SeekIndex, query: string, scope: "all" | "connections" = "all"): SeekRow[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const usage = liveUsage(index);
  const loose = index.hosts ?? [];
  const ordered = [...index.envs].sort(byUse(usage));
  const recentIn = (env: SeekEnv) => usage.recent.filter((r) => r.envId === env.id);
  const looseRecent = usage.recent.filter((r) => r.envId === undefined);
  // A connection in no environment matches on its own name only.
  const looseScore = (h: SeekHost) => (tokens.every((t) => score(h.name, t) > 0) ? tokens.reduce((sum, t) => sum + score(h.name, t), 0) : 0);
  const byName = (a: SeekHost, b: SeekHost) => a.name.localeCompare(b.name);
  const looseRows = (hosts: SeekHost[]): SeekRow[] => hosts.map((host) => ({ kind: "host", group: "hosts", host }));

  if (scope === "connections") {
    const hosts: { host: SeekHost; env?: SeekEnv }[] = [...ordered.flatMap((env) => env.hosts.map((host) => ({ host, env }))), ...loose.map((host) => ({ host }))];
    const ranked = tokens.length
      ? hosts
          .map((h) => ({
            ...h,
            s: h.env
              ? tokens.every((t) => best([h.host.name, h.env!.name], t) > 0)
                ? tokens.reduce((sum, t) => sum + 2 * score(h.host.name, t) + score(h.env!.name, t), 0)
                : 0
              : 2 * looseScore(h.host),
          }))
          .filter((h) => h.s > 0)
          .sort((a, b) => b.s - a.s)
      : [...hosts].sort((a, b) => Number(b.host.id === usage.last?.hostId) - Number(a.host.id === usage.last?.hostId));
    return cap(ranked.map(({ host, env }) => ({ kind: "host", group: "hosts", host, env })));
  }

  if (tokens.length === 0) {
    const rows: SeekRow[] = [];
    if (usage.last) rows.push({ kind: "resume", group: "resume", place: usage.last });
    for (const env of ordered.slice(0, ENV_CAP)) rows.push({ kind: "env", group: "envs", env });
    if (ordered.length > ENV_CAP) rows.push({ kind: "more", group: "envs", count: ordered.length - ENV_CAP });
    // Connections in none: last used first (the last place, then recent objects), then by name.
    const used = [usage.last, ...usage.recent].flatMap((p) => (p ? [p.hostId] : []));
    const rank = (h: SeekHost) => (used.includes(h.id) ? used.indexOf(h.id) : Number.MAX_SAFE_INTEGER);
    const hosts = [...loose].sort((a, b) => rank(a) - rank(b) || byName(a, b));
    rows.push(...looseRows(hosts.slice(0, HOST_CAP)));
    if (hosts.length > HOST_CAP) rows.push({ kind: "more", group: "hosts", count: hosts.length - HOST_CAP });
    for (const place of usage.recent.filter((r) => r.nodeId !== usage.last?.nodeId).slice(0, RECENT_CAP)) rows.push({ kind: "recent", group: "recent", place });
    return index.envs.length || loose.length ? cap(rows) : [];
  }

  // An environment matches when every token is in its name or id, a host's name, or a recent object's label in it.
  const matched = ordered
    .map((env) => {
      const texts = [env.name, env.id, ...env.hosts.map((h) => h.name), ...recentIn(env).map((r) => r.label)];
      const all = tokens.every((t) => best(texts, t) > 0);
      return { env, s: all ? tokens.reduce((sum, t) => sum + 4 * score(env.name, t) + 1, 0) : 0 };
    })
    .filter((m) => m.s > 0)
    .sort((a, b) => b.s - a.s);

  const rows: SeekRow[] = matched.slice(0, ENV_CAP).map(({ env }) => ({ kind: "env", group: "envs", env }));
  if (matched.length > ENV_CAP) rows.push({ kind: "more", group: "envs", count: matched.length - ENV_CAP });
  const top = matched[0]?.env;
  const inTop = (texts: string[]) => !!top && tokens.every((t) => best([...texts, top.name, top.id], t) > 0);
  if (top) for (const host of top.hosts.filter((h) => inTop([h.name])).sort(byName)) rows.push({ kind: "host", group: "hosts", host, env: top });
  const looseMatches = loose.map((h) => ({ h, s: looseScore(h) })).filter((m) => m.s > 0);
  rows.push(...looseRows(looseMatches.sort((a, b) => b.s - a.s || byName(a.h, b.h)).map((m) => m.h)));
  const recent = [
    ...(top ? recentIn(top).filter((r) => inTop([r.label, r.hostName])) : []),
    ...looseRecent.filter((r) => tokens.every((t) => best([r.label, r.hostName], t) > 0)),
  ];
  for (const place of recent.slice(0, RECENT_CAP)) rows.push({ kind: "recent", group: "recent", place });
  return cap(rows);
}

export type SeekKey =
  | { kind: "move"; index: number }
  /** Enter: scope the tree to the row (or reopen a place). */
  | { kind: "open"; row: SeekRow }
  /** Ctrl+Enter: a new query tab on the row's connection. */
  | { kind: "query"; row: SeekRow }
  | { kind: "clear" }
  | { kind: "leave" };

/** What a key in the Seek box does; undefined leaves the key to the browser. active indexes the selectable rows. */
export function seekKey(e: { key: string; ctrlKey: boolean; shiftKey: boolean }, rows: SeekRow[], active: number, query: string): SeekKey | undefined {
  const list = rows.filter(selectable);
  switch (e.key) {
    case "ArrowDown":
      return list.length ? { kind: "move", index: Math.min(active + 1, list.length - 1) } : undefined;
    case "ArrowUp":
      return list.length ? { kind: "move", index: Math.max(active - 1, 0) } : undefined;
    case "Enter":
      return list[active] ? { kind: e.ctrlKey ? "query" : "open", row: list[active] } : undefined;
    case "Tab": {
      if (e.shiftKey || !list[active]) return undefined;
      const next = list.findIndex((r, i) => i > active && r.group !== list[active].group);
      return next >= 0 ? { kind: "move", index: next } : undefined;
    }
    case "Escape":
      return query ? { kind: "clear" } : { kind: "leave" };
  }
  return undefined;
}
