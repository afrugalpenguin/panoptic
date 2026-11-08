<script lang="ts">
  import Spinner from "../app/Spinner.svelte";
  import { onMount } from "svelte";
  import { save } from "@tauri-apps/plugin-dialog";
  import { writeTextFile } from "@tauri-apps/plugin-fs";
  import SeekBox from "../app/SeekBox.svelte";
  import type { SeekHost, SeekIndex, SeekRow } from "../app/seek";
  import { toCsv, toJson } from "./export";
  import QueryEditor from "./QueryEditor.svelte";
  import ResultGrid from "./ResultGrid.svelte";
  import type { QueryTab, QueryWorkspace } from "./store.svelte";

  let {
    tab,
    workspace,
    seekIndex,
    onConnect,
  }: {
    tab: QueryTab;
    workspace: QueryWorkspace;
    /** The unconnected tab's picker: Seek scoped to connections (docs/landing.md). */
    seekIndex: SeekIndex;
    onConnect: (tab: QueryTab, host: SeekHost) => void;
  } = $props();

  let editorHost = $state<HTMLDivElement>();
  let queryEditor = $state<QueryEditor>();
  // Never auto-connect: the last used connection is only pre-selected, and Enter or a click picks it.
  const pick = (row: SeekRow) => row.kind === "host" && onConnect(tab, row.host);

  let editorHeight = $state(readSplit());
  let now = $state(Date.now());
  let exportError = $state<string>();
  /** Save all rows (#287) asks first: it runs the query again. */
  let confirmingSave = $state(false);

  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 100);
    return () => clearInterval(t);
  });

  // now ticks every 100 ms, so just after a run starts it can still be behind startedAt: never show "-0.0 s".
  const elapsed = $derived(Math.max(0, (tab.running ? now : tab.startedAt + (tab.summary?.elapsedMs ?? 0)) - tab.startedAt) / 1000);
  const current = $derived(tab.view >= 0 ? tab.results[tab.view] : undefined);
  // Each tab has its own QueryView (keyed in Workspace), but read the props at call time all the same.
  const intellisense = () => workspace.intellisense(tab)();
  const status = $derived(workspace.intellisenseStatus(tab));
  /** The picker lists the connection's databases, plus the tab's own if the list has not loaded or lacks it. */
  const database = $derived(workspace.databaseOf(tab));
  const databaseOptions = $derived(database && !tab.databases.includes(database) ? [database, ...tab.databases] : tab.databases);
  /**
   * A tab opened on a connection (not a database) runs in the connection's default database until one is picked. The
   * picker says so with its own entry; without it the select would show its first option, which the tab is not using.
   */
  const offersDefault = $derived(workspace.nodeDatabaseOf(tab) === undefined);

  async function exportAs(format: "csv" | "json") {
    if (!current) return;
    exportError = undefined;
    const path = await save({
      defaultPath: `results.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (!path) return;
    try {
      await writeTextFile(path, format === "csv" ? toCsv(current.columns, current.rows) : toJson(current.columns, current.rows));
    } catch (e) {
      exportError = `Export failed: ${e instanceof Error ? e.message : e}`;
    }
  }

  /** The shown result stopped at the row limit: its other rows can only be had by running the query again. */
  const truncated = $derived(tab.view >= 0 && !!tab.summary?.resultSets[tab.view]?.truncated);

  async function saveAll() {
    confirmingSave = false;
    const path = await save({
      defaultPath: "results.csv",
      filters: [
        { name: "CSV", extensions: ["csv"] },
        { name: "JSON", extensions: ["json"] },
      ],
    });
    if (!path) return;
    await workspace.saveAll(tab, path, path.toLowerCase().endsWith(".json") ? "json" : "csv");
  }

  function readSplit(): number {
    try {
      return Number(localStorage.getItem("panoptic.editorHeight")) || 240;
    } catch {
      return 240;
    }
  }

  function startResize(e: PointerEvent) {
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    // From the editor's own top, so the connection picker above it (unconnected tabs) doesn't skew the drag.
    const top = editorHost!.getBoundingClientRect().top;
    const move = (ev: PointerEvent) => (editorHeight = Math.max(80, Math.min(window.innerHeight - 200, ev.clientY - top)));
    target.addEventListener("pointermove", move);
    target.addEventListener(
      "pointerup",
      () => {
        target.removeEventListener("pointermove", move);
        try {
          localStorage.setItem("panoptic.editorHeight", String(editorHeight));
        } catch {}
      },
      { once: true },
    );
  }
</script>

<div class="view" style:--editor-h="{editorHeight}px">
  <div class="toolbar">
    {#if tab.running}
      <button class="cancel" onclick={() => workspace.cancel(tab)}>Cancel</button>
      <span class="running" role="status">Running... {elapsed.toFixed(1)} s</span>
    {:else}
      <button
        class="primary"
        disabled={!tab.target}
        onclick={() => (queryEditor ? queryEditor.run() : workspace.run(tab))}
        title={tab.target ? "Run (F5 or Ctrl+Enter); runs the selection if there is one" : "Choose a connection first"}>Run</button
      >
    {/if}
    {#if tab.target}<span class="target" style:--band={tab.target.envColor ?? "transparent"}>
      {tab.target.connection} / {tab.target.label}
      {#if tab.target.readOnly}<span
          class="ro"
          title="SQL runs in a transaction that is rolled back at the end. A COMMIT in the script ends it early (the remaining batches are then skipped), and side effects outside the database transaction (xp_cmdshell, sp_send_dbmail, linked servers) are not rolled back. A read-only login is the real protection."
          >read-only</span
        >{/if}
    </span>{/if}
    {#if databaseOptions.length > 0}
      <select
        class="database"
        aria-label="Database"
        title="Database this tab runs against"
        value={database ?? ""}
        onchange={(e) => workspace.setDatabase(tab, e.currentTarget.value)}
      >
        {#if offersDefault}<option value="">(connection default)</option>{/if}
        {#each databaseOptions as name (name)}<option value={name}>{name}</option>{/each}
      </select>
    {/if}
    {#if tab.databasesError}<span class="databases-error" title="Could not list databases: {tab.databasesError}">Databases unavailable</span>{/if}
    <button class="link muted" title={status.title ?? "Rebuild completions for this database"} onclick={() => workspace.refreshCatalog(tab)}
      >{status.text}</button
    >
    <span style:flex="1"></span>
    {#if tab.summary && !tab.running}
      <span class="muted">
        {tab.summary.cancelled ? "Cancelled" : tab.summary.error ? "Failed" : "Done"} in {(tab.summary.elapsedMs / 1000).toFixed(2)} s
        {#if tab.summary.requestCharge != null}, {tab.summary.requestCharge.toFixed(2)} RU{/if}
        {#if tab.summary.rolledBack}, rolled back{/if}
      </span>
      {#if tab.summary.committed}<span class="committed" title="A COMMIT or ROLLBACK in the script ended the read-only transaction. See Messages."
          >Read-only guard bypassed: changes may be committed</span
        >{/if}
    {/if}
  </div>

  <!-- Always rendered, so the grid rows stay put; empty (no height) once connected. -->
  <div>
    {#if !tab.target}<div class="picker">
      <p class="muted">Not connected - choose a connection</p>
      <SeekBox
        index={seekIndex}
        scope="connections"
        autofocus
        placeholder="Seek a connection"
        label="Choose a connection for this tab"
        onOpen={pick}
        onQuery={pick}
        onLeave={() => editorHost?.querySelector("textarea")?.focus()}
      />
    </div>{/if}
  </div>

  <div class="editor-host" bind:this={editorHost}>
    <QueryEditor
      bind:this={queryEditor}
      {tab}
      language={tab.target?.language}
      {intellisense}
      onRun={(selection, offset) => workspace.run(tab, selection, offset)}
      messages={tab.messages}
      reveal={tab.reveal}
      warnUnknownNames={workspace.editor.intellisense && workspace.editor.warnUnknownNames}
    />
  </div>

  <div class="splitter" role="separator" aria-orientation="horizontal" onpointerdown={startResize}></div>

  <div class="results">
    {#if tab.running}<div class="progress" role="progressbar" aria-label="Query running"></div>{/if}
    <div class="result-tabs">
      {#each tab.results as set, i}
        <button class="ghost" class:on={tab.view === i} onclick={() => (tab.view = i)}>
          Result {tab.results.length > 1 ? i + 1 : ""} <span class="muted"
            >({set.count.toLocaleString()} row{set.count === 1 ? "" : "s"}{tab.summary?.resultSets[i]?.truncated ? ", row limit reached" : ""})</span
          >
        </button>
      {/each}
      <button class="ghost" class:on={tab.view === -1} class:has-error={!!tab.error} onclick={() => (tab.view = -1)}>
        Messages {#if tab.messages.length}<span class="muted">({tab.messages.length})</span>{/if}
      </button>
      <span style:flex="1"></span>
      {#if current && current.count > 0}
        {#if truncated}
          <button class="small" onclick={() => (confirmingSave = true)} disabled={tab.running || tab.saving}>Save all rows...</button>
        {/if}
        <button class="small" onclick={() => exportAs("csv")} disabled={tab.running}>Export CSV</button>
        <button class="small" onclick={() => exportAs("json")} disabled={tab.running}>Export JSON</button>
      {/if}
    </div>
    {#if exportError}<p class="error banner">{exportError}</p>{/if}
    {#if confirmingSave}
      <p class="banner save-confirm" role="alert">
        Saving all rows runs the query again and writes every row straight to a file. Only a single SELECT can be saved
        this way, and the data may have changed since.
        <button class="small" onclick={saveAll}>Run again and save...</button>
        <button class="small" onclick={() => (confirmingSave = false)}>Cancel</button>
      </p>
    {:else if tab.saving}
      <p class="banner save-confirm" role="status">
        Saving all rows...
        <button class="small" onclick={() => workspace.cancel(tab)}>Cancel</button>
      </p>
    {/if}

    <div class="result-body">
      {#if current}
        {#if current.columns.length > 0}
          <ResultGrid set={current} />
        {:else}
          <p class="muted pad">No columns.</p>
        {/if}
      {:else if tab.view === -1}
        <div class="messages">
          {#each tab.messages as m (m.id)}
            {#if m.at}
              <button class="row error ghost" title="Show in the editor" onclick={() => workspace.reveal(tab, m)}
                ><span class="muted time">{(m.elapsedMs / 1000).toFixed(2)} s</span>{m.text}</button
              >
            {:else}
              <div class:error={m.kind === "error"}><span class="muted time">{(m.elapsedMs / 1000).toFixed(2)} s</span>{m.text}</div>
            {/if}
          {/each}
          {#if tab.error && !tab.messages.some((m) => m.kind === "error")}<div class="error">{tab.error}</div>{/if}
          {#if !tab.messages.length && !tab.error}
            {#if tab.running}{@render waiting()}{:else}<p class="muted">No messages.</p>{/if}
          {/if}
        </div>
      {:else if tab.running}
        {@render waiting()}
      {:else}
        <p class="muted pad">Run a query to see results here.</p>
      {/if}
    </div>
  </div>
</div>

<!-- Where the results will appear, while the query has produced none yet (issue #274). -->
{#snippet waiting()}
  <div class="waiting"><Spinner size={12} />Running... {elapsed.toFixed(1)} s</div>
{/snippet}

<style>
  .view {
    display: grid;
    grid-template-rows: auto auto var(--editor-h) 5px 1fr;
    height: 100%;
    min-height: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-sm);
  }
  .toolbar button {
    padding: 2px 14px;
  }
  .cancel {
    color: var(--bad);
  }
  .committed {
    color: var(--bad);
    font-weight: 600;
  }
  .database {
    max-width: 220px;
    padding: 1px 4px;
    font-size: var(--fs-sm);
  }
  .databases-error {
    color: var(--warn);
    font-size: var(--fs-sm);
    cursor: help;
  }
  .toolbar .link {
    color: var(--text-muted);
    font-size: var(--fs-xs);
  }
  .toolbar .link:hover {
    text-decoration: underline;
  }
  .target {
    padding-left: 8px;
    box-shadow: inset 3px 0 0 var(--band);
  }
  .ro {
    margin-left: 6px;
    padding: 0 6px;
    font-size: var(--fs-2xs);
    color: var(--warn);
    border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent);
    border-radius: 8px;
  }
  .picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 460px;
    padding: 10px 12px;
    font-size: var(--fs-sm);
  }
  .picker p {
    margin: 0;
  }
  .editor-host {
    min-height: 0;
    overflow: hidden;
  }
  .splitter {
    cursor: row-resize;
    background: var(--border);
    background-clip: content-box;
    padding: 2px 0;
  }
  .splitter:hover {
    background-color: var(--accent);
  }
  .results {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .result-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .result-tabs button {
    border-bottom: 2px solid transparent;
    border-radius: 0;
    padding: 3px 10px;
    font-size: var(--fs-sm);
  }
  .result-tabs button.on {
    border-bottom-color: var(--accent);
  }
  .result-tabs button.has-error {
    color: var(--bad);
  }
  .result-tabs .small {
    border: 1px solid var(--border);
    border-radius: 4px;
    margin: 0 0 4px 4px;
  }
  .result-body {
    flex: 1;
    min-height: 0;
  }
  .messages {
    height: 100%;
    overflow: auto;
    padding: 8px 12px;
    font: var(--fs-sm)/1.6 var(--font-mono);
    user-select: text;
  }
  .time {
    display: inline-block;
    width: 64px;
    text-indent: 0;
  }
  /* Postgres errors carry DETAIL and HINT lines: kept, and hung under the text rather than the time. */
  .messages > div,
  .messages > .row {
    white-space: pre-wrap;
    padding-left: 64px;
    text-indent: -64px;
  }
  .error {
    color: var(--bad);
  }
  /* A Messages row that moves the editor's cursor to its error: still reads as a line of text. */
  .row {
    display: block;
    width: 100%;
    padding: 0;
    font: inherit;
    text-align: left;
    cursor: pointer;
    user-select: text;
  }
  .row:hover {
    background: var(--bg-hover);
  }
  .banner {
    margin: 0;
    padding: 4px 12px;
  }
  .pad {
    padding: 12px;
    margin: 0;
  }
  /* Running feedback (issue #274): timer beside Cancel, a bar over the results, a spinner where results will appear. */
  .running {
    color: var(--accent);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .progress {
    position: relative;
    height: 2px;
    overflow: hidden;
    background: color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .progress::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    width: 30%;
    background: var(--accent);
    animation: slide 1.2s ease-in-out infinite;
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(340%);
    }
  }
  .waiting {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    height: 100%;
    min-height: 60px;
    color: var(--text);
    font-size: var(--fs-md);
    font-variant-numeric: tabular-nums;
  }
  @media (prefers-reduced-motion: reduce) {
    .progress::before {
      width: 100%;
      animation: none;
      opacity: 0.6;
    }
  }
  .save-confirm {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    margin: 0;
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--warn) 10%, transparent);
  }
</style>
