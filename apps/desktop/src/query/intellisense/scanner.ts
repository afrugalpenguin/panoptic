// Context at the cursor for completions and hover (docs/query-editor.md, "Context resolution"). A scanner, not a
// parser: it tokenizes, finds the statement around the cursor and reads the nearest significant keyword. Pure, so
// it runs in the IntelliSense worker, which cannot load Monaco.

export type Language = "tsql" | "cosmos-sql";

export interface Token {
  type: "word" | "quoted" | "var" | "string" | "comment" | "number" | "punct";
  /** Raw text as typed. */
  text: string;
  /** Identifier without its brackets or quotes; otherwise the raw text. */
  value: string;
  start: number;
  end: number;
  /** False for an unterminated string, comment or quoted name, and for line comments (they run to end of line). */
  closed: boolean;
}

export interface TableRef {
  name: string;
  schema?: string;
  database?: string;
  alias?: string;
}

export type Context =
  /** Tables, views and synonyms; qualifier is the dotted chain typed so far (schema, or database then schema). */
  | { kind: "objects"; qualifier: string[] }
  | { kind: "columns"; tables: TableRef[] }
  | { kind: "aliasColumns"; table: TableRef }
  | { kind: "procs"; qualifier: string[] }
  | { kind: "params"; proc: string; schema?: string }
  | { kind: "variables"; names: string[] }
  | { kind: "types" }
  | { kind: "keywords" }
  | { kind: "cosmosPaths"; prefix: string[] }
  | { kind: "cosmosFrom" }
  /** Inside a string or comment. */
  | { kind: "none" };

export interface CursorContext {
  context: Context;
  /** The partial word before the cursor that completions replace. */
  prefix: string;
  /** Offset where the replaced text starts (includes an opening bracket or @, which prefix may not). */
  start: number;
  /** The database named by the last USE before the cursor. */
  useDatabase?: string;
}

const WORD_START = /[A-Za-z_#\u0080-￿]/;
const WORD_PART = /[\w#$@\u0080-￿]/;

export function tokenize(text: string, language: Language): Token[] {
  const tokens: Token[] = [];
  const n = text.length;
  let i = 0;
  const push = (type: Token["type"], start: number, end: number, closed: boolean, value?: string) =>
    tokens.push({ type, text: text.slice(start, end), value: value ?? text.slice(start, end), start, end, closed });

  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
    } else if (c === "-" && next === "-") {
      const end = text.indexOf("\n", i);
      const stop = end < 0 ? n : end;
      push("comment", i, stop, false);
      i = stop;
    } else if (c === "/" && next === "*") {
      // T-SQL block comments nest.
      let depth = 0;
      let j = i;
      while (j < n) {
        if (text[j] === "/" && text[j + 1] === "*") {
          depth++;
          j += 2;
        } else if (text[j] === "*" && text[j + 1] === "/") {
          depth--;
          j += 2;
          if (depth === 0) break;
        } else j++;
      }
      push("comment", i, j, depth === 0);
      i = j;
    } else if (c === "'" || ((c === "N" || c === "n") && next === "'" && language === "tsql") || (c === '"' && language === "cosmos-sql")) {
      const quote = c === '"' ? '"' : "'";
      let j = text[i] === quote ? i + 1 : i + 2;
      let closed = false;
      while (j < n) {
        if (language === "cosmos-sql" && text[j] === "\\") j += 2;
        else if (text[j] === quote) {
          if (language === "tsql" && text[j + 1] === quote) j += 2;
          else {
            j++;
            closed = true;
            break;
          }
        } else j++;
      }
      push("string", i, Math.min(j, n), closed);
      i = Math.min(j, n);
    } else if ((c === "[" || c === '"') && language === "tsql") {
      const close = c === "[" ? "]" : '"';
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < n) {
        if (text[j] === close) {
          if (text[j + 1] === close) {
            value += close;
            j += 2;
          } else {
            j++;
            closed = true;
            break;
          }
        } else value += text[j++];
      }
      push("quoted", i, j, closed, value);
      i = j;
    } else if (c === "@") {
      let j = i + 1;
      while (j < n && (WORD_PART.test(text[j]) || text[j] === "@")) j++;
      push("var", i, j, true);
      i = j;
    } else if (WORD_START.test(c)) {
      let j = i + 1;
      while (j < n && WORD_PART.test(text[j])) j++;
      push("word", i, j, true);
      i = j;
    } else if (c >= "0" && c <= "9") {
      let j = i + 1;
      while (j < n && /[\d.eE]/.test(text[j])) j++;
      push("number", i, j, true);
      i = j;
    } else {
      push("punct", i, i + 1, true);
      i++;
    }
  }
  return tokens;
}

const lower = (t: Token | undefined) => (t?.type === "word" ? t.text.toLowerCase() : "");

/** A GO batch separator: the word GO alone on its line. */
function isGo(t: Token, text: string): boolean {
  if (lower(t) !== "go") return false;
  const lineStart = text.lastIndexOf("\n", t.start - 1) + 1;
  const lineEnd = text.indexOf("\n", t.end);
  return text.slice(lineStart, t.start).trim() === "" && text.slice(t.end, lineEnd < 0 ? text.length : lineEnd).trim() === "";
}

interface Segment {
  start: number;
  end: number;
}

/** Splits text into statements (at GO lines, semicolons and blank lines) or, with batchesOnly, into GO batches. */
function segments(text: string, tokens: Token[], batchesOnly: boolean): Segment[] {
  const result: Segment[] = [];
  let start = 0;
  let previousEnd = 0;
  const blankLineIn = (from: number, to: number): number => {
    const match = /\n[ \t\r]*\n/.exec(text.slice(from, to));
    return match ? from + match.index : -1;
  };
  for (const t of tokens) {
    if (!batchesOnly) {
      const blank = blankLineIn(previousEnd, t.start);
      if (blank >= 0) {
        result.push({ start, end: blank });
        start = blank + 1;
      }
    }
    if (isGo(t, text) || (!batchesOnly && t.text === ";" && t.type === "punct")) {
      result.push({ start, end: t.start });
      start = t.end;
    }
    previousEnd = t.end;
  }
  if (!batchesOnly) {
    const blank = blankLineIn(previousEnd, text.length);
    if (blank >= 0) {
      result.push({ start, end: blank });
      start = blank + 1;
    }
  }
  result.push({ start, end: text.length });
  return result;
}

function containing(list: Segment[], offset: number): Segment {
  return list.find((s) => s.start <= offset && offset <= s.end) ?? list[list.length - 1];
}

/** The statement around offset: bounded by the nearest GO line, semicolon or blank line on each side. */
export function statementAt(text: string, offset: number, language: Language = "tsql"): Segment {
  return containing(segments(text, tokenize(text, language), false), offset);
}

/** True when the text runs DDL (CREATE, ALTER or DROP as keywords, not in strings, comments or quoted names). */
export function isDdl(text: string): boolean {
  return tokenize(text, "tsql").some((t) => ["create", "alter", "drop"].includes(lower(t)));
}

// Words that cannot be a table alias.
const RESERVED = new Set(
  ("select from where join inner left right full outer cross on group order by having union except intersect with option " +
    "for as set values output apply pivot unpivot when then else end and or not in is like between exists into update delete " +
    "insert exec execute go use declare begin case top distinct null merge using table").split(" "),
);

type ClauseKind = "objects" | "procs" | "columns" | "keywords";
const CLAUSES: Record<string, ClauseKind> = {
  from: "objects", join: "objects", update: "objects", into: "objects", table: "objects", delete: "objects", merge: "objects", using: "objects",
  exec: "procs", execute: "procs",
  select: "columns", where: "columns", on: "columns", by: "columns", having: "columns", set: "columns", and: "columns", or: "columns",
  not: "columns", when: "columns", then: "columns", else: "columns", case: "columns", distinct: "columns", top: "columns", is: "columns",
  in: "columns", like: "columns", between: "columns",
  union: "keywords", except: "keywords", intersect: "keywords", group: "keywords", order: "keywords", inner: "keywords", left: "keywords",
  right: "keywords", outer: "keywords", cross: "keywords", full: "keywords", declare: "keywords", begin: "keywords", if: "keywords",
  while: "keywords", return: "keywords", print: "keywords", use: "keywords", values: "keywords", as: "keywords", with: "keywords",
};
// "as" is in CLAUSES only so a trailing AS is recognised; scanning skips it so "select a as x, |" is still the select list.
const SCAN_SKIP = new Set(["as"]);

const isName = (t: Token | undefined) => !!t && (t.type === "quoted" || t.type === "word");
const isAlias = (t: Token | undefined) => !!t && (t.type === "quoted" || (t.type === "word" && !RESERVED.has(lower(t))));

/** Reads a dotted name starting at i. */
function dottedName(tokens: Token[], i: number): { parts: string[]; next: number } {
  const parts: string[] = [];
  let j = i;
  while (isName(tokens[j])) {
    parts.push(tokens[j].value);
    if (tokens[j + 1]?.text === "." && tokens[j + 1].type === "punct") j += 2;
    else {
      j++;
      break;
    }
  }
  return { parts, next: j };
}

function toRef(parts: string[], alias?: string): TableRef {
  const ref: TableRef = { name: parts[parts.length - 1] };
  if (parts.length >= 2) ref.schema = parts[parts.length - 2];
  if (parts.length >= 3) ref.database = parts[parts.length - 3];
  if (alias) ref.alias = alias;
  return ref;
}

/** Index of the parenthesis matching the "(" at open, or tokens.length. */
function matching(tokens: Token[], open: number): number {
  let depth = 0;
  for (let j = open; j < tokens.length; j++) {
    if (tokens[j].text === "(") depth++;
    else if (tokens[j].text === ")" && --depth === 0) return j;
  }
  return tokens.length;
}

/** Tables named after FROM, JOIN, UPDATE and INTO in tokens[start, end), at that paren depth only. */
function tableRefs(tokens: Token[], start: number, end: number): TableRef[] {
  const refs: TableRef[] = [];
  const read = (i: number): number => {
    if (tokens[i]?.text === "(") {
      // A derived table: skip it and its alias.
      let j = matching(tokens, i) + 1;
      if (lower(tokens[j]) === "as") j++;
      return isAlias(tokens[j]) ? j + 1 : j;
    }
    const { parts, next } = dottedName(tokens, i);
    if (parts.length === 0 || RESERVED.has(parts[0].toLowerCase())) return i;
    let j = next;
    if (lower(tokens[j]) === "as") j++;
    const alias = isAlias(tokens[j]) ? tokens[j++].value : undefined;
    refs.push(toRef(parts, alias));
    return j;
  };
  for (let i = start; i < end; i++) {
    const t = tokens[i];
    if (t.text === "(") {
      i = matching(tokens, i);
      continue;
    }
    const w = lower(t);
    if (w === "from" || w === "join" || w === "update" || w === "into" || w === "delete") {
      let j = read(i + 1);
      while (w === "from" && tokens[j]?.text === "," && j < end) j = read(j + 1);
      i = j - 1;
    }
  }
  return refs;
}

/** Variables declared in the batch: DECLARE lists and a CREATE/ALTER PROCEDURE or FUNCTION header. */
function declaredVariables(tokens: Token[]): string[] {
  const names = new Map<string, string>();
  const stops = new Set(["select", "set", "insert", "update", "delete", "exec", "execute", "if", "while", "begin", "return", "print", "with"]);
  let mode: "none" | "declare" | "header" = "none";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const w = lower(t);
    if (w === "declare") mode = "declare";
    else if ((w === "create" || w === "alter") && ["proc", "procedure", "function"].includes(lower(tokens[i + 1]))) mode = "header";
    else if (mode === "header" && (w === "as" || w === "returns")) mode = "none";
    else if (mode === "declare" && (t.text === ";" || stops.has(w))) mode = "none";
    else if (t.type === "var" && !t.text.startsWith("@@") && t.text.length > 1) {
      const prev = tokens[i - 1];
      const declares = mode === "header" || (mode === "declare" && (lower(prev) === "declare" || prev?.text === ","));
      if (declares && !names.has(t.text.toLowerCase())) names.set(t.text.toLowerCase(), t.text);
    }
  }
  return [...names.values()];
}

/** True when the variable at the end of tokens is being declared, so a type comes next. */
function declaringVariable(tokens: Token[]): boolean {
  const prev = tokens[tokens.length - 2];
  if (lower(prev) === "declare") return true;
  const first = lower(tokens[0]);
  const header = (first === "create" || first === "alter") && ["proc", "procedure", "function"].includes(lower(tokens[1]));
  if (header && !tokens.slice(0, -1).some((t) => lower(t) === "as")) return true;
  if (prev?.text !== ",") return false;
  for (let i = tokens.length - 3; i >= 0; i--) {
    const w = lower(tokens[i]);
    if (w === "declare") return true;
    if (w && CLAUSES[w] && w !== "as") return false;
  }
  return false;
}

/** The innermost "(" not closed before the end of tokens, and the ones outside it, innermost first. */
function unmatchedOpens(tokens: Token[]): number[] {
  const opens: number[] = [];
  let depth = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i].text === ")") depth++;
    else if (tokens[i].text === "(") {
      if (depth > 0) depth--;
      else opens.push(i);
    }
  }
  return opens;
}

/** The nearest clause keyword before the end, skipping parenthesised groups that are already closed. */
function nearestClause(tokens: Token[]): { kind: ClauseKind; index: number } | undefined {
  let depth = 0;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (t.text === ")") depth++;
    else if (t.text === "(") depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const w = lower(t);
      if (w && CLAUSES[w] && !SCAN_SKIP.has(w)) return { kind: CLAUSES[w], index: i };
    }
  }
  return undefined;
}

/** The tables named in the statement around offset (for hover). */
export function tablesAt(text: string, offset: number, language: Language): TableRef[] {
  const all = tokenize(text, language);
  const statement = containing(segments(text, all, false), offset);
  const stmt = all.filter((t) => t.type !== "comment" && t.start >= statement.start && t.end <= statement.end);
  return tableRefs(stmt, 0, stmt.length);
}

export function contextAt(text: string, offset: number, language: Language): CursorContext {
  const all = tokenize(text, language);
  const inside = all.find((t) => t.start < offset && (offset < t.end || (offset === t.end && !t.closed)));
  if (inside && (inside.type === "string" || inside.type === "comment")) return { context: { kind: "none" }, prefix: "", start: offset };

  let prefix = "";
  let prefixStart = offset;
  const word = all.find((t) => (t.type === "word" || t.type === "var" || t.type === "quoted") && t.start < offset && offset <= t.end);
  if (word && !(word.type === "quoted" && word.closed && offset === word.end)) {
    prefixStart = word.start;
    const raw = text.slice(word.start, offset);
    prefix = word.type === "quoted" ? raw.slice(1).replaceAll("]]", "]") : raw;
  }

  const significant = all.filter((t) => t.type !== "comment");
  let useDatabase: string | undefined;
  for (let i = 0; i < significant.length && significant[i].end <= prefixStart; i++)
    if (lower(significant[i]) === "use" && isName(significant[i + 1]) && significant[i + 1].end <= prefixStart) useDatabase = significant[i + 1].value;
  const done = (context: Context): CursorContext =>
    useDatabase ? { context, prefix, start: prefixStart, useDatabase } : { context, prefix, start: prefixStart };

  const statement = containing(segments(text, all, false), offset);
  const stmt = significant.filter((t) => t.start >= statement.start && t.end <= statement.end && t.start !== prefixStart);
  const before = stmt.filter((t) => t.end <= prefixStart);
  const last = before[before.length - 1];

  if (prefix.startsWith("@")) {
    const batch = containing(segments(text, all, true), offset);
    return done({ kind: "variables", names: declaredVariables(significant.filter((t) => t.start >= batch.start && t.end <= batch.end)) });
  }

  // alias. / schema. / database.schema.
  if (last?.text === "." && last.type === "punct") {
    const parts: string[] = [];
    let i = before.length - 1;
    while (i >= 1 && before[i].text === ".") {
      // Cosmos array index: lines[0]. reads as lines[].
      let j = i - 1;
      let suffix = "";
      if (language === "cosmos-sql" && before[j]?.text === "]") {
        while (j > 0 && before[j].text !== "[") j--;
        j--;
        suffix = "[]";
      }
      if (!isName(before[j])) break;
      parts.unshift(before[j].value + suffix);
      i = j - 1;
    }
    if (language === "cosmos-sql") return done({ kind: "cosmosPaths", prefix: parts.slice(1) });
    const clause = nearestClause(before.slice(0, i + 1));
    if (clause?.kind === "objects") return done({ kind: "objects", qualifier: parts });
    if (clause?.kind === "procs") return done({ kind: "procs", qualifier: parts });
    const tables = tableRefs(stmt, 0, stmt.length);
    const name = parts[parts.length - 1];
    const schema = parts.length >= 2 ? parts[parts.length - 2] : undefined;
    const eq = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
    const found =
      (parts.length === 1 && tables.find((t) => eq(t.alias, name))) ||
      tables.find((t) => eq(t.name, name) && (!schema || eq(t.schema, schema)));
    return done({ kind: "aliasColumns", table: found || toRef(parts) });
  }

  if (language === "cosmos-sql") {
    const clause = nearestClause(before);
    if (clause && lower(before[clause.index]) === "from") return done(clause.index === before.length - 1 ? { kind: "cosmosFrom" } : { kind: "keywords" });
    return done({ kind: "keywords" });
  }

  // Types: CONVERT( ... | CAST(x AS | ... DECLARE @x |
  const opens = unmatchedOpens(before);
  if (last?.text === "(" && ["convert", "try_convert"].includes(lower(before[before.length - 2]))) return done({ kind: "types" });
  if (lower(last) === "as") {
    const cast = opens.length > 0 && ["cast", "try_cast"].includes(lower(before[opens[0] - 1]));
    return done(cast ? { kind: "types" } : { kind: "none" });
  }
  if (last?.type === "var" && declaringVariable(before)) return done({ kind: "types" });

  const clause = nearestClause(before);
  if (!clause) return done({ kind: "keywords" });
  const after = before.slice(clause.index + 1);

  switch (clause.kind) {
    case "objects":
      return done(after.length === 0 || last?.text === "," ? { kind: "objects", qualifier: [] } : { kind: "keywords" });
    case "procs": {
      const { parts } = dottedName(before, clause.index + 1);
      if (parts.length === 0) return done({ kind: "procs", qualifier: [] });
      const ref = toRef(parts);
      return done(ref.schema ? { kind: "params", proc: ref.name, schema: ref.schema } : { kind: "params", proc: ref.name });
    }
    case "columns": {
      // Inside a subquery, its own tables; otherwise the statement's, ignoring nested subqueries.
      const subquery = opens.find((o) => lower(before[o + 1]) === "select");
      const start = subquery === undefined ? 0 : subquery + 1;
      const end = subquery === undefined ? stmt.length : matching(stmt, subquery);
      return done({ kind: "columns", tables: tableRefs(stmt, start, end) });
    }
    default:
      return done({ kind: "keywords" });
  }
}
