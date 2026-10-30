<script lang="ts">
  import { onMount } from "svelte";
  import { save } from "@tauri-apps/plugin-dialog";
  import { writeTextFile } from "@tauri-apps/plugin-fs";
  import { toCsv, toJson } from "./export";
  import QueryEditor from "./QueryEditor.svelte";
  import ResultGrid from "./ResultGrid.svelte";
  import type { QueryTab, QueryWorkspace } from "./store.svelte";

  let { tab, workspace }: { tab: QueryTab; workspace: QueryWorkspace } = $props();

  let editorHeight = $state(readSplit());
  let now = $state(Date.now());
  let exportError = $state<string>();

  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 100);
    return () => clearInterval(t);
  });

  const elapsed = $derived(((tab.running ? now : tab.startedAt + (tab.summary?.elapsedMs ?? 0)) - tab.startedAt) / 1000);
  const current = $derived(tab.view >= 0 ? tab.results[tab.view] : undefined);
  // Each tab has its own QueryView (keyed in Workspace), but read the props at call time all the same.
  const intellisense = () => workspace.intellisense(tab)();
  const status = $derived(workspace.intellisenseStatus(tab));
  /** The picker lists the connection's databases, plus the tab's own if the list has not loaded or lacks it. */
  const database = $derived(workspace.databaseOf(tab));
  const databaseOptions = $derived(database && !tab.databases.includes(database) ? [database, ...tab.databases] : tab.databases);

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
    const top = target.parentElement!.getBoundingClientRect().top;
    const move = (ev: PointerEvent) => (editorHeight = Math.max(80, Math.min(window.innerHeight - 200, ev.clientY - top - 36)));
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
    {:else}
      <button class="primary" onclick={() => workspace.run(tab)} title="Run (F5 or Ctrl+Enter); runs the selection if there is one">Run</button>
    {/if}
    <span class="target" style:--band={tab.target.envColor ?? "transparent"}>
      {tab.target.connection} / {tab.target.label}
      {#if tab.target.readOnly}<span
          class="ro"
          title="SQL runs in a transaction that is rolled back at the end. A COMMIT in the script ends it early (the remaining batches are then skipped), and side effects outside the database transaction (xp_cmdshell, sp_send_dbmail, linked servers) are not rolled back. A read-only login is the real protection."
          >read-only</span
        >{/if}
    </span>
    {#if databaseOptions.length > 0}
      <select
        class="database"
        aria-label="Database"
        title="Database this tab runs against"
        value={database}
        onchange={(e) => workspace.setDatabase(tab, e.currentTarget.value)}
      >
        {#each databaseOptions as name (name)}<option value={name}>{name}</option>{/each}
      </select>
    {/if}
    <button class="link muted" title={status.title ?? "Rebuild completions for this database"} onclick={() => workspace.refreshCatalog(tab)}
      >{status.text}</button
    >
    <span style:flex="1"></span>
    {#if tab.running}
      <span class="muted">Running... {elapsed.toFixed(1)} s</span>
    {:else if tab.summary}
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

  <div class="editor-host">
    <QueryEditor bind:text={tab.text} language={tab.target.language} {intellisense} onRun={(selection) => workspace.run(tab, selection)} />
  </div>

  <div class="splitter" role="separator" aria-orientation="horizontal" onpointerdown={startResize}></div>

  <div class="results">
    <div class="result-tabs">
      {#each tab.results as set, i}
        <button class:on={tab.view === i} onclick={() => (tab.view = i)}>
          Result {tab.results.length > 1 ? i + 1 : ""} <span class="muted">({set.count.toLocaleString()} row{set.count === 1 ? "" : "s"})</span>
        </button>
      {/each}
      <button class:on={tab.view === -1} class:has-error={!!tab.error} onclick={() => (tab.view = -1)}>
        Messages {#if tab.messages.length}<span class="muted">({tab.messages.length})</span>{/if}
      </button>
      <span style:flex="1"></span>
      {#if current && current.count > 0}
        <button class="small" onclick={() => exportAs("csv")} disabled={tab.running}>Export CSV</button>
        <button class="small" onclick={() => exportAs("json")} disabled={tab.running}>Export JSON</button>
      {/if}
    </div>
    {#if exportError}<p class="error banner">{exportError}</p>{/if}

    <div class="result-body">
      {#if current}
        {#if current.columns.length > 0}
          <ResultGrid set={current} />
        {:else}
          <p class="muted pad">No columns.</p>
        {/if}
      {:else if tab.view === -1}
        <div class="messages">
          {#each tab.messages as m}
            <div class:error={m.kind === "error"}><span class="muted time">{(m.elapsedMs / 1000).toFixed(2)} s</span>{m.text}</div>
          {/each}
          {#if tab.error && !tab.messages.some((m) => m.kind === "error")}<div class="error">{tab.error}</div>{/if}
          {#if !tab.messages.length && !tab.error}<p class="muted">{tab.running ? "Running..." : "No messages."}</p>{/if}
        </div>
      {:else}
        <p class="muted pad">{tab.running ? "Waiting for the first rows..." : "Run a query to see results here."}</p>
      {/if}
    </div>
  </div>
</div>

<style>
  .view {
    display: grid;
    grid-template-rows: auto var(--editor-h) 5px 1fr;
    height: 100%;
    min-height: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
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
    font-size: 12px;
  }
  .toolbar .link {
    padding: 0;
    border: none;
    background: none;
    font-size: 11px;
    cursor: pointer;
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
    font-size: 10px;
    color: var(--warn);
    border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent);
    border-radius: 8px;
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
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    background: none;
    padding: 3px 10px;
    font-size: 12px;
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
    font: 12px/1.6 var(--font-mono);
    user-select: text;
  }
  .time {
    display: inline-block;
    width: 64px;
  }
  .error {
    color: var(--bad);
  }
  .banner {
    margin: 0;
    padding: 4px 12px;
  }
  .pad {
    padding: 12px;
    margin: 0;
  }
</style>
