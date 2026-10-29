<script lang="ts">
  import QueryView from "./QueryView.svelte";
  import type { QueryWorkspace } from "./store.svelte";

  let { workspace }: { workspace: QueryWorkspace } = $props();
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
        style:--band={tab.target.envColor ?? "transparent"}
        onclick={() => (workspace.activeId = tab.id)}
        onkeydown={(e) => e.key === "Enter" && (workspace.activeId = tab.id)}
        onauxclick={(e) => e.button === 1 && workspace.close(tab.id)}
        title="{tab.target.connection} / {tab.target.label}"
      >
        {#if tab.running}<span class="spinner"></span>{/if}
        <span class="title">{tab.title}</span>
        <button class="close" aria-label="Close {tab.title}" onclick={(e) => (e.stopPropagation(), workspace.close(tab.id))}>x</button>
      </div>
    {/each}
  </div>
  {#each workspace.tabs as tab (tab.id)}
    <!-- Every tab stays mounted so its editor keeps its undo history and cursor; only the active one shows. -->
    <div class="body" hidden={tab.id !== workspace.activeId}>
      <QueryView {tab} {workspace} />
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
