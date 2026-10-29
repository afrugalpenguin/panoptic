import type { ChangelogSection } from "../whats-new";
import type { CellValue, MessageNotification, QuerySummary, QueryTarget, ResultColumn, RowsNotification } from "./types";

export interface QueryApi {
  executeQuery: (request: { queryId: string; nodeId: string; text: string; database?: string }) => Promise<QuerySummary>;
  cancelQuery: (queryId: string) => Promise<boolean>;
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

export type WorkspaceTab = QueryTab | WhatsNewTab;

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

  get active(): WorkspaceTab | undefined {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  open(target: QueryTarget, text: string): QueryTab {
    const tab = new QueryTab(target, text, `${target.label} (${++this.untitled})`);
    this.tabs.push(tab);
    this.activeId = tab.id;
    return this.tabs[this.tabs.length - 1] as QueryTab;
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
      tab.summary = await this.api.executeQuery({ queryId: tab.queryId, nodeId: tab.target.nodeId, text });
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

  /** Feed for query.rows and query.message notifications from the sidecar. */
  handle(method: string, params: unknown): void {
    if (method === "query.rows") {
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
