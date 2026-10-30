<script lang="ts">
  import { tick } from "svelte";
  import WarningIcon from "../app/rows/WarningIcon.svelte";
  import type { ProblemsTab } from "./store.svelte";

  let { tab }: { tab: ProblemsTab } = $props();

  let list: HTMLElement;
  let highlighted = $state<string>();

  // Click on a tree error row: scroll to its entry and flash it.
  $effect(() => {
    const focus = tab.focus;
    if (!focus) return;
    void tick().then(() => {
      const el = [...list.querySelectorAll<HTMLElement>("[data-node]")].find((e) => e.dataset.node === focus.nodeId);
      el?.scrollIntoView({ block: "nearest" });
      highlighted = focus.nodeId;
    });
  });

  const time = (at: number) => new Date(at).toLocaleTimeString();
</script>

<div class="problems" bind:this={list}>
  {#each tab.entries as p (p.nodeId)}
    <section class="entry" class:highlighted={p.nodeId === highlighted} data-node={p.nodeId}>
      <header>
        <WarningIcon />
        <span class="summary">{p.error.summary}</span>
        {#if p.error.code}<code class="code">{p.error.code}</code>{/if}
        <span class="time">{time(p.at)}</span>
      </header>
      <div class="where">{[p.env, p.connection, ...p.path].filter(Boolean).join(" / ")}</div>
      <div class="detail">
        <pre>{p.error.detail}</pre>
        <button class="copy" onclick={() => navigator.clipboard.writeText(p.error.detail).catch(() => {})}>Copy</button>
      </div>
    </section>
  {:else}
    <p class="muted">No problems. Explorer errors show here until the node loads.</p>
  {/each}
</div>

<style>
  .problems {
    height: 100%;
    overflow: auto;
    padding: 12px 16px 40px;
    font: 12px/1.5 var(--font-ui);
    user-select: text;
  }
  .entry {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    transition: border-color 0.6s;
  }
  .entry + .entry {
    margin-top: 10px;
  }
  .entry.highlighted {
    border-color: var(--accent);
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .summary {
    font-weight: 600;
  }
  .code {
    padding: 0 4px;
    border-radius: 3px;
    background: var(--bg-hover);
    font-size: 11px;
  }
  .time {
    margin-left: auto;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .where {
    margin: 2px 0 8px 20px;
    color: var(--text-muted);
  }
  .detail {
    position: relative;
  }
  pre {
    margin: 0;
    padding: 8px 10px;
    max-height: 240px;
    overflow: auto;
    border-radius: 3px;
    background: var(--bg-hover);
    font: 11.5px/1.45 var(--font-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .copy {
    position: absolute;
    top: 6px;
    right: 6px;
    padding: 1px 8px;
    font-size: 11px;
  }
  p {
    margin: 0;
  }
</style>
