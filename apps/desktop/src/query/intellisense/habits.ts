// T-SQL habits in the Postgres editor (docs/plans/2026-10-30-postgres-design.md, "T-SQL habits lint"): warnings before
// running, with a quick fix where the Postgres form is certain. Pure: it runs in the IntelliSense worker on the pgsql
// scanner's tokens, needs no catalog, and checks the whole script. Precision over recall, as in lint.ts: anything that
// is also valid Postgres (an array subscript, date arithmetic, the ISNULL operator) is left alone.

import type { Warning } from "./lint";
import { isGo, statementAt, tokenize, type Token } from "./scanner";

export type { Warning };

/** Types whose literal ('2020-01-01', '1 day') makes + arithmetic, not concatenation. */
const TYPED_LITERALS = new Set(["date", "time", "timestamp", "timestamptz", "interval"]);
/** Function name to its Postgres form and what to say. */
const FUNCTIONS: Record<string, { to: string; call: boolean; message: string }> = {
  getdate: { to: "now()", call: true, message: "GETDATE() is T-SQL. Postgres uses now() (the start of the transaction) or clock_timestamp()." },
  sysdatetime: { to: "now()", call: true, message: "SYSDATETIME() is T-SQL. Postgres uses now() (the start of the transaction) or clock_timestamp()." },
  isnull: { to: "coalesce", call: false, message: "ISNULL(a, b) is T-SQL. Postgres uses coalesce(a, b)." },
  len: { to: "length", call: false, message: "LEN is T-SQL. Postgres uses length; note it counts trailing spaces, which LEN does not." },
};

const word = (t: Token | undefined) => (t?.type === "word" ? t.text.toLowerCase() : "");
const adjacent = (a: Token | undefined, b: Token | undefined) => !!a && !!b && a.end === b.start;

/** The text inside a string literal, without its quotes or E prefix. */
function literal(t: Token): string {
  const body = t.text.replace(/^[eE]/, "");
  return body.startsWith("'") ? body.slice(1, t.closed ? -1 : undefined) : "";
}

/** Index of the ")" closing the "(" at open, or -1. */
function closing(tokens: Token[], open: number): number {
  let depth = 0;
  for (let j = open; j < tokens.length; j++) {
    if (tokens[j].text === "(") depth++;
    else if (tokens[j].text === ")" && --depth === 0) return j;
  }
  return -1;
}

/** The innermost "(" around index i, or -1. */
function enclosing(tokens: Token[], i: number): number {
  let depth = 0;
  for (let j = i - 1; j >= 0; j--) {
    if (tokens[j].text === ")") depth++;
    else if (tokens[j].text === "(" && depth-- === 0) return j;
  }
  return -1;
}

/**
 * Warnings for T-SQL written in a Postgres script. defines says whether the database has a function of that name
 * (a port's compatibility shim), in which case calling it is not a habit.
 */
export function tsqlHabits(text: string, defines: (name: string) => boolean = () => false): Warning[] {
  const all = tokenize(text, "pgsql");
  const tokens = all.filter((t) => t.type !== "comment");
  const warnings: Warning[] = [];
  const replace = (t: { start: number; end: number }, to: string, message: string) =>
    warnings.push({ start: t.start, end: t.end, message, fix: { label: to, edits: [{ start: t.start, end: t.end, text: to }] } });

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    const w = word(t);

    if (w === "top" && ["select", "distinct", "all"].includes(word(prev))) {
      warnings.push(top(text, tokens, i));
    } else if (t.text === "[" && t.type === "punct") {
      const subscript = (adjacent(prev, t) && (["word", "quoted", "number", "string"].includes(prev.type) || prev.text === ")" || prev.text === "]")) || word(prev) === "array";
      const close = text.indexOf("]", t.start + 1);
      const name = close > 0 ? text.slice(t.start + 1, close) : "";
      const plain = all.every((a) => a.end <= t.start || a.start >= close || (a.type !== "string" && a.type !== "comment" && a.type !== "quoted"));
      if (subscript || !name.trim() || /[\n[]/.test(name) || /^[\s\d:,+\-*/$()]*$/.test(name) || !plain) continue;
      const quoted = `"${name.replaceAll('"', '""')}"`;
      replace(
        { start: t.start, end: close + 1 },
        quoted,
        `[${name}] is T-SQL quoting. Postgres writes ${quoted}; unquoted names fold to lower case, so ${name} without quotes means ${name.toLowerCase()}.`,
      );
      while (tokens[i + 1] && tokens[i + 1].start <= close) i++;
    } else if (FUNCTIONS[w] && next?.text === "(" && prev?.text !== "." && !defines(w)) {
      const f = FUNCTIONS[w];
      if (!f.call) replace(t, f.to, f.message);
      else if (tokens[i + 2]?.text === ")") replace({ start: t.start, end: tokens[i + 2].end }, f.to, f.message);
    } else if (t.text === "+" && t.type === "punct" && (concatenates(tokens, i - 1, "before") || concatenates(tokens, i + 1, "after"))) {
      replace(t, "||", "+ does not join text in Postgres. Use ||.");
    } else if (t.text === "@" && next?.type === "word" && adjacent(t, next) && (!prev || !adjacent(prev, t) || "(,=".includes(prev.text))) {
      warnings.push({ start: t.start, end: next.end, message: "@variables are T-SQL. Postgres variables live in DO blocks and functions: DECLARE them inside the $$ body, without @." });
    } else if (t.text === "#" && next?.type === "word" && adjacent(t, next) && (!prev || !adjacent(prev, t) || "(,".includes(prev.text))) {
      warnings.push({ start: t.start, end: next.end, message: "#temp tables are T-SQL. Postgres uses CREATE TEMP TABLE name, without #; it lasts until the session ends." });
    } else if (w === "nolock") {
      const hint = prev?.text === "(" && word(tokens[i - 2]) === "with" && next?.text === ")";
      warnings.push({ start: hint ? tokens[i - 2].start : t.start, end: hint ? next.end : t.end, message: "NOLOCK is T-SQL. In Postgres readers never block writers, so there is nothing to ask for: remove it." });
    } else if (w === "go" && isGo(text, t.start, t.end)) {
      warnings.push({ start: t.start, end: t.end, message: "GO is not a Postgres batch separator. End each statement with a semicolon." });
    }
  }
  return warnings.sort((a, b) => a.start - b.start);
}

/** True when the token at i is a text literal on the given side of a +, not a typed literal ('1 day', date '...'). */
function concatenates(tokens: Token[], i: number, side: "before" | "after"): boolean {
  const t = tokens[i];
  if (t?.type !== "string" || !t.text.replace(/^[eE]/, "").startsWith("'")) return false;
  if (/^\s*[-+.]?\d/.test(literal(t))) return false;
  if (side === "before" && TYPED_LITERALS.has(word(tokens[i - 1]))) return false;
  if (tokens[i + 1]?.text === ":" && tokens[i + 2]?.text === ":") return false;
  return true;
}

/** SELECT TOP n: the warning, with a fix that moves it to a LIMIT at the end of its query when that is certain. */
function top(text: string, tokens: Token[], i: number): Warning {
  const t = tokens[i];
  let count: Token | undefined;
  let last = i;
  if (tokens[i + 1]?.type === "number") [count, last] = [tokens[i + 1], i + 1];
  else if (tokens[i + 1]?.text === "(" && tokens[i + 2]?.type === "number" && tokens[i + 3]?.text === ")") [count, last] = [tokens[i + 2], i + 3];
  const n = count?.text ?? "n";
  const warning: Warning = { start: t.start, end: tokens[last].end, message: `TOP is T-SQL. Postgres ends the query with LIMIT ${n}.` };
  const after = word(tokens[last + 1]);
  if (!count || after === "percent" || (after === "with" && word(tokens[last + 2]) === "ties")) return warning;

  // The query ends at the ")" around the TOP's SELECT, or at the end of its statement.
  const open = enclosing(tokens, i);
  let scope: Token[];
  if (open >= 0) {
    const close = closing(tokens, open);
    if (close < 0) return warning;
    scope = tokens.slice(i, close);
  } else {
    const statement = statementAt(text, t.start, "pgsql");
    scope = tokens.filter((s) => s.start >= t.start && s.end <= statement.end && s.text !== ";");
  }
  const end = scope[scope.length - 1];
  if (!end || end === tokens[last] || scope.some((s) => word(s) === "limit")) return warning;

  let removeTo = tokens[last].end;
  while (text[removeTo] === " " || text[removeTo] === "\t") removeTo++;
  const keyword = t.text === t.text.toUpperCase() ? "LIMIT" : "limit";
  warning.fix = {
    label: `${keyword} ${n}`,
    edits: [
      { start: t.start, end: removeTo, text: "" },
      { start: end.end, end: end.end, text: ` ${keyword} ${n}` },
    ],
  };
  return warning;
}
