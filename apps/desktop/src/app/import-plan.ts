import type { ImportCandidate, ImportSource } from "./api";

export interface PlanGroup {
  key: string;
  sourceLabel: string;
  /** Proposed environment name: the source tool's group, or one suggested from server names. */
  name: string;
  /** True when the name was guessed from server names rather than defined in the source tool. */
  suggested: boolean;
  candidates: ImportCandidate[];
}

/**
 * A prefix counts as a naming family when at least this many distinct servers share it, and at
 * least half of the servers that share its first MIN_PREFIX characters. The half rule stops a
 * sub-family from winning: in acmedwhuat, acmedwhsupport, acmedwhsandbox, acmedwhstage-us,
 * acmedwhdev, the prefix "acmedwhs" is shared by three, but only "acmedwh" covers the family.
 */
const FAMILY_SIZE = 3;
const MIN_PREFIX = 4;

/** Canonical names for common tokens; anything else is title-cased as written. */
const TOKEN_NAMES: Record<string, string> = {
  uat: "UAT",
  dev: "Dev",
  develop: "Dev",
  development: "Dev",
  prod: "Prod",
  prd: "Prod",
  production: "Prod",
  live: "Prod",
  test: "Test",
  tst: "Test",
  qa: "Test",
  uk: "UK",
  us: "US",
  eu: "EU",
};

// Fallback for servers with no naming family. Whole-word-ish, or glued onto the end of the name,
// so "devonshire" and "product" don't count as dev or prod.
const KEYWORDS: [string, RegExp][] = [
  ["Prod", /(^|[^a-z])(prod|prd|production|live)([^a-z]|$)|[a-z]{3,}(prod|prd)$/i],
  ["UAT", /(^|[^a-z])(uat|preprod|staging|stg)([^a-z]|$)|[a-z]{3,}uat$/i],
  ["Test", /(^|[^a-z])(test|tst|qa)([^a-z]|$)|[a-z]{3,}(test|qa)$/i],
  ["Dev", /(^|[^a-z])(dev|develop|development)([^a-z]|$)|[a-z]{3,}dev$/i],
];

const LOCAL = new Set(["localhost", "127.0.0.1", ".", "(local)", "::1"]);

/** The part of a server name people actually vary: lower-cased first DNS label, no port, instance or "-ondemand". */
export function hostLabel(endpoint: string): string {
  let host = endpoint.trim().toLowerCase().replace(/^tcp:/, "");
  host = host.split(/[,\\]/)[0];
  if (!/^\d+(\.\d+){3}$/.test(host)) host = host.split(".")[0] || host;
  return host.replace(/-ondemand$/, "");
}

function nameFor(token: string): string {
  return token
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((t) => TOKEN_NAMES[t] ?? t.charAt(0).toUpperCase() + t.slice(1))
    .join(" ");
}

/**
 * Suggests an environment per connection from naming conventions. Finds, for each server, the
 * longest prefix shared by a family of at least three servers (e.g. "acmedwh" in acmedwhuat,
 * acmedwhdev, acmedwhsupport) and uses what follows it ("uat", "dev", "support") as the
 * environment, so the user's own convention decides, not a keyword list. Servers with no family
 * fall back to keywords. Returns one suggestion (or undefined) per candidate, in order.
 */
export function suggestEnvironments(candidates: ImportCandidate[]): (string | undefined)[] {
  const labels = candidates.map((c) => hostLabel(c.endpoint));
  const distinct = [...new Set(labels)];

  return candidates.map((c, i) => {
    const label = labels[i];
    if (LOCAL.has(label)) return "Local";

    const sharing = (prefix: string) => distinct.filter((l) => l.startsWith(prefix)).length;
    const needed = Math.max(FAMILY_SIZE, Math.ceil(sharing(label.slice(0, MIN_PREFIX)) / 2));
    for (let len = label.length - 1; len >= MIN_PREFIX; len--) {
      if (sharing(label.slice(0, len)) < needed) continue;
      const token = label.slice(len).replace(/^[-_.\d]+|[-_.\d]+$/g, "");
      if (token.length >= 2) return nameFor(token);
      break; // The bare family name ("acmedwh" itself): don't guess.
    }

    const text = [c.endpoint, c.database ?? "", c.name].map(hostOrText).join(" ").replace(/[_\d]+/g, " ");
    return KEYWORDS.find(([, re]) => re.test(text))?.[0];
  });
}

/** Keyword matching looks at the varying part of host names and the full text of everything else. */
const hostOrText = (s: string) => (s.includes(".") || s.includes(",") || s.includes("\\") ? hostLabel(s) : s);

const STYLES: Record<string, { color: string; readOnly: boolean }> = {
  Prod: { color: "#e03131", readOnly: true },
  UAT: { color: "#f08c00", readOnly: false },
  Test: { color: "#1971c2", readOnly: false },
  Dev: { color: "#2f9e44", readOnly: false },
  Local: { color: "#868e96", readOnly: false },
};
const OTHER_COLORS = ["#7048e8", "#0c8599", "#e8590c", "#d6336c", "#66a80f"];

/** Colour and read-only default for a new environment. Prod starts read-only. */
export function envStyleFor(name: string, index = 0): { color: string; readOnly: boolean } {
  return STYLES[name] ?? { color: OTHER_COLORS[index % OTHER_COLORS.length], readOnly: false };
}

const LIFECYCLE = ["Dev", "Test", "UAT", "Prod"];
const OTHER = "Other connections";

const keyOf = (c: ImportCandidate) => `${c.endpoint.toLowerCase().replace(/^tcp:/, "")}|${c.user ?? ""}|${c.database ?? ""}`;

/**
 * Turns scanned sources into proposed environments. Groups a source tool defined are kept unless
 * byPattern is set; everything else (SSMS connection history, or all of it with byPattern) is
 * grouped by suggested environment, merged across sources. Order: Dev, Test, UAT, Prod, then other
 * suggestions alphabetically, then "Other connections". A connection seen in an earlier source is dropped.
 */
export function planGroups(sources: ImportSource[], { byPattern = false }: { byPattern?: boolean } = {}): PlanGroup[] {
  const seen = new Set<string>();
  const kept: PlanGroup[] = [];
  const toSuggest: ImportCandidate[] = [];

  for (const source of sources) {
    for (const group of source.groups) {
      const fresh = group.connections.filter((c) => {
        const k = keyOf(c);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (fresh.length === 0) continue;
      if (byPattern || source.source === "ssms-recent") toSuggest.push(...fresh);
      else kept.push({ key: `${source.path}|${group.name}`, sourceLabel: source.label, name: group.name, suggested: false, candidates: fresh });
    }
  }

  const buckets = new Map<string, ImportCandidate[]>();
  suggestEnvironments(toSuggest).forEach((env, i) => {
    const name = env ?? OTHER;
    buckets.set(name, [...(buckets.get(name) ?? []), toSuggest[i]]);
  });

  const rank = (name: string) => (name === OTHER ? 2 : LIFECYCLE.includes(name) ? 0 : 1);
  const suggested = [...buckets.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || (rank(a) === 0 ? LIFECYCLE.indexOf(a) - LIFECYCLE.indexOf(b) : a.localeCompare(b)))
    .map(([name, candidates]) => ({
      key: `suggested|${name}`,
      sourceLabel: "Suggested from server names",
      name,
      suggested: name !== OTHER,
      candidates,
    }));

  return [...kept, ...suggested];
}
