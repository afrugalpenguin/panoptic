// Endpoint label segments for the explorer (docs/explorer-ux.md, "Prefix and suffix detection").
// Pure functions, run once when the tree model changes; rows only read the result.

export interface LabelSegments {
  /** Dim: shared with the other endpoints of the same kind. */
  prefix: string;
  /** Bright: what tells this endpoint apart. */
  core: string;
  /** Dim: shared ending, usually the cloud domain. */
  suffix: string;
}

export interface LabelInput {
  id: string;
  kind: string;
  endpoint: string;
  envId: string;
}

const LOCAL_PREFIX = /^localhost\\/i;
const isLocal = (endpoint: string) => /^localhost([\\,:]|$)/i.test(endpoint);
const bright = (endpoint: string): LabelSegments => ({ prefix: "", core: endpoint, suffix: "" });

/** Longest common prefix length, case-insensitive. */
function commonPrefix(values: string[]): number {
  if (values.length === 0) return 0;
  const lower = values.map((v) => v.toLowerCase());
  let n = 0;
  while (n < lower[0].length && lower.every((v) => v[n] === lower[0][n])) n++;
  return n;
}

/** Longest common suffix length, case-insensitive. */
function commonSuffix(values: string[]): number {
  if (values.length === 0) return 0;
  const lower = values.map((v) => v.toLowerCase());
  const shortest = Math.min(...lower.map((v) => v.length));
  let n = 0;
  while (n < shortest && lower.every((v) => v[v.length - 1 - n] === lower[0][lower[0].length - 1 - n])) n++;
  return n;
}

/**
 * Prefix and suffix lengths for a set of endpoints. The prefix is cut back to just after the last
 * "." or "-" inside it, so a core never starts mid-token; a prefix with no boundary at all (glued
 * names such as acmedwhuat and acmedwhdev) is kept whole. The suffix is cut forward to its first ".".
 */
function affixes(set: string[]): { prefix: number; suffix: number } {
  let prefix = commonPrefix(set);
  if (prefix > 0) {
    const shared = set[0].slice(0, prefix);
    const boundary = Math.max(shared.lastIndexOf("."), shared.lastIndexOf("-"));
    if (boundary >= 0) prefix = boundary + 1;
  }
  let suffix = commonSuffix(set);
  if (suffix > 0) {
    const shared = set[0].slice(set[0].length - suffix);
    const dot = shared.indexOf(".");
    suffix = dot >= 0 ? suffix - dot : 0;
  }
  return { prefix, suffix };
}

function split(endpoint: string, set: string[]): LabelSegments | undefined {
  if (set.length < 2) return undefined;
  const { prefix, suffix } = affixes(set);
  if (prefix + suffix >= endpoint.length) return undefined;
  return { prefix: endpoint.slice(0, prefix), core: endpoint.slice(prefix, endpoint.length - suffix), suffix: endpoint.slice(endpoint.length - suffix) };
}

/**
 * Label segments for every connection, keyed by id. Endpoints are compared with the others of the
 * same kind across the whole tree; when that set has one member or would leave this endpoint with an
 * empty core, the env siblings of the same kind are used instead; failing that, the endpoint is all
 * bright. localhost\instance dims "localhost\"; bare localhost is all bright. Local instances are
 * left out of the sets so one local server doesn't erase every other prefix.
 */
export function computeLabels(connections: LabelInput[]): Map<string, LabelSegments> {
  const remote = connections.filter((c) => !isLocal(c.endpoint));
  const byKind = new Map<string, string[]>();
  const byEnvKind = new Map<string, string[]>();
  for (const c of remote) {
    byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c.endpoint]);
    const key = `${c.envId}\u001f${c.kind}`;
    byEnvKind.set(key, [...(byEnvKind.get(key) ?? []), c.endpoint]);
  }

  const result = new Map<string, LabelSegments>();
  for (const c of connections) {
    if (isLocal(c.endpoint)) {
      const m = LOCAL_PREFIX.exec(c.endpoint);
      result.set(c.id, m && c.endpoint.length > m[0].length ? { prefix: m[0], core: c.endpoint.slice(m[0].length), suffix: "" } : bright(c.endpoint));
      continue;
    }
    const segments =
      split(c.endpoint, byKind.get(c.kind) ?? []) ?? split(c.endpoint, byEnvKind.get(`${c.envId}\u001f${c.kind}`) ?? []) ?? bright(c.endpoint);
    result.set(c.id, segments);
  }
  return result;
}

/** Leaf names: the schema prefix ("dbo.") is dimmed like an endpoint prefix. */
export function leafLabel(name: string): LabelSegments {
  const dot = name.indexOf(".");
  return dot > 0 && dot < name.length - 1 ? { prefix: name.slice(0, dot + 1), core: name.slice(dot + 1), suffix: "" } : bright(name);
}
