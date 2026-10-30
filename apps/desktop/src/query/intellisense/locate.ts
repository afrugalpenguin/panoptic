// Where a server error points in the script (docs/query-editor.md, "Error location"). SQL Server reports name errors
// at the statement's first line (208, 4104, 2812) or the name's own line (207), so the name is found by searching the
// statement for it. Pure: it runs on the main thread when an error arrives, from the scanner's tokens.

import { nameChains, statementsAtLine, tokenize, type NameChain } from "./scanner";

/** Name-resolution errors: 208 invalid object name, 207 invalid column name, 4104 multi-part identifier, 2812 procedure. */
const LOCATABLE = new Set([208, 207, 4104, 2812]);

export function locatable(number: number): boolean {
  return LOCATABLE.has(number);
}

/** The identifier an error message quotes ('x' or "x"), or undefined. */
export function quotedName(message: string): string | undefined {
  return /'([^']+)'|"([^"]+)"/.exec(message)?.slice(1).find((g) => g !== undefined);
}

export interface Found {
  /** Offsets of the name in the text, its qualifier included when the error quoted one. */
  start: number;
  end: number;
  /** 1-based line the name starts on. */
  line: number;
  /** The name's dotted chain as written, for suggestions. */
  chain: NameChain;
  /** Parts of the chain the range covers, from its end. */
  covered: number;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Chains whose last parts are target, case-insensitively. */
function ending(chains: NameChain[], target: string[]): NameChain[] {
  return chains.filter((c) => c.parts.length >= target.length && target.every((t, i) => same(t, c.parts[c.parts.length - target.length + i])));
}

/**
 * The one place in the statement at 1-based line where the error's name is written: a whole dotted name ending in
 * the quoted parts, outside strings and comments. A 4104 identifier may name an alias that is not the one written,
 * so its last part alone is enough. Undefined when there is no match or more than one.
 */
export function findName(text: string, line: number, name: string, number: number): Found | undefined {
  const statement = statementsAtLine(text, line);
  if (!statement) return undefined;
  const target = nameChains(tokenize(name, "tsql"))[0]?.parts;
  if (!target?.length) return undefined;
  const chains = nameChains(tokenize(text, "tsql", statement.start, statement.end).filter((t) => t.type !== "comment"));

  let matches = ending(chains, target);
  if (matches.length === 0 && number === 4104 && target.length > 1) matches = ending(chains, target.slice(-1));
  if (matches.length !== 1) return undefined;

  const chain = matches[0];
  const covered = Math.min(target.length, chain.parts.length);
  const first = chain.tokens[chain.tokens.length - covered];
  const end = chain.tokens[chain.tokens.length - 1].end;
  return { start: first.start, end, line: lineAt(text, first.start), chain, covered };
}

/** 1-based line of offset. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = text.indexOf("\n"); i >= 0 && i < offset; i = text.indexOf("\n", i + 1)) line++;
  return line;
}
