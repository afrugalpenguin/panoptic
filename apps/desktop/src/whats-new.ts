// Reading the bundled changelog for the What's new tab (docs/changelog.md, ADR 0013). Pure functions:
// the view only renders what these return.

export interface ChangelogSection {
  version: string;
  /** yyyy-mm-dd, or empty when the generator had no date. */
  date: string;
  /** Raw markdown under the heading: a bullet list, or one line such as "No user-facing changes." */
  body: string;
}

export type InlineToken =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

const HEADING = /^## v(\d+\.\d+\.\d+)(?: \((\d{4}-\d{2}-\d{2})\))?\s*$/;

/** Splits the generated file on "## v" headings, in file order (the generator writes newest first). */
export function parseChangelog(markdown: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let current: ChangelogSection | undefined;
  let lines: string[] = [];
  const close = () => {
    if (current) sections.push({ ...current, body: lines.join("\n").trim() });
  };
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const m = HEADING.exec(line);
    if (m) {
      close();
      current = { version: m[1], date: m[2] ?? "", body: "" };
      lines = [];
    } else if (current) {
      lines.push(line);
    }
  }
  close();
  return sections;
}

/** Numeric three-part version compare: negative, zero or positive, like a sort comparator. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Sections newer than the last version the user saw, newest first. Never seen (a first install) shows nothing. */
export function sectionsSince(sections: ChangelogSection[], lastSeen: string | null | undefined): ChangelogSection[] {
  if (!lastSeen) return [];
  return sections.filter((s) => compareVersions(s.version, lastSeen) > 0).sort((a, b) => compareVersions(b.version, a.version));
}

/** The bullets of a section body; continuation lines are joined to their bullet with a newline. */
export function bullets(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    if (line.startsWith("- ")) out.push(line.slice(2));
    else if (out.length > 0 && /^\s+\S/.test(line)) out[out.length - 1] += `\n${line.trim()}`;
  }
  return out;
}

export type Category = "Added" | "Changed" | "Fixed" | "Removed";

/** Splits a bullet's leading "Added: " style prefix (the generator writes one on every bullet) from its note. */
export function category(item: string): { category: Category | undefined; text: string } {
  const m = /^(Added|Changed|Fixed|Removed): /.exec(item);
  return m ? { category: m[1] as Category, text: item.slice(m[0].length) } : { category: undefined, text: item };
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-30" as "30 Oct"; empty when there is no date. */
export function shortDate(date: string): string {
  const m = DATE.exec(date);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : "";
}

/** Where the tab was opened from: on launch it holds the unseen releases, from Settings every release. */
export type WhatsNewSource = "launch" | "settings";

/** The masthead line under the title: when the newest release shipped, then what the tab holds. */
export function subtitle(sections: ChangelogSection[], opened: WhatsNewSource, today: Date): string {
  if (sections.length === 0) return "";
  const n = sections.length;
  const holds = opened === "settings" ? "Every release." : `${n} ${n === 1 ? "release" : "releases"} since you last opened it.`;
  const m = DATE.exec(sections[0].date);
  if (!m) return holds;
  const days = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86_400_000);
  const when = days === 0 ? "today" : days === 1 ? "yesterday" : shortDate(sections[0].date);
  return `Updated ${when}. ${holds}`;
}

// The only markdown interpreted: **bold**, `code` and [text](https://...). Everything else is text.
const INLINE = /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g;

export function inlineTokens(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: "bold", text: m[1] });
    else if (m[2] !== undefined) out.push({ type: "code", text: m[2] });
    else out.push({ type: "link", text: m[3], href: m[4] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/** Opens a link through `open` (the opener plugin) and hands any failure, such as a scope denial, to `onError`. */
export async function openLink(href: string, open: (url: string) => Promise<void>, onError: (message: string) => void): Promise<void> {
  try {
    await open(href);
  } catch (e) {
    onError(e instanceof Error ? e.message : String(e));
  }
}
