import type { ImportCandidate, ImportSource } from "./api";

export interface PlanGroup {
  key: string;
  sourceLabel: string;
  /** Proposed environment name: the source tool's group, or one suggested from names. */
  name: string;
  /** True when the name was inferred rather than defined in the source tool. */
  suggested: boolean;
  candidates: ImportCandidate[];
}

/**
 * Environment rules, first match wins. `words` match as a separate word anywhere (orders-uat,
 * uat-orders, orders.uat.corp); `glued` also match at the end of a word with at least three letters
 * before it (ordersuat). Never mid-word, so product, devonshire and testament don't match.
 * Order matters: Pre-prod and Non-prod before Prod.
 */
const RULES: { env: string; words: string; glued?: string }[] = [
  { env: "Pre-prod", words: "pre-?prod", glued: "preprod" },
  { env: "Non-prod", words: "non-?prod" },
  { env: "Prod", words: "prod|prd|production", glued: "prod|prd" },
  { env: "Staging", words: "staging|stage|stg", glued: "staging|stage|stg" },
  { env: "UAT", words: "uat", glued: "uat" },
  { env: "SIT", words: "sit" },
  { env: "QA", words: "qa", glued: "qa" },
  { env: "Test", words: "test|tst", glued: "test" },
  { env: "Dev", words: "dev|develop|development", glued: "dev" },
  { env: "Sandbox", words: "sandbox|sbx", glued: "sandbox|sbx" },
  { env: "DR", words: "dr" },
  { env: "Demo", words: "demo" },
  { env: "Perf", words: "perf" },
  { env: "Training", words: "training|train" },
  { env: "Hotfix", words: "hotfix" },
  { env: "Lower", words: "lower" },
];

const COMPILED = RULES.map((r) => ({
  env: r.env,
  word: new RegExp(`(^|[^a-z])(${r.words})([^a-z]|$)`),
  glued: r.glued ? new RegExp(`^[a-z]{3,}(${r.glued})$`) : undefined,
}));

const REGIONS: Record<string, string> = {
  uk: "UK",
  us: "US",
  eu: "EU",
  uksouth: "UK South",
  ukwest: "UK West",
  eastus: "East US",
  eastus2: "East US 2",
  westus: "West US",
  westus2: "West US 2",
  westeurope: "West Europe",
  northeurope: "North Europe",
  australiaeast: "Australia East",
  canadacentral: "Canada Central",
};

const LOCAL = new Set(["localhost", "127.0.0.1", ".", "(local)", "::1"]);
const CLOUD_SUFFIX = /\.(database\.windows\.net|sql\.azuresynapse\.net|documents\.azure\.com|database\.azure\.com)$/;

/** The environment named in some text (server, database, display or folder name), by the rule table. */
export function envFromText(text: string): string | undefined {
  const t = text.toLowerCase().replace(/\d+/g, " ");
  const segments = t.split(/[^a-z]+/).filter(Boolean);
  return COMPILED.find((r) => r.word.test(t) || (r.glued && segments.some((s) => r.glued!.test(s))))?.env;
}

/** Server name without protocol, port, instance, cloud domain or Synapse's -ondemand. */
function host(endpoint: string): string {
  return endpoint.trim().toLowerCase().replace(/^tcp:/, "").split(/[,\\]/)[0].replace(CLOUD_SUFFIX, "").replace(/-ondemand/, "");
}

function region(h: string): string | undefined {
  return h.split(/[^a-z0-9]+/).map((s) => REGIONS[s]).find(Boolean);
}

/**
 * Glued names with no environment word: the longest prefix shared by a family of at least three
 * servers and by at least half of the servers that share its first four characters (acmedwh in
 * acmedwhsupport, acmedwhuat...). What follows it is the environment, so house words like
 * "Support" group together. The half rule stops a sub-family (acmedwhs: support, sandbox, stage) winning.
 */
function familySuffixes(labels: string[]): (string | undefined)[] {
  const distinct = [...new Set(labels.filter(Boolean))];
  const sharing = (prefix: string) => distinct.filter((l) => l.startsWith(prefix)).length;
  return labels.map((label) => {
    if (label.length <= 4) return undefined;
    const needed = Math.max(3, Math.ceil(sharing(label.slice(0, 4)) / 2));
    for (let len = label.length - 1; len >= 4; len--) {
      if (sharing(label.slice(0, len)) < needed) continue;
      const token = label.slice(len);
      return token.length >= 2 ? token : undefined;
    }
  });
}

const display = (token: string) => REGIONS[token] ?? token.charAt(0).toUpperCase() + token.slice(1);

/**
 * One suggestion (or undefined) per candidate: Local; the rule table on the server name; then on the
 * database or display name; then the family-prefix fallback for glued house words. Regions are
 * appended (Prod UK).
 */
export function suggestEnvironments(candidates: ImportCandidate[]): (string | undefined)[] {
  const hosts = candidates.map((c) => host(c.endpoint));
  const family = familySuffixes(hosts.map((h) => (/^\d+(\.\d+){3}$/.test(h) ? "" : h.split(/[.\-_]/)[0])));

  return candidates.map((c, i) => {
    const h = hosts[i];
    if (LOCAL.has(h)) return "Local";
    const env =
      envFromText(h) ??
      envFromText(c.database ?? "") ??
      (c.name !== c.endpoint ? envFromText(c.name) : undefined) ??
      (family[i] ? display(family[i]!) : undefined);
    if (!env) return undefined;
    const r = region(h);
    return r && !env.includes(r) ? `${env} ${r}` : env;
  });
}

const STYLES: Record<string, { color: string; readOnly: boolean }> = {
  Prod: { color: "#e03131", readOnly: true },
  "Pre-prod": { color: "#e8590c", readOnly: false },
  Staging: { color: "#f08c00", readOnly: false },
  UAT: { color: "#f08c00", readOnly: false },
  SIT: { color: "#1971c2", readOnly: false },
  QA: { color: "#1971c2", readOnly: false },
  Test: { color: "#1971c2", readOnly: false },
  Dev: { color: "#2f9e44", readOnly: false },
  Local: { color: "#868e96", readOnly: false },
};
const OTHER_COLORS = ["#7048e8", "#0c8599", "#d6336c", "#66a80f", "#5c7cfa"];

/** Colour and read-only default for a new environment, by its first word. Prod (and Prod UK...) starts read-only. */
export function envStyleFor(name: string, index = 0): { color: string; readOnly: boolean } {
  return STYLES[name] ?? STYLES[name.split(" ")[0]] ?? { color: OTHER_COLORS[index % OTHER_COLORS.length], readOnly: false };
}

const LIFECYCLE = ["Local", "Dev", "Test", "QA", "SIT", "UAT", "Staging", "Pre-prod", "Prod"];
export const OTHER = "Other connections";

export const candidateKey = (c: ImportCandidate) => `${c.endpoint.toLowerCase().replace(/^tcp:/, "")}|${c.user ?? ""}|${c.database ?? ""}`;

/**
 * Turns scanned sources into proposed environments. By default, folders a source tool defined are
 * kept and only ungrouped connections (SSMS connection history) are inferred. With byPattern,
 * everything is regrouped: folders named after an environment ("Production", "Lower environments")
 * still decide, other connections are inferred from their names. Inferred groups merge across
 * sources, in lifecycle order (Dev ... Prod), then alphabetically, then "Other connections".
 * A connection seen in an earlier source is dropped.
 */
export function planGroups(sources: ImportSource[], { byPattern = false }: { byPattern?: boolean } = {}): PlanGroup[] {
  const seen = new Set<string>();
  const kept: PlanGroup[] = [];
  const toInfer: { candidate: ImportCandidate; folderEnv?: string }[] = [];

  for (const source of sources) {
    for (const group of source.groups) {
      const fresh = group.connections.filter((c) => !seen.has(candidateKey(c)) && seen.add(candidateKey(c)));
      if (fresh.length === 0) continue;
      if (byPattern || source.source === "ssms-recent") {
        const folderEnv = source.source === "ssms-recent" ? undefined : envFromText(group.name);
        toInfer.push(...fresh.map((candidate) => ({ candidate, folderEnv })));
      } else {
        kept.push({ key: `${source.path}|${group.name}`, sourceLabel: source.label, name: group.name, suggested: false, candidates: fresh });
      }
    }
  }

  const inferred = suggestEnvironments(toInfer.map((x) => x.candidate));
  const buckets = new Map<string, ImportCandidate[]>();
  toInfer.forEach(({ candidate, folderEnv }, i) => {
    const name = folderEnv ?? inferred[i] ?? OTHER;
    buckets.set(name, [...(buckets.get(name) ?? []), candidate]);
  });

  const stage = (name: string) => LIFECYCLE.indexOf(name.split(" ")[0]);
  const rank = (name: string) => (name === OTHER ? 2 : stage(name) >= 0 ? 0 : 1);
  const suggested = [...buckets.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || (rank(a) === 0 ? stage(a) - stage(b) : 0) || a.localeCompare(b))
    .map(([name, candidates]) => ({
      key: `suggested|${name}`,
      sourceLabel: "Suggested from names and folders",
      name,
      suggested: name !== OTHER,
      candidates,
    }));

  return [...kept, ...suggested];
}
