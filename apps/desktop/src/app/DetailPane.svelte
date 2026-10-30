<script lang="ts">
  import Icon from "./Icon.svelte";
  import type { Row } from "./tree-model";

  let { row, onAddEnvironment, onImport }: { row: Row | undefined; onAddEnvironment: () => void; onImport: () => void } = $props();

  const HIDDEN_META = new Set(["json", "environmentId", "connectionId"]);

  const node = $derived(row?.type === "node" ? row.node : undefined);
  const meta = $derived(Object.entries(node?.meta ?? {}).filter(([k]) => !HIDDEN_META.has(k)));
  const json = $derived.by(() => {
    const raw = node?.meta?.json;
    if (!raw) return "";
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  });

  const label = (key: string) => key.replace(/([A-Z])/g, " $1").toLowerCase();
</script>

<section class="detail">
  {#if !row}
    <div class="empty">
      <h2>Panoptic</h2>
      <p class="muted">Every environment in one tree. Bring your saved connections across, or start from scratch.</p>
      <div class="actions">
        <button class="primary" onclick={onImport}>Import from SSMS</button>
        <button onclick={onAddEnvironment}>New environment</button>
      </div>
      <p class="muted keys">
        Arrows to move, Right/Left to expand and collapse, type to jump, F5 to refresh, right-click for actions.
      </p>
    </div>
  {:else if row.type === "error"}
    <h2 class="error">Could not load</h2>
    <p>{row.error.summary}{#if row.error.code} <span class="muted">({row.error.code})</span>{/if}</p>
    <pre class="message">{row.error.detail}</pre>
    <p class="muted">Press F5 on the parent to retry.</p>
  {:else if node}
    <header>
      {#if node.kind === "environment"}
        <span class="swatch" style:background={node.meta?.color}></span>
      {:else}
        <Icon icon={node.icon} />
      {/if}
      <h2>{node.label}</h2>
      <span class="kind">{label(node.kind)}</span>
    </header>
    {#if meta.length}
      <dl>
        {#each meta as [k, v]}
          <dt>{label(k)}</dt>
          <dd>{v}</dd>
        {/each}
      </dl>
    {/if}
    {#if json}
      <pre class="json">{json}</pre>
    {/if}
  {/if}
</section>

<style>
  .detail {
    height: 100%;
    overflow: auto;
    padding: 20px 24px;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    user-select: text;
  }
  .kind {
    color: var(--text-muted);
    font-size: 12px;
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
  }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 4px 16px;
    margin: 16px 0;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    user-select: text;
    overflow-wrap: anywhere;
  }
  .json,
  .message {
    padding: 12px;
    border-radius: 6px;
    background: var(--bg);
    border: 1px solid var(--border);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .error {
    color: var(--bad);
  }
  .empty {
    max-width: 420px;
    margin: 12vh auto 0;
    text-align: center;
  }
  .empty h2 {
    font-size: 22px;
    margin-bottom: 8px;
  }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: center;
  }
  .keys {
    margin-top: 24px;
    font-size: 12px;
  }
</style>
