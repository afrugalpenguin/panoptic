<script lang="ts">
  import IconButton from "./IconButton.svelte";
  import Spinner from "./Spinner.svelte";
  import { onMount } from "svelte";
  import type { UpdateState } from "../updates";
  import WarningIcon from "./rows/WarningIcon.svelte";
  import type { LoadReport } from "./tree-model";

  let {
    sidecar,
    sidecarText,
    inFlight,
    lastLoad,
    startup,
    update,
    onRestartToUpdate,
    problems,
    onOpenProblems,
    onCancelLoad,
    undo,
    summary,
    onSettings,
  }: {
    sidecar: "connecting" | "connected" | "disconnected";
    sidecarText: string;
    inFlight: { id: string; label: string; startedAt: number } | undefined;
    lastLoad: LoadReport | undefined;
    startup: string;
    update: UpdateState | undefined;
    /** Restart now into a downloaded update; otherwise it installs when Panoptic closes. */
    onRestartToUpdate: () => void;
    /** Explorer errors; shown as a count badge that opens the Problems tab. */
    problems: number;
    onOpenProblems: () => void;
    /** Stops the in-flight load shown by the elapsed timer. */
    onCancelLoad: (id: string) => void;
    /** The last delete while it can be undone (docs/explorer-ux.md, "Destructive actions"). */
    undo?: { text: string; run: () => void };
    /** The explorer's count, `3 environments · 20 connections` or `9 of 20 match` (explorer-view.ts summaryText). */
    summary?: string;
    /** Opens Settings; the gear waits for the database engine, as Settings does. */
    onSettings: () => void;
  } = $props();

  let now = $state(Date.now());
  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 100);
    return () => clearInterval(t);
  });

</script>

<footer class="status">
  <span class="item" title={startup}><span class="dot {sidecar}"></span>{sidecarText}</span>
  {#if summary}
    <span class="divider" aria-hidden="true"></span>
    <span class="item muted" role="status">{summary}</span>
  {/if}

  {#if undo}
    <span class="item">{undo.text} - <button class="cancel ghost" onclick={undo.run}>Undo</button></span>
  {/if}

  <span class="item grow">
    {#if inFlight}
      <Spinner />Loading {inFlight.label}... {((now - inFlight.startedAt) / 1000).toFixed(1)} s
      <button class="cancel" title="Stop loading {inFlight.label}" onclick={() => inFlight && onCancelLoad(inFlight.id)}>Cancel</button>
    {:else if lastLoad?.error}
      <span class="bad">{lastLoad.label}: {lastLoad.error}</span>
    {:else if lastLoad}
      {lastLoad.label}: {lastLoad.count} item{lastLoad.count === 1 ? "" : "s"} in
      <span class:slow={lastLoad.ms > 300}>{lastLoad.ms} ms</span>
    {/if}
  </span>

  {#if problems > 0}
    <button class="problems ghost" title="Open Problems" onclick={onOpenProblems}>
      <WarningIcon small />{problems} problem{problems === 1 ? "" : "s"}
    </button>
  {/if}
  {#if update?.kind === "available"}
    <span class="item" title="Download the new portable zip from GitHub Releases">v{update.next} available on GitHub</span>
  {:else if update?.kind === "downloading"}
    <span class="item">Downloading v{update.next}...</span>
  {:else if update?.kind === "ready"}
    <span class="item muted" title="Downloaded. It installs when you close Panoptic, so the next start is on it.">v{update.next} installs when you close Panoptic</span>
    <button class="update" onclick={onRestartToUpdate}>Restart now</button>
  {:else if update?.kind === "error"}
    <span class="item muted" title={update.message}>Update check failed</span>
  {:else if update?.kind === "installFailed"}
    <span class="item bad" title={update.message}>Update failed: {update.message}</span>
  {/if}
  {#if update}<span class="item muted">v{update.current}</span>{/if}
  <span class="divider" aria-hidden="true"></span>
  <IconButton icon="settings" label="Settings" tooltip="Settings (Ctrl+,)" disabled={sidecar !== "connected"} onclick={onSettings} />
</footer>

<style>
  .status {
    display: flex;
    align-items: center;
    height: 24px;
    padding: 0 8px;
    font-size: var(--fs-sm);
    border-top: 1px solid var(--border);
    background: var(--bg-pane);
    white-space: nowrap;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grow {
    flex: 1;
  }
  .divider {
    flex: none;
    width: 1px;
    height: 14px;
    background: var(--border);
  }
  /* The gear fits the 24px bar; its hover is IconButton's, the same --bg-hover as the bar's other buttons. */
  .status :global(.icon-button) {
    flex: none;
    width: 24px;
    height: 20px;
    margin-left: 4px;
    border-radius: 4px;
  }
  .status :global(.icon-button svg) {
    width: 14px;
    height: 14px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-muted);
  }
  .dot.connected {
    background: var(--ok);
  }
  .dot.disconnected {
    background: var(--bad);
  }
  .bad,
  .slow {
    color: var(--bad);
  }
  .problems {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 8px;
    font-size: var(--fs-sm);
    color: var(--bad);
  }
  .cancel {
    padding: 0 6px;
    font-size: var(--fs-sm);
    color: var(--accent);
  }
  .cancel:hover,
  .problems:hover {
    background: var(--bg-hover);
  }
  .update {
    padding: 0 8px;
    font-size: var(--fs-sm);
    color: var(--on-accent);
    background: var(--accent-fill);
    border-color: var(--accent-fill);
  }
</style>
