import type { EditorSettings } from "../app/api";
import type { Problem } from "../app/problems";
import type { ChangelogSection } from "../whats-new";
import { CatalogStore, type CatalogNotice } from "./catalog.svelte";
import type { Options } from "./intellisense/engine";
import type { ModelInfo } from "./intellisense/providers";
import { isDdl } from "./intellisense/scanner";
import type { CellValue, MessageNotification, QuerySummary, QueryTarget, ResultColumn, RowsNotification } from "./types";

export interface QueryApi {
  executeQuery: (request: { queryId: string; nodeId: string; text: string; database?: string }) => Promise<QuerySummary>;
  cancelQuery: (queryId: string) => Promise<boolean>;
  catalogGet?: (nodeId: string, database?: string) => Promise<CatalogNotice>;
  catalogRefresh?: (nodeId: string, database?: string) => Promise<CatalogNotice>;
  /** Database names on the connection whose node id is given, for a tab's database picker. */
  databases?: (connectionNodeId: string) => Promise<string[]>;
}

/** The connection part of a node id (env:x/conn:y) and its database and Cosmos container segments, decoded. */
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
  messages = $state<(Omit<MessageNotification, "queryId">)[]>([]);
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

  constructor(sections: ChangelogSection[]) {
    this.show(sections);
  }

  show(sections: ChangelogSection[]): void {
    this.sections = sections;
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
  editor = $state<EditorSettings>({ intellisense: true, catalogSampleDocs: 50, autoRefreshOnDdl: true });
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

  /** The database the tab runs against: the picker's choice, else the node's own (undefined: the connection default). */
  databaseOf(tab: QueryTab): string | undefined {
    return tab.database ?? nodeParts(tab.target.nodeId).database;
  }

  setDatabase(tab: QueryTab, database: string): void {
    tab.database = database === nodeParts(tab.target.nodeId).database ? undefined : database;
    tab.catalogKey = undefined;
    void this.loadCatalog(tab);
  }

  private remember(tab: QueryTab, database: string | undefined, key: string): void {
    if (!database) return;
    const connection = nodeParts(tab.target.nodeId).connection;
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
      tab.databases = await this.api.databases(nodeParts(tab.target.nodeId).connection);
    } catch {
      tab.databases = [];
    }
  }

  /** A database named in the text (USE x, x.schema.) has no catalog yet: fetch it once, in the background. */
  private async fetchDatabase(tab: QueryTab, database: string): Promise<void> {
    const connection = nodeParts(tab.target.nodeId).connection;
    const marker = `${connection}|${database.toLowerCase()}`;
    if (!this.api.catalogGet || this.databaseKeys.get(connection)?.[database.toLowerCase()] || this.fetching.has(marker)) return;
    this.fetching.add(marker);
    try {
      const result = await this.api.catalogGet(tab.target.nodeId, database);
      this.catalogs.apply(result);
      this.remember(tab, database, result.key);
    } catch {
      // Not a database, or not reachable: completions for it stay empty.
    } finally {
      this.fetching.delete(marker);
    }
  }

  /** What the tab's editor completes against; undefined when IntelliSense is off. Read on every request. */
  intellisense(tab: QueryTab): () => ModelInfo | undefined {
    return () => {
      if (!this.editor.intellisense) return undefined;
      const parts = nodeParts(tab.target.nodeId);
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

  /** Explorer refresh on a connection or database: rebuild the catalogs of query tabs open against it. */
  refreshForNode(nodeId: string): void {
    const node = nodeParts(nodeId);
    for (const t of this.tabs) {
      if (t.kind !== "query" || nodeParts(t.target.nodeId).connection !== node.connection) continue;
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
  openWhatsNew(sections: ChangelogSection[]): WhatsNewTab {
    let tab = this.tabs.find((t): t is WhatsNewTab => t.kind === "whats-new");
    if (tab) tab.show(sections);
    else {
      this.tabs.push(new WhatsNewTab(sections));
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

  /** Runs the tab's text, or only `selection` when the user has selected some. Never throws. */
  async run(tab: QueryTab, selection?: string): Promise<void> {
    if (tab.running) return;
    const text = selection?.trim() ? selection : tab.text;
    if (!text.trim()) return;

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
      if (this.editor.autoRefreshOnDdl && tab.target.language === "sql" && isDdl(text)) this.refreshCatalog(tab);
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
      if (tab) tab.messages.push({ kind: p.kind, text: p.text, elapsedMs: p.elapsedMs });
    }
  }
}
