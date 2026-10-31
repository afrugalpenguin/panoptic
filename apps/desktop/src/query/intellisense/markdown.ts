// Escaping for markdown built from database text (hover, error glyphs). Kept tiny: the main thread imports it.

/**
 * Catalog text (names, types, paths) as literal markdown: every ASCII punctuation character backslash-escaped, which
 * renders the same but can never form a link, emphasis, autolink or HTML. Names come from the database, not us.
 */
export function mdText(s: string): string {
  return s.replace(/[!-/:-@[-`{-~]/g, "\\$&");
}

/** A name as a code span, fenced past any backticks inside it so it cannot close the span early. */
export function mdCode(s: string): string {
  const longest = Math.max(0, ...(s.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = s.startsWith("`") || s.endsWith("`") ? " " : "";
  return `${fence}${pad}${s}${pad}${fence}`;
}
