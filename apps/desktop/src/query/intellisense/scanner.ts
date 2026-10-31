// Context at the cursor for completions and hover (docs/query-editor.md, "Context resolution"). A scanner, not a
// parser: it finds the statement around the cursor, tokenizes it and reads the nearest significant keyword. Pure, so
// it runs in the IntelliSense worker, which cannot load Monaco.

export type Language = "tsql" | "cosmos-sql" | "pgsql";

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
// Postgres identifiers: # and @ are operators there, not temp tables and variables.
const PG_WORD_START = /[A-Za-z_\u0080-￿]/;
const PG_WORD_PART = /[\w$\u0080-￿]/;
/** A dollar quote's opening tag at the start of the text: $$ or $tag$. */
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-￿][\w\u0080-￿]*)?\$/;

/** Tokens of text[from, to). from and to must not fall inside a token: 0, the end, or a statement boundary. */
export function tokenize(text: string, language: Language, from = 0, to = text.length): Token[] {
  const tokens: Token[] = [];
  lex(text, language, from, to, (type, start, end, closed) => void tokens.push(token(text, type, start, end, closed)));
  return tokens;
}

function token(text: string, type: Token["type"], start: number, end: number, closed: boolean): Token {
  const raw = text.slice(start, end);
  let value = raw;
  if (type === "quoted") {
    const close = raw[0] === "[" ? "]" : '"';
    value = raw.slice(1, closed ? -1 : undefined).replaceAll(close + close, close);
  }
  return { type, text: raw, value, start, end, closed };
}

/**
 * Walks the tokens of text[from, to) without building them, so finding statement boundaries in a long script stays
 * cheap. emit returns true to stop.
 */
function lex(
  text: string,
  language: Language,
  from: number,
  to: number,
  emit: (type: Token["type"], start: number, end: number, closed: boolean) => boolean | void,
): void {
  const n = to;
  const pg = language === "pgsql";
  const wordStart = pg ? PG_WORD_START : WORD_START;
  const wordPart = pg ? PG_WORD_PART : WORD_PART;
  let i = from;
  let stop = false;
  const push = (type: Token["type"], start: number, end: number, closed: boolean) => {
    if (emit(type, start, end, closed)) stop = true;
  };

  while (i < n && !stop) {
    const c = text[i];
    const next = text[i + 1];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
    } else if (c === "-" && next === "-") {
      const end = text.indexOf("\n", i);
      const lineEnd = end < 0 || end > n ? n : end;
      push("comment", i, lineEnd, false);
      i = lineEnd;
    } else if (c === "/" && next === "*") {
      // T-SQL and Postgres block comments nest.
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
    } else if (
      c === "'" ||
      ((c === "N" || c === "n") && next === "'" && language === "tsql") ||
      ((c === "E" || c === "e") && next === "'" && pg) ||
      (c === '"' && language === "cosmos-sql")
    ) {
      const quote = c === '"' ? '"' : "'";
      // Cosmos strings and Postgres E'' strings take backslash escapes.
      const escapes = language === "cosmos-sql" || (pg && c !== "'");
      let j = text[i] === quote ? i + 1 : i + 2;
      let closed = false;
      while (j < n) {
        if (escapes && text[j] === "\\") j += 2;
        else if (text[j] === quote) {
          if (language !== "cosmos-sql" && text[j + 1] === quote) j += 2;
          else {
            j++;
            closed = true;
            break;
          }
        } else j++;
      }
      push("string", i, Math.min(j, n), closed);
      i = Math.min(j, n);
    } else if (c === "$" && pg && DOLLAR_TAG.test(text.slice(i, i + 64))) {
      // $$ body $$ or $tag$ body $tag$: a string, whatever it holds.
      const tag = DOLLAR_TAG.exec(text.slice(i, i + 64))![0];
      const close = text.indexOf(tag, i + tag.length);
      const closed = close >= 0 && close + tag.length <= n;
      const end = closed ? close + tag.length : n;
      push("string", i, end, closed);
      i = end;
    } else if (c === "$" && pg && next >= "0" && next <= "9") {
      let j = i + 1;
      while (j < n && text[j] >= "0" && text[j] <= "9") j++;
      push("var", i, j, true);
      i = j;
    } else if ((c === "[" && language === "tsql") || (c === '"' && (language === "tsql" || pg))) {
      const close = c === "[" ? "]" : '"';
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (text[j] === close) {
          if (text[j + 1] === close) j += 2;
          else {
            j++;
            closed = true;
            break;
          }
        } else j++;
      }
      push("quoted", i, Math.min(j, n), closed);
      i = j;
    } else if (c === "@" && !pg) {
      let j = i + 1;
      while (j < n && (WORD_PART.test(text[j]) || text[j] === "@")) j++;
      push("var", i, j, true);
      i = j;
    } else if (wordStart.test(c)) {
      let j = i + 1;
      while (j < n && wordPart.test(text[j])) j++;
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
}

const lower = (t: Token | undefined) => (t?.type === "word" ? t.text.toLowerCase() : "");

/** A GO batch separator: the word GO alone on its line. */
export function isGo(text: string, start: number, end: number): boolean {
  if (end - start !== 2 || text.slice(start, end).toLowerCase() !== "go") return false;
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const lineEnd = text.indexOf("\n", end);
  return text.slice(lineStart, start).trim() === "" && text.slice(end, lineEnd < 0 ? text.length : lineEnd).trim() === "";
}

interface Segment {
  start: number;
  end: number;
}

interface Bounds {
  /** Split at GO lines, semicolons and blank lines. Each ends where the separator after it starts. */
  statements: Segment[];
  /** Split at GO lines only. */
  batches: Segment[];
  /** Every USE keyword. */
  uses: Segment[];
}

/** First index of a blank line (a newline, then only spaces, then another) in the whitespace text[from, to), or -1. */
function blankLineIn(text: string, from: number, to: number): number {
  for (let k = text.indexOf("\n", from); k >= 0 && k < to; k = text.indexOf("\n", k + 1)) {
    let j = k + 1;
    while (j < to && (text[j] === " " || text[j] === "\t" || text[j] === "\r")) j++;
    if (j < to && text[j] === "\n") return k;
  }
  return -1;
}

/**
 * Statement and batch boundaries for the whole text: one lexing pass that builds no tokens, so a request only
 * tokenizes the statement around the cursor (docs/query-editor.md, "Context resolution"). It reads strings,
 * comments and quoted names exactly as tokenize does, so a semicolon, blank line or GO inside them never splits.
 */
function bounds(text: string, language: Language, blankLines = true): Bounds {
  // Postgres has no GO and no USE, and a statement ends at its semicolon only (docs/plans/2026-10-30-postgres-design.md).
  const tsqlish = language !== "pgsql";
  if (!tsqlish) blankLines = false;
  const statements: Segment[] = [];
  const batches: Segment[] = [];
  const uses: Segment[] = [];
  let start = 0;
  let batchStart = 0;
  let previousEnd = 0;
  const blank = (to: number) => {
    if (!blankLines) return;
    const at = blankLineIn(text, previousEnd, to);
    if (at < 0) return;
    statements.push({ start, end: at });
    start = at + 1;
  };
  lex(text, language, 0, text.length, (type, s, e) => {
    blank(s);
    if (type === "word" && tsqlish && isGo(text, s, e)) {
      statements.push({ start, end: s });
      batches.push({ start: batchStart, end: s });
      start = batchStart = e;
    } else if (type === "punct" && text[s] === ";") {
      statements.push({ start, end: s });
      start = e;
    } else if (type === "word" && tsqlish && e - s === 3 && text.slice(s, e).toLowerCase() === "use") uses.push({ start: s, end: e });
    previousEnd = e;
  });
  blank(text.length);
  statements.push({ start, end: text.length });
  batches.push({ start: batchStart, end: text.length });
  return { statements, batches, uses };
}

/** Index of the segment around offset. An offset inside a GO separator belongs to the statement after it. */
function containing(list: Segment[], offset: number): number {
  const at = list.findIndex((s) => s.start <= offset && offset <= s.end);
  if (at >= 0) return at;
  const after = list.findIndex((s) => offset < s.start);
  return after >= 0 ? after : list.length - 1;
}

/** The statement around offset: bounded by the nearest GO line, semicolon or blank line on each side. */
export function statementAt(text: string, offset: number, language: Language = "tsql"): Segment {
  const { statements } = bounds(text, language);
  return statements[containing(statements, offset)];
}

/** Offset where 1-based line starts, or undefined past the end. */
export function lineOffset(text: string, line: number): number | undefined {
  let at = 0;
  for (let l = 1; l < line; l++) {
    at = text.indexOf("\n", at) + 1;
    if (at === 0) return undefined;
  }
  return at;
}

/**
 * The statements covering 1-based line, split at GO lines and semicolons only. A server error line is the line of a
 * statement's first text or of the offending name inside it, and a statement may contain blank lines, so the
 * cursor's blank-line rule does not apply here. Undefined when the line is past the end.
 */
export function statementsAtLine(text: string, line: number, language: Language = "tsql"): Segment | undefined {
  const start = lineOffset(text, line);
  if (start === undefined) return undefined;
  const newline = text.indexOf("\n", start);
  const end = newline < 0 ? text.length : newline;
  const covering = bounds(text, language, false).statements.filter((s) => s.start <= end && start <= s.end);
  if (covering.length === 0) return undefined;
  return { start: covering[0].start, end: covering[covering.length - 1].end };
}

/** A dotted name as written: its parts unquoted, and each part's token. */
export interface NameChain {
  parts: string[];
  tokens: Token[];
}

/** Every dotted name in tokens (comments already dropped). Strings are tokens of their own, so never part of one. */
export function nameChains(tokens: Token[]): NameChain[] {
  const chains: NameChain[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!isName(tokens[i]) || (tokens[i - 1]?.text === "." && tokens[i - 1].type === "punct")) continue;
    const chain: NameChain = { parts: [tokens[i].value], tokens: [tokens[i]] };
    let j = i;
    while (tokens[j + 1]?.text === "." && tokens[j + 1].type === "punct" && isName(tokens[j + 2])) {
      j += 2;
      chain.parts.push(tokens[j].value);
      chain.tokens.push(tokens[j]);
    }
    chains.push(chain);
    i = j;
  }
  return chains;
}

/**
 * The statement around offset and its tokens. The tokens start at the separator before the statement, so a GO
 * typed at the cursor is still seen; filter on statement.start to drop it.
 */
function around(text: string, offset: number, language: Language, b = bounds(text, language)): { statement: Segment; tokens: Token[] } {
  const at = containing(b.statements, offset);
  const statement = b.statements[at];
  return { statement, tokens: tokenize(text, language, at > 0 ? b.statements[at - 1].end : 0, statement.end) };
}

/** The tokens of the statement around offset (for hover), the separator before it included. */
export function statementTokens(text: string, offset: number, language: Language): Token[] {
  return around(text, offset, language).tokens;
}

/** The first token at or after from that is not a comment. */
function nextSignificant(text: string, language: Language, from: number): Token | undefined {
  let found: Token | undefined;
  lex(text, language, from, text.length, (type, start, end, closed) => {
    if (type === "comment") return false;
    found = token(text, type, start, end, closed);
    return true;
  });
  return found;
}

/** True when the text runs DDL (CREATE, ALTER or DROP as keywords, not in strings, comments or quoted names). */
export function isDdl(text: string, language: Language = "tsql"): boolean {
  return tokenize(text, language).some((t) => ["create", "alter", "drop"].includes(lower(t)));
}

// Words that cannot be a table alias.
const RESERVED = new Set(
  ("select from where join inner left right full outer cross on group order by having union except intersect with option " +
    "for as set values output apply pivot unpivot when then else end and or not in is like between exists into update delete " +
    "insert exec execute go use declare begin case top distinct null merge using table " +
    // Postgres clauses that can follow a table.
    "limit offset fetch returning window lateral natural").split(" "),
);

type ClauseKind = "objects" | "procs" | "columns" | "keywords";
const CLAUSES: Record<string, ClauseKind> = {
  from: "objects", join: "objects", update: "objects", into: "objects", table: "objects", delete: "objects", merge: "objects", using: "objects",
  exec: "procs", execute: "procs",
  select: "columns", where: "columns", on: "columns", by: "columns", having: "columns", set: "columns", and: "columns", or: "columns",
  not: "columns", when: "columns", then: "columns", else: "columns", case: "columns", distinct: "columns", top: "columns", is: "columns",
  in: "columns", like: "columns", between: "columns", ilike: "columns", returning: "columns", call: "procs",
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

/** A table reference with where it is written and what introduced it. */
export interface PlacedRef {
  ref: TableRef;
  /** The name's first and last tokens. */
  first: Token;
  last: Token;
  /** from, join, update, into or delete. */
  keyword: string;
  /** Followed by "(": a table-valued function call. */
  call: boolean;
  /** Followed by another ".": an incomplete or database..name chain. */
  dangling: boolean;
}

/** Tables named after FROM, JOIN, UPDATE and INTO in tokens[start, end), at that paren depth only. */
function tableRefs(tokens: Token[], start: number, end: number): TableRef[] {
  return placedRefs(tokens, start, end).map((r) => r.ref);
}

export function placedRefs(tokens: Token[], start = 0, end = tokens.length): PlacedRef[] {
  const refs: PlacedRef[] = [];
  let keyword = "";
  const read = (i: number): number => {
    if (tokens[i]?.text === "(") {
      // A derived table: skip it and its alias.
      let j = matching(tokens, i) + 1;
      if (lower(tokens[j]) === "as") j++;
      return isAlias(tokens[j]) ? j + 1 : j;
    }
    const { parts, next } = dottedName(tokens, i);
    if (parts.length === 0 || RESERVED.has(parts[0].toLowerCase())) return i;
    const last = tokens[next - 1];
    const placed = { first: tokens[i], last, keyword, call: tokens[next]?.text === "(", dangling: tokens[next]?.text === "." };
    let j = next;
    if (lower(tokens[j]) === "as") j++;
    const alias = isAlias(tokens[j]) ? tokens[j++].value : undefined;
    refs.push({ ref: toRef(parts, alias), ...placed });
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
      keyword = w;
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

/**
 * For each token, whether it sits in a clause that names columns (the select list, WHERE, ON, BY, HAVING, SET), by
 * the nearest clause keyword at its parenthesis depth or outside it. One forward pass over the statement's tokens.
 */
export function inColumnClause(tokens: Token[]): boolean[] {
  const outer: ClauseKind[] = [];
  let clause: ClauseKind = "keywords";
  return tokens.map((t) => {
    const w = lower(t);
    if (t.text === "(") {
      outer.push(clause);
      return clause === "columns";
    }
    if (t.text === ")") {
      clause = outer.pop() ?? "keywords";
      return clause === "columns";
    }
    if (w && CLAUSES[w] && !SCAN_SKIP.has(w)) clause = CLAUSES[w];
    return clause === "columns";
  });
}

/** The tables named in text[start, end), comments skipped (for an error's statement). */
export function tablesIn(text: string, start: number, end: number, language: Language = "tsql"): TableRef[] {
  const tokens = tokenize(text, language, start, end).filter((t) => t.type !== "comment");
  return tableRefs(tokens, 0, tokens.length);
}

/**
 * The statement around offset as the unknown-name warnings read it: its tokens without comments, the tokens of its
 * batch before it (for names created or declared earlier) and the database named by the last USE before it.
 */
export function statementScan(text: string, offset: number, language: Language): { tokens: Token[]; earlier: Token[]; useDatabase?: string } {
  const b = bounds(text, language);
  const { statement, tokens } = around(text, offset, language, b);
  const batch = b.batches[containing(b.batches, offset)];
  const earlier = tokenize(text, language, batch.start, Math.max(batch.start, statement.start)).filter((t) => t.type !== "comment");
  const stmt = tokens.filter((t) => t.type !== "comment" && t.start >= statement.start);
  // At the cursor, not the statement's start: without a semicolon, "use x" and the next line are one statement.
  const { useDatabase } = contextAt(text, offset, language);
  return useDatabase ? { tokens: stmt, earlier, useDatabase } : { tokens: stmt, earlier };
}

/** The tables named in the statement around offset (for hover). */
export function tablesAt(text: string, offset: number, language: Language): TableRef[] {
  const { statement, tokens } = around(text, offset, language);
  const stmt = tokens.filter((t) => t.type !== "comment" && t.start >= statement.start);
  return tableRefs(stmt, 0, stmt.length);
}

export function contextAt(text: string, offset: number, language: Language): CursorContext {
  // Only the statement around the cursor is tokenized; USE and DECLARE are looked up beyond it.
  const b = bounds(text, language);
  const { statement, tokens: all } = around(text, offset, language, b);
  const inside = all.find((t) => t.start < offset && (offset < t.end || (offset === t.end && !t.closed)));
  if (inside && (inside.type === "string" || inside.type === "comment")) return { context: { kind: "none" }, prefix: "", start: offset };

  let prefix = "";
  let prefixStart = offset;
  const word = all.find((t) => (t.type === "word" || t.type === "var" || t.type === "quoted") && t.start < offset && offset <= t.end);
  if (word && !(word.type === "quoted" && word.closed && offset === word.end)) {
    prefixStart = word.start;
    const raw = text.slice(word.start, offset);
    const close = raw[0] === "[" ? "]" : '"';
    prefix = word.type === "quoted" ? raw.slice(1).replaceAll(close + close, close) : raw;
  }

  const significant = all.filter((t) => t.type !== "comment");
  let useDatabase: string | undefined;
  for (let u = b.uses.length - 1; u >= 0 && useDatabase === undefined; u--) {
    if (b.uses[u].end > prefixStart) continue;
    const name = nextSignificant(text, language, b.uses[u].end);
    if (name && isName(name) && name.end <= prefixStart) useDatabase = name.value;
  }
  const done = (context: Context): CursorContext =>
    useDatabase ? { context, prefix, start: prefixStart, useDatabase } : { context, prefix, start: prefixStart };

  const stmt = significant.filter((t) => t.start >= statement.start && t.start !== prefixStart);
  const before = stmt.filter((t) => t.end <= prefixStart);
  const last = before[before.length - 1];

  if (prefix.startsWith("@") && language === "tsql") {
    const batch = b.batches[containing(b.batches, offset)];
    const declared = tokenize(text, language, batch.start, batch.end).filter((t) => t.type !== "comment");
    return done({ kind: "variables", names: declaredVariables(declared) });
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
  if (language === "pgsql" && last?.text === ":" && before[before.length - 2]?.text === ":") return done({ kind: "types" });
  if (last?.text === "(" && ["convert", "try_convert"].includes(lower(before[before.length - 2]))) return done({ kind: "types" });
  if (lower(last) === "as") {
    const cast = opens.length > 0 && ["cast", "try_cast"].includes(lower(before[opens[0] - 1]));
    return done(cast ? { kind: "types" } : { kind: "none" });
  }
  if (last?.type === "var" && language === "tsql" && declaringVariable(before)) return done({ kind: "types" });

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
