<script lang="ts">
  import { GLYPHS } from "./glyphs";
  import Kbd from "./Kbd.svelte";
  // The empty-workspace landing (docs/landing.md): shown when no tab is open and nothing is selected. Seek, a short
  // action list, the engine's status and a faded wordmark. Renders and forwards only; App does the work.
  import mark from "../../src-tauri/icons/icon.svg";
  import SeekBox from "./SeekBox.svelte";
  import { seekSummary, type SeekIndex, type SeekRow } from "./seek";

  let {
    index,
    envCount,
    connectionCount,
    version,
    engine,
    openedMs,
    firstRun = false,
    query = $bindable(""),
    onSeekOpen,
    onSeekQuery,
    onSeekLeave,
    onNewQuery,
    onNewConnection,
    onImport,
    onRestart,
  }: {
    index: SeekIndex;
    envCount: number;
    /** Every connection, in an environment or not: the muted line counts these when there are no environments. */
    connectionCount: number;
    version?: string;
    engine: "connecting" | "connected" | "disconnected";
    /** Launch to engine ready, once known. */
    openedMs?: number;
    /** Config loaded and no connections yet: lead with Import and New connection (#220). */
    firstRun?: boolean;
    query?: string;
    onSeekOpen: (row: SeekRow) => void;
    onSeekQuery: (row: SeekRow) => void;
    onSeekLeave: () => void;
    onNewQuery: () => void;
    /** Opens the connection dialog, environment None (App's addConnection). */
    onNewConnection: () => void;
    onImport: () => void;
    onRestart: () => void;
  } = $props();

  let box = $state<SeekBox>();
  export function focus() {
    box?.focus();
  }

  const hint = $derived(seekSummary(envCount, connectionCount));

  // A first run has nothing to seek: start on Import, the action a new user most likely needs (#220).
  let importButton = $state<HTMLButtonElement>();
  $effect(() => {
    if (firstRun) importButton?.focus();
  });
</script>

{#snippet newQueryAction()}
  <li>
    <button class="ghost" onclick={onNewQuery}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={GLYPHS.query} fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <span class="label">New query</span>
      <Kbd keys="Ctrl N" />
    </button>
  </li>
{/snippet}

{#snippet newConnectionAction(why?: string)}
  <li>
    <button class="ghost" onclick={onNewConnection}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={GLYPHS.connection} fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <span class="label">New connection</span>
      {#if why}<span class="why">{why}</span>{/if}
      <Kbd keys="Ctrl Shift N" />
    </button>
  </li>
{/snippet}

{#snippet importAction(why?: string)}
  <li class:dim={!why}>
    <button class="ghost" bind:this={importButton} onclick={onImport}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d={GLYPHS.import} fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <span class="label">Import</span>
      {#if why}<span class="why">{why}</span>{/if}
      <Kbd keys="Ctrl I" />
    </button>
  </li>
{/snippet}

<section class="landing">
  <div class="column">
    <header>
      <img src={mark} width="32" height="32" alt="" />
      <span class="name">PANOPTIC</span>
      <span class="spacer"></span>
      {#if version}<span class="version">v{version}</span>{/if}
    </header>

    <SeekBox
      bind:this={box}
      bind:query
      {index}
      chip="Ctrl P"
      autofocus={!firstRun}
      placeholder="Environments, connections, recent objects"
      label="Seek environments, connections and objects"
      onOpen={onSeekOpen}
      onQuery={onSeekQuery}
      onLeave={onSeekLeave}
    />
    <p class="muted-line">{hint}</p>

    <!-- The last place is Seek's first row ("Pick up where you left off"), so it is not repeated here (#223). -->
    <ul class="actions">
      {#if firstRun}
        {@render importAction("Bring in saved connections from SSMS, Azure Data Studio or VS Code.")}
        {@render newConnectionAction("Add a server or account by hand.")}
        {@render newQueryAction()}
      {:else}
        {@render newQueryAction()}
        {@render newConnectionAction()}
        {@render importAction()}
      {/if}
    </ul>
  </div>

  <p class="status">
    {#if engine === "connected"}
      <span class="dot"></span>Ready{#if openedMs !== undefined}&nbsp;· opened in {openedMs} ms{/if}
    {:else if engine === "connecting"}
      Starting database engine...
    {:else}
      Database engine stopped <button class="link" onclick={onRestart}>Restart</button>
    {/if}
  </p>

  <div class="wordmark" aria-hidden="true">Panoptic</div>
</section>

<style>
  .landing {
    position: relative;
    overflow: hidden;
    height: 100%;
    background: var(--landing-bg);
  }
  .column {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 460px;
    margin: 0 auto;
    padding: 12vh 16px 64px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .name {
    color: var(--text-muted);
    font-size: var(--fs-xl);
    font-weight: 600;
    letter-spacing: 2.4px;
  }
  .spacer {
    flex: 1;
  }
  .version {
    color: var(--text-muted);
    font: var(--fs-xs) var(--font-mono);
  }
  .muted-line {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-sm);
  }
  .actions {
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
  }
  .actions li + li {
    border-top: 1px solid var(--border);
  }
  .actions button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    height: 44px;
    padding: 0 8px;
    border-radius: 6px;
    color: var(--text);
    font: var(--fs-md) var(--font-ui);
    text-align: left;
    cursor: pointer;
  }
  .actions button:hover,
  .actions button:focus-visible {
    background: var(--bg-hover);
  }
  .actions svg {
    flex: none;
    color: var(--text-muted);
  }
  .label {
    flex: none;
  }
  /* First run only: one line on what the action is for. */
  .why {
    min-width: 0;
    overflow: hidden;
    color: var(--text-muted);
    font: var(--fs-sm) var(--font-ui);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .actions :global(kbd) {
    margin-left: auto;
  }
  .dim {
    opacity: 0.6;
  }
  .status {
    position: absolute;
    left: 16px;
    bottom: 12px;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--text-muted);
    font: var(--fs-xs) var(--font-mono);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
  }
  .wordmark {
    position: absolute;
    right: -28px;
    bottom: -58px;
    z-index: 0;
    color: var(--wordmark-faded);
    font: 700 300px/1 var(--font-ui);
    pointer-events: none;
    user-select: none;
    white-space: nowrap;
  }
</style>
