import type { EditorSettings } from "../app/api";
import type { Problem } from "../app/problems";
import type { ChangelogSection, WhatsNewSource } from "../whats-new";
import { CatalogStore, type CatalogNotice } from "./catalog.svelte";
import type { Options } from "./intellisense/engine";
import { findName, lineAt, locatable, quotedName, type Found } from "./intellisense/locate";
import type { ModelInfo } from "./intellisense/providers";
import { contextAt, isDdl, lineOffset, statementsAtLine, tablesIn } from "./intellisense/scanner";
import type { Suggestion } from "./intellisense/suggest";
import type { SuggestRequest } from "./intellisense/worker";
import type { CellValue, MessageNotification, QueryScope, QuerySummary, QueryTarget, ResultColumn, RowsNotification } from "./types";

export interface QueryApi {
  executeQuery: (request: { queryId: string; nodeId: string; text: string; database?: string }) => Promise<QuerySummary>;
  cancelQuery: (queryId: string) => Promise<boolean>;
  catalogGet?: (nodeId: string, database?: string) => Promise<CatalogNotice>;
  catalogRefresh?: (nodeId: string, database?: string) => Promise<CatalogNotice>;
  /** Database names on the connection whose node id is given, for a tab's database picker. */
  databases?: (connectionNodeId: string) => Promise<string[]>;
  /** A "did you mean" for a name error, from the IntelliSense worker's catalogs (docs/query-editor.md, "Error location"). */
  suggest?: (request: SuggestRequest, info: ModelInfo) => Promise<Suggestion | undefined>;
}

/** A row in a query tab's Messages. */
export interface QueryMessage {
  /** Unique across tabs, so the editor can track the row's mark. */
  id: number;
  kind: "info" | "error";
  text: string;
  elapsedMs: number;
  /**
   * Where the editor marks the error and puts the cursor when the row is clicked: the offending name when located,
   * else the start of the reported line. Offsets into the tab's text as it was when the error arrived.
   */
  at?: { start: number; end: number };
  /** at is the offending name, not just its line. */
  located?: boolean;
  /** The suggested name, offered as a quick fix on the mark. */
  fix?: Suggestion;
}

/** Errors whose quoted name can be looked up in the catalog: objects, columns, procedures. */
const SUGGESTABLE = new Set([208, 207, 2812]);
let nextMessageId = 0;

/**
 * The connection part of a node id (env:x/conn:y) and its database and Cosmos container segments, decoded. Only for
 * targets without a sidecar-resolved scope (QueryTarget.scope); the app passes the sidecar's.
 */
export function nodeParts(nodeId: string): { connection: string; database?: string; container?: string } {
  const segments = nodeId.split("/");
  const result: { connection: string; database?: string; container?: string } = { connection: segments.slice(0, 2).join("/") };
  for (const segment of segments.slice(2)) {
    const colon = segment.indexOf(":");
    const type = segment.slice(0, colon);
    const value = decodeURIComponent(segment.slice(colon + 1));
    if (type === "db") result.database = value;
    else if (type === "c") result.container = value;
  }
  return result;
}

/**
 * One result set. Rows live in a plain array (100k rows must not be made reactive); `count`
 * changes as batches arrive and is what the grid redraws on.
 */
export class ResultSet {
  columns = $state.raw<ResultColumn[]>([]);
  rows: CellValue[][] = [];
  count = $state(0);
}

export class QueryTab {
  readonly id = crypto.randomUUID();
  readonly kind = "query" as const;
  readonly target: QueryTarget;
  title = $state("");
  text = $state("");
  running = $state(false);
  startedAt = $state(0);
  queryId = "";
  results = $state.raw<ResultSet[]>([]);
  messages = $state<QueryMessage[]>([]);
  /** The text the last run sent and where it starts in text (a selection's offset, else 0), to place its errors. */
  runText = "";
  runOffset = 0;
  /** Set to move the editor's cursor to a message's mark; seq makes a repeated click count. */
  reveal = $state<{ id: number; seq: number }>();
  summary = $state.raw<QuerySummary>();
  error = $state<string>();
  /** Selected result tab: an index into results, or -1 for Messages. */
  view = $state(0);
  /** The database picker's choice when it differs from the node's own database. */
  database = $state<string>();
  /** Databases on the tab's connection, for the picker (SQL tabs only). */
  databases = $state.raw<string[]>([]);
  /** Which catalog completions read (docs/query-editor.md). */
  catalogKey = $state<string>();
  catalogError = $state<string>();

  constructor(target: QueryTarget, text: string, title: string) {
    this.target = target;
    this.text = text;
    this.title = title;
  }
}

/** The release notes tab (ADR 0013). A singleton: there is only ever one, with this id. */
export class WhatsNewTab {
  readonly kind = "whats-new" as const;
  readonly id = "whats-new";
  title = $state("");
  sections = $state.raw<ChangelogSection[]>([]);
  opened = $state<WhatsNewSource>("launch");

  constructor(sections: ChangelogSection[], opened: WhatsNewSource) {
    this.show(sections, opened);
  }

  show(sections: ChangelogSection[], opened: WhatsNewSource): void {
    this.sections = sections;
    this.opened = opened;
    this.title = sections.length ? `What's new in v${sections[0].version}` : "What's new";
  }
}

/** Explorer errors in full (docs/explorer-errors.md). A singleton like What's new. */
export class ProblemsTab {
  readonly kind = "problems" as const;
  readonly id = "problems";
  entries = $state.raw<Problem[]>([]);
  /** The entry to scroll to, and a counter so asking for the same one again scrolls again. */
  focus = $state<{ nodeId: string; seq: number }>();
  readonly title = $derived(`Problems (${this.entries.length})`);
}

export type WorkspaceTab = QueryTab | WhatsNewTab | ProblemsTab;

/**
 * Open workspace tabs, the one in front, and routing of streamed results to whichever query tab asked
 * for them. Query logic only ever touches query tabs.
 */
export class QueryWorkspace {
  tabs = $state<WorkspaceTab[]>([]);
  activeId = $state<string>();
  private readonly byQuery = new Map<string, QueryTab>();
  private untitled = 0;

  constructor(private readonly api: QueryApi) {}

  readonly catalogs = new CatalogStore();
  editor = $state<EditorSettings>({ intellisense: true, catalogSampleDocs: 50, autoRefreshOnDdl: true, warnUnknownNames: true });
  /** Catalog keys of the databases known on each connection: connection node id, then lower-cased database name. */
  private readonly databaseKeys = new Map<string, Record<string, string>>();
  private readonly fetching = new Set<string>();

  get active(): WorkspaceTab | undefined {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  open(target: QueryTarget, text: string): QueryTab {
    this.tabs.push(new QueryTab(target, text, `${target.label} (${++this.untitled})`));
    const tab = this.tabs[this.tabs.length - 1] as QueryTab;
    this.activeId = tab.id;
    void this.loadCatalog(tab);
    void this.loadDatabases(tab);
    return tab;
  }

  /** The tab's connection, database and container: the sidecar's scope, else read from the node id. */
  private scopeOf(target: QueryTarget): QueryScope {
    return target.scope ?? nodeParts(target.nodeId);
  }

  /** The database the tab runs against: the picker's choice, else the node's own (undefined: the connection default). */
  databaseOf(tab: QueryTab): string | undefined {
    return tab.database ?? this.scopeOf(tab.target).database;
  }

  setDatabase(tab: QueryTab, database: string): void {
    tab.database = database === this.scopeOf(tab.target).database ? undefined : database;
    tab.catalogKey = undefined;
    void this.loadCatalog(tab);
  }

  private remember(tab: QueryTab, database: string | undefined, key: string): void {
    if (!database) return;
    const connection = this.scopeOf(tab.target).connection;
    this.databaseKeys.set(connection, { ...this.databaseKeys.get(connection), [database.toLowerCase()]: key });
  }

  private async loadCatalog(tab: QueryTab): Promise<void> {
    if (!this.api.catalogGet || !this.editor.intellisense) return;
    tab.catalogError = undefined;
    try {
      const result = await this.api.catalogGet(tab.target.nodeId, tab.database);
      this.catalogs.apply(result);
      tab.catalogKey = result.key;
      this.remember(tab, this.databaseOf(tab), result.key);
    } catch (e) {
      tab.catalogError = e instanceof Error ? e.message : String(e);
    }
  }

  private async loadDatabases(tab: QueryTab): Promise<void> {
    if (!this.api.databases || tab.target.language !== "sql") return;
    try {
      tab.databases = await this.api.databases(this.scopeOf(tab.target).connection);
    } catch {
      tab.databases = [];
    }
  }

  /** A database named in the text (USE x, x.schema.) has no catalog yet: fetch it once, in the background. */
  private async fetchDatabase(tab: QueryTab, database: string): Promise<void> {
    const connection = this.scopeOf(tab.target).connection;
    const marker = `${connection}|${database.toLowerCase()}`;
    if (!this.api.catalogGet || this.databaseKeys.get(connection)?.[database.toLowerCase()] || this.fetching.has(marker)) return;
    this.fetching.add(marker);
    try {
      const result = await this.api.catalogGet(tab.target.nodeId, database);
      this.catalogs.apply(result);
      this.remember(tab, database, result.key);
    } catch {
      // The request failed (a timeout, the sidecar stopping): not remembered, so the next mention asks again. A name
      // that is not a database does not land here: it gets a key now and an error state later (see forgetFailed).
    } finally {
      this.fetching.delete(marker);
    }
  }

  /** What the tab's editor completes against; undefined when IntelliSense is off. Read on every request. */
  intellisense(tab: QueryTab): () => ModelInfo | undefined {
    return () => {
      if (!this.editor.intellisense) return undefined;
      const parts = this.scopeOf(tab.target);
      const databases = this.databaseKeys.get(parts.connection) ?? {};
      const keys = [...new Set([tab.catalogKey, ...Object.values(databases)])].filter((k): k is string => !!k);
      const options: Options = { language: tab.target.language === "cosmos" ? "cosmos-sql" : "tsql" };
      if (this.editor.keywordCase) options.keywordCase = this.editor.keywordCase;
      if (parts.container) options.container = parts.container;
      return {
        enabled: true,
        options,
        keys: { current: tab.catalogKey, databases },
        catalogs: keys.map((key) => {
          const entry = this.catalogs.get(key);
          return { key, catalog: entry?.catalog, version: entry?.version ?? 0 };
        }),
        warnUnknownNames: this.editor.warnUnknownNames && tab.target.language === "sql",
        onMissing: (database) => void this.fetchDatabase(tab, database),
      };
    };
  }

  intellisenseStatus(tab: QueryTab): { text: string; title?: string } {
    if (!this.editor.intellisense) return { text: "IntelliSense: off" };
    if (tab.catalogError) return { text: "IntelliSense: error", title: tab.catalogError };
    const entry = tab.catalogKey ? this.catalogs.get(tab.catalogKey) : undefined;
    if (!entry) return { text: "IntelliSense: building" };
    return entry.state === "error" ? { text: "IntelliSense: error", title: entry.message } : { text: `IntelliSense: ${entry.state}` };
  }

  /**
   * A database named in the text whose catalog failed to load (most often a name that is not a database: an alias,
   * a CTE or a typo) stays remembered so it is not asked for on every keystroke. This forgets those on a connection,
   * or just the one database, so the next mention asks again: the database may exist now.
   */
  private forgetFailed(connection: string, database?: string): void {
    const keys = this.databaseKeys.get(connection);
    if (!keys) return;
    const failed = ([name, key]: [string, string]) =>
      this.catalogs.get(key)?.state === "error" && (database === undefined || name === database.toLowerCase());
    this.databaseKeys.set(connection, Object.fromEntries(Object.entries(keys).filter((e) => !failed(e))));
  }

  /** Explorer refresh on a connection or database, by node id: see refreshForScope. */
  refreshForNode(nodeId: string): void {
    this.refreshForScope(nodeParts(nodeId));
  }

  /** Explorer refresh on a connection or database (its query.scope): rebuild the catalogs of query tabs open against it. */
  refreshForScope(node: QueryScope): void {
    this.forgetFailed(node.connection, node.database);
    for (const t of this.tabs) {
      if (t.kind !== "query" || this.scopeOf(t.target).connection !== node.connection) continue;
      if (node.database === undefined || node.database.toLowerCase() === this.databaseOf(t)?.toLowerCase()) this.refreshCatalog(t);
    }
  }

  /** Refresh IntelliSense: rebuilds the tab's catalog whatever its stamp says. */
  refreshCatalog(tab: QueryTab): void {
    if (!this.api.catalogRefresh || !this.editor.intellisense) return;
    this.api.catalogRefresh(tab.target.nodeId, tab.database).then(
      (r) => this.catalogs.apply(r),
      () => {},
    );
  }

  /** Opens the What's new tab, or focuses and refreshes it if it is already open. */
  openWhatsNew(sections: ChangelogSection[], opened: WhatsNewSource): WhatsNewTab {
    let tab = this.tabs.find((t): t is WhatsNewTab => t.kind === "whats-new");
    if (tab) tab.show(sections, opened);
    else {
      this.tabs.push(new WhatsNewTab(sections, opened));
      tab = this.tabs[this.tabs.length - 1] as WhatsNewTab;
    }
    this.activeId = tab.id;
    return tab;
  }

  /** Updates the Problems tab's entries if it is open; closing it loses nothing, the tree holds the errors. */
  setProblems(entries: Problem[]): void {
    const tab = this.tabs.find((t): t is ProblemsTab => t.kind === "problems");
    if (tab) tab.entries = entries;
  }

  /** Opens or focuses the Problems tab, scrolled to one node's entry when given. */
  openProblems(entries: Problem[], nodeId?: string): ProblemsTab {
    let tab = this.tabs.find((t): t is ProblemsTab => t.kind === "problems");
    if (!tab) {
      this.tabs.push(new ProblemsTab());
      tab = this.tabs[this.tabs.length - 1] as ProblemsTab;
    }
    tab.entries = entries;
    if (nodeId !== undefined) tab.focus = { nodeId, seq: (tab.focus?.seq ?? 0) + 1 };
    this.activeId = tab.id;
    return tab;
  }

  close(id: string): void {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index < 0) return;
    const [tab] = this.tabs.splice(index, 1);
    if (tab.kind === "query" && tab.running) void this.cancel(tab);
    if (this.activeId === id) this.activeId = this.tabs[Math.min(index, this.tabs.length - 1)]?.id;
  }

  /** Runs the tab's text, or only `selection` (which starts at `offset` in it) when the user has selected some. Never throws. */
  async run(tab: QueryTab, selection?: string, offset = 0): Promise<void> {
    if (tab.running) return;
    const text = selection?.trim() ? selection : tab.text;
    if (!text.trim()) return;
    tab.runText = text;
    tab.runOffset = text === selection ? offset : 0;

    tab.queryId = crypto.randomUUID();
    this.byQuery.set(tab.queryId, tab);
    tab.results = [];
    tab.messages = [];
    tab.summary = undefined;
    tab.error = undefined;
    tab.view = 0;
    tab.startedAt = Date.now();
    tab.running = true;
    try {
      tab.summary = await this.api.executeQuery({ queryId: tab.queryId, nodeId: tab.target.nodeId, text, database: tab.database });
      if (this.editor.autoRefreshOnDdl && tab.target.language === "sql" && isDdl(text)) {
        this.forgetFailed(this.scopeOf(tab.target).connection);
        this.refreshCatalog(tab);
      }
      tab.error = tab.summary.error ?? undefined;
      if (tab.error && tab.results.length === 0) tab.view = -1;
    } catch (e) {
      tab.error = e instanceof Error ? e.message : String(e);
      tab.view = -1;
    } finally {
      tab.running = false;
      this.byQuery.delete(tab.queryId);
    }
  }

  async cancel(tab: QueryTab): Promise<void> {
    if (tab.running && tab.queryId) await this.api.cancelQuery(tab.queryId);
  }

  /** Feed for query.rows, query.message and catalog.* notifications from the sidecar. */
  handle(method: string, params: unknown): void {
    if (method.startsWith("catalog.")) this.catalogs.handle(method, params);
    else if (method === "query.rows") {
      const p = params as RowsNotification;
      const tab = this.byQuery.get(p.queryId);
      if (!tab) return;
      let set = tab.results[p.index];
      if (!set) {
        set = new ResultSet();
        tab.results = [...tab.results, set];
      }
      if (p.columns) set.columns = p.columns;
      for (const row of p.rows) set.rows.push(row);
      set.count = set.rows.length;
    } else if (method === "query.message") {
      const p = params as MessageNotification;
      const tab = this.byQuery.get(p.queryId);
      if (tab) this.addMessage(tab, p);
    }
  }

  /** Moves the tab's editor cursor to the message's mark. */
  reveal(tab: QueryTab, message: QueryMessage): void {
    tab.reveal = { id: message.id, seq: (tab.reveal?.seq ?? 0) + 1 };
  }

  private addMessage(tab: QueryTab, p: MessageNotification): void {
    const message: QueryMessage = { id: ++nextMessageId, kind: p.kind, text: p.text, elapsedMs: p.elapsedMs };
    const found = p.kind === "error" && p.line !== undefined && tab.target.language === "sql" ? this.place(tab, message, p.line, p.number) : undefined;
    // The pushed row is a reactive proxy; a suggestion arriving later must update that, not the plain object.
    const row = tab.messages[tab.messages.push(message) - 1];
    if (found && p.number !== undefined && p.line !== undefined) void this.suggestFor(tab, row, p.number, p.line, found);
  }

  /**
   * Points an error that has a script line at its name (docs/query-editor.md, "Error location"), or at the start of
   * the line when the name is not found exactly once, and rewrites the line in its text to the editor's. Returns the
   * name when found.
   */
  private place(tab: QueryTab, message: QueryMessage, line: number, number?: number): Found | undefined {
    const run = tab.runText;
    // Typed over while it ran: the offsets would point at the wrong text, so leave the message as the server sent it.
    if (tab.text.slice(tab.runOffset, tab.runOffset + run.length) !== run) return undefined;
    const before = lineAt(tab.text, tab.runOffset) - 1;
    const prefix = `Line ${line}: `;
    const body = message.text.startsWith(prefix) ? message.text.slice(prefix.length) : message.text;
    const name = number !== undefined && locatable(number) ? quotedName(body) : undefined;
    const found = name ? findName(run, line, name, number!) : undefined;

    if (!found) {
      const start = lineOffset(run, line);
      if (start === undefined) return undefined;
      const first = tab.runOffset + start + (/^[ \t]*/.exec(run.slice(start))?.[0].length ?? 0);
      message.at = { start: first, end: first };
      message.located = false;
      if (body !== message.text) message.text = `Line ${before + line}: ${body}`;
      return undefined;
    }
    message.at = { start: tab.runOffset + found.start, end: tab.runOffset + found.end };
    message.located = true;
    const where = found.line === line ? "" : ` (statement starts at line ${before + line})`;
    message.text = `Line ${before + found.line}: ${body.replace(/\.$/, "")}${where}.`;
    return found;
  }

  /** Asks the worker for the closest catalog name and, if there is one, appends it to the row and offers it as a fix. */
  private async suggestFor(tab: QueryTab, row: QueryMessage, number: number, line: number, found: Found): Promise<void> {
    const info = this.intellisense(tab)();
    if (!this.api.suggest || !info || !SUGGESTABLE.has(number)) return;
    const run = tab.runText;
    const parts = found.chain.parts;
    let request: SuggestRequest;
    if (number === 207) {
      const statement = statementsAtLine(run, line)!;
      request = { number, parts: parts.slice(-1), tables: tablesIn(run, statement.start, statement.end) };
      if (parts.length >= 2) request.qualifier = parts[parts.length - 2];
    } else request = { number, parts, tables: [] };
    const useDatabase = contextAt(run, found.start, "tsql").useDatabase;
    if (useDatabase) request.useDatabase = useDatabase;

    const queryId = tab.queryId;
    const suggestion = await this.api.suggest(request, info);
    if (!suggestion || tab.queryId !== queryId) return;
    row.text = `${row.text} Did you mean ${suggestion.label}?`;
    row.fix = suggestion;
  }
}
