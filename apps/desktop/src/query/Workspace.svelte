<script lang="ts">
  import logo from "../../src-tauri/icons/32x32.png";
  import ProblemsView from "./ProblemsView.svelte";
  import QueryView from "./QueryView.svelte";
  import WhatsNewView from "./WhatsNewView.svelte";
  import type { SeekHost, SeekIndex } from "../app/seek";
  import type { QueryTab, QueryWorkspace } from "./store.svelte";

  let {
    workspace,
    onLinkError,
    seekIndex,
    onConnect,
  }: {
    workspace: QueryWorkspace;
    /** For an unconnected tab's connection picker. */
    seekIndex: SeekIndex;
    onConnect: (tab: QueryTab, host: SeekHost) => void;
    /** A What's new link failed to open; the message goes to the status bar. */
    onLinkError: (message: string) => void;
  } = $props();
</script>

<div class="workspace">
  <div class="tabs" role="tablist">
    {#each workspace.tabs as tab (tab.id)}
      <div
        class="tab"
        class:on={tab.id === workspace.activeId}
        role="tab"
        tabindex="0"
        aria-selected={tab.id === workspace.activeId}
        style:--band={tab.kind === "query" ? (tab.target?.envColor ?? "transparent") : "transparent"}
        onclick={() => (workspace.activeId = tab.id)}
        onkeydown={(e) => e.key === "Enter" && (workspace.activeId = tab.id)}
        onauxclick={(e) => e.button === 1 && workspace.close(tab.id)}
        title={tab.kind === "query" && tab.target ? `${tab.target.connection} / ${tab.target.label}` : tab.title}
      >
        {#if tab.kind === "query" && tab.running}<span class="spinner"></span>{/if}
        {#if tab.kind === "whats-new"}<img class="icon" src={logo} alt="" />{/if}
        <span class="title">{tab.title}</span>
        <button class="close" aria-label="Close {tab.title}" onclick={(e) => (e.stopPropagation(), workspace.close(tab.id))}>x</button>
      </div>
    {/each}
  </div>
  {#each workspace.tabs as tab (tab.id)}
    <!-- Every tab stays mounted so its editor keeps its undo history and cursor; only the active one shows. -->
    <div class="body" hidden={tab.id !== workspace.activeId}>
      {#if tab.kind === "query"}
        <QueryView {tab} {workspace} {seekIndex} {onConnect} />
      {:else if tab.kind === "problems"}
        <ProblemsView {tab} />
      {:else}
        <WhatsNewView {tab} {onLinkError} />
      {/if}
    </div>
  {/each}
</div>

<style>
  .workspace {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }
  .tabs {
    display: flex;
    overflow-x: auto;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 240px;
    padding: 6px 6px 6px 12px;
    border-right: 1px solid var(--border);
    box-shadow: inset 0 3px 0 var(--band);
    font-size: 12px;
    cursor: default;
    white-space: nowrap;
  }
  .tab.on {
    background: var(--bg-pane);
  }
  .icon {
    width: 14px;
    height: 14px;
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .close {
    border: none;
    background: none;
    padding: 0 5px;
    color: var(--text-muted);
    font-size: 11px;
  }
  .close:hover {
    color: var(--text);
  }
  .body {
    flex: 1;
    min-height: 0;
  }
  .body[hidden] {
    display: none;
  }
  .spinner {
    width: 9px;
    height: 9px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
