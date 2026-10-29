<script lang="ts">
  import { onMount } from "svelte";
  import type { UpdateState } from "../updates";
  import type { LoadReport } from "./tree-model";

  let {
    sidecar,
    sidecarText,
    inFlight,
    lastLoad,
    startup,
    update,
  }: {
    sidecar: "connecting" | "connected" | "disconnected";
    sidecarText: string;
    inFlight: { label: string; startedAt: number } | undefined;
    lastLoad: LoadReport | undefined;
    startup: string;
    update: UpdateState | undefined;
  } = $props();

  let now = $state(Date.now());
  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 100);
    return () => clearInterval(t);
  });

</script>

<footer class="status">
  <span class="item" title={startup}><span class="dot {sidecar}"></span>{sidecarText}</span>

  <span class="item grow">
    {#if inFlight}
      <span class="spinner"></span>Loading {inFlight.label}... {((now - inFlight.startedAt) / 1000).toFixed(1)} s
    {:else if lastLoad?.error}
      <span class="bad">{lastLoad.label}: {lastLoad.error}</span>
    {:else if lastLoad}
      {lastLoad.label}: {lastLoad.count} item{lastLoad.count === 1 ? "" : "s"} in
      <span class:slow={lastLoad.ms > 300}>{lastLoad.ms} ms</span>
    {/if}
  </span>

  {#if update?.kind === "available"}
    <span class="item" title="Download the new portable zip from GitHub Releases">v{update.next} available on GitHub</span>
  {:else if update?.kind === "downloading"}
    <span class="item">Downloading v{update.next}...</span>
  {:else if update?.kind === "ready"}
    <button class="update" onclick={() => update.kind === "ready" && update.install()}>Restart to update to v{update.next}</button>
  {:else if update?.kind === "error"}
    <span class="item muted" title={update.message}>Update check failed</span>
  {/if}
  {#if update}<span class="item muted">v{update.current}</span>{/if}
</footer>

<style>
  .status {
    display: flex;
    align-items: center;
    height: 24px;
    padding: 0 8px;
    font-size: 12px;
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
  .update {
    padding: 0 8px;
    font-size: 12px;
    color: #fff;
    background: var(--accent);
    border-color: var(--accent);
  }
  .spinner {
    width: 10px;
    height: 10px;
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
