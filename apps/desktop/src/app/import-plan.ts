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

// Whole-word-ish matches, so "devonshire" and "product" don't count as dev or prod.
const SUGGESTIONS: [string, RegExp][] = [
  ["Prod", /(^|[^a-z])(prod|prd|production|live)([^a-z]|$)|(^|[^a-z])sqlprd/i],
  ["UAT", /(^|[^a-z])(uat|preprod|staging|stg)([^a-z]|$)/i],
  ["Test", /(^|[^a-z])(test|tst|qa)([^a-z]|$)/i],
  ["Dev", /(^|[^a-z])(dev|develop|development)([^a-z]|$)/i],
];

/** Guesses an environment from the server, database and display name. Prod wins ties, to fail safe. */
export function suggestEnvironment(c: ImportCandidate): string | undefined {
  const text = [c.endpoint, c.database ?? "", c.name].join(" ").replace(/[_\d]+/g, " ");
  return SUGGESTIONS.find(([, re]) => re.test(text))?.[0];
}

const STYLES: Record<string, { color: string; readOnly: boolean }> = {
  Prod: { color: "#e03131", readOnly: true },
  UAT: { color: "#f08c00", readOnly: false },
  Test: { color: "#1971c2", readOnly: false },
  Dev: { color: "#2f9e44", readOnly: false },
};
const OTHER_COLORS = ["#7048e8", "#0c8599", "#868e96"];

/** Colour and read-only default for a new environment. Prod starts read-only. */
export function envStyleFor(name: string, index = 0): { color: string; readOnly: boolean } {
  return STYLES[name] ?? { color: OTHER_COLORS[index % OTHER_COLORS.length], readOnly: false };
}

const keyOf = (c: ImportCandidate) => `${c.endpoint.toLowerCase().replace(/^tcp:/, "")}|${c.user ?? ""}|${c.database ?? ""}`;

/**
 * Turns scanned sources into proposed environments. Groups the source tool defined are kept as
 * they are. Flat lists (SSMS connection history) are split by suggested environment, with
 * anything unrecognised left in "Other connections". A connection seen in an earlier source is dropped.
 */
export function planGroups(sources: ImportSource[]): PlanGroup[] {
  const seen = new Set<string>();
  const out: PlanGroup[] = [];

  for (const source of sources) {
    for (const group of source.groups) {
      const fresh = group.connections.filter((c) => {
        const k = keyOf(c);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (fresh.length === 0) continue;

      if (source.source !== "ssms-recent") {
        out.push({ key: `${source.path}|${group.name}`, sourceLabel: source.label, name: group.name, suggested: false, candidates: fresh });
        continue;
      }

      const buckets = new Map<string, ImportCandidate[]>();
      for (const c of fresh) {
        const env = suggestEnvironment(c) ?? "";
        buckets.set(env, [...(buckets.get(env) ?? []), c]);
      }
      const order = [...SUGGESTIONS.map(([name]) => name), ""];
      for (const env of order) {
        const list = buckets.get(env);
        if (!list) continue;
        out.push({
          key: `${source.path}|${env || "other"}`,
          sourceLabel: source.label,
          name: env || "Other connections",
          suggested: env !== "",
          candidates: list,
        });
      }
    }
  }
  return out;
}
