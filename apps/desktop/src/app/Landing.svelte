<script lang="ts">
  // The empty-workspace landing (docs/landing.md): shown when no tab is open and nothing is selected. Seek, a short
  // action list, the engine's status and a faded wordmark. Renders and forwards only; App does the work.
  import mark from "../../src-tauri/icons/icon.svg";
  import SeekBox from "./SeekBox.svelte";
  import { livePlace, type SeekIndex, type SeekRow } from "./seek";

  let {
    index,
    envCount,
    version,
    engine,
    openedMs,
    query = $bindable(""),
    onSeekOpen,
    onSeekQuery,
    onSeekLeave,
    onReopen,
    onNewQuery,
    onNewConnection,
    onImport,
    onRestart,
  }: {
    index: SeekIndex;
    envCount: number;
    version?: string;
    engine: "connecting" | "connected" | "disconnected";
    /** Launch to engine ready, once known. */
    openedMs?: number;
    query?: string;
    onSeekOpen: (row: SeekRow) => void;
    onSeekQuery: (row: SeekRow) => void;
    onSeekLeave: () => void;
    onReopen: () => void;
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

  const last = $derived(livePlace(index));
  const lastPath = $derived(last ? [index.envs.find((e) => e.id === last.envId)?.name, last.hostName, last.label].join(" / ") : "");
  const hint = $derived(
    envCount
      ? `Objects across all ${envCount} environment${envCount === 1 ? "" : "s"}. Type a table, container, proc or host.`
      : "No environments yet",
  );
</script>

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
      autofocus
      placeholder="Seek anything, anywhere"
      label="Seek environments, connections and objects"
      onOpen={onSeekOpen}
      onQuery={onSeekQuery}
      onLeave={onSeekLeave}
    />
    <p class="muted-line">{hint}</p>

    <ul class="actions">
      {#if last}
        <li>
          <button onclick={onReopen}>
            <svg class="amber" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4" />
              <path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
            </svg>
            <span class="label">Reopen last session</span>
            <span class="where">{lastPath}</span>
          </button>
        </li>
      {/if}
      <li>
        <button onclick={onNewQuery}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M3.5 1.5h6l3 3v10h-9z M9.5 1.5v3h3 M8 7.5v5 M5.5 10h5" fill="none" stroke="currentColor" stroke-width="1.3" />
          </svg>
          <span class="label">New query</span>
          <kbd>Ctrl N</kbd>
        </button>
      </li>
      <li>
        <button onclick={onNewConnection}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <ellipse cx="7" cy="3.5" rx="4.5" ry="1.8" fill="none" stroke="currentColor" stroke-width="1.3" />
            <path d="M2.5 3.5v8c0 1 2 1.8 4.5 1.8 M11.5 3.5V8 M2.5 7.5c0 1 2 1.8 4.5 1.8 M12 10.5v4 M10 12.5h4" fill="none" stroke="currentColor" stroke-width="1.3" />
          </svg>
          <span class="label">New connection</span>
          <kbd>Ctrl Shift N</kbd>
        </button>
      </li>
      <li class="dim">
        <button onclick={onImport}>
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M8 2v8 M5 7l3 3 3-3 M2.5 11v2.5h11V11" fill="none" stroke="currentColor" stroke-width="1.3" />
          </svg>
          <span class="label">Import</span>
          <kbd>Ctrl I</kbd>
        </button>
      </li>
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
    font-size: 16px;
    font-weight: 600;
    letter-spacing: 2.4px;
  }
  .spacer {
    flex: 1;
  }
  .version {
    color: var(--text-muted);
    font: 11px var(--font-mono);
  }
  .muted-line {
    margin: 0;
    color: var(--text-muted);
    font-size: 12px;
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
    border: none;
    border-radius: 6px;
    background: none;
    color: var(--text);
    font: 13px var(--font-ui);
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
  .actions svg.amber {
    color: var(--brand-amber);
  }
  .label {
    flex: none;
  }
  .where {
    margin-left: auto;
    overflow: hidden;
    color: var(--text-muted);
    font: 11px var(--font-mono);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  kbd {
    margin-left: auto;
    padding: 1px 6px;
    border: 1px solid var(--kbd-border);
    border-radius: 4px;
    background: var(--kbd-bg);
    color: var(--text-muted);
    font: 11px var(--font-mono);
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
    font: 11px var(--font-mono);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--brand-amber);
  }
  .link {
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
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
