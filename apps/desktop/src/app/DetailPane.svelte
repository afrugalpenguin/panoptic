<script lang="ts">
  import { detailFields } from "./detail-fields";
  import type { EnvironmentPaneProps } from "./env-pane";
  import EnvironmentPane from "./EnvironmentPane.svelte";
  import Icon from "./Icon.svelte";
  import type { MenuEntry } from "./row-menu";
  import type { Row } from "./tree-model";

  // Shown for a selected row; with nothing selected App shows the landing instead (docs/landing.md).
  // actions: the row's right-click menu (rowMenu), offered as buttons too. environment: the selected environment's
  // pane (docs/environment-pane.md), which replaces the buttons and fields for an environment.
  let { row, actions = [], environment }: { row: Row; actions?: MenuEntry[]; environment?: EnvironmentPaneProps } = $props();

  const node = $derived(row.type === "node" ? row.node : undefined);
  const fields = $derived(node ? detailFields(node) : []);
  const buttons = $derived(actions.filter((a) => a !== "separator"));
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

{#if environment && row.type === "node" && row.node.kind === "environment"}
  <EnvironmentPane {...environment} />
{:else}
<section class="detail">
  {#if row.type === "group"}
    <header><h2>Ungrouped</h2></header>
    <p class="muted">Connections not in an environment. Drag one onto an environment to group it.</p>
  {:else if row.type === "error"}
    <h2 class="error">Could not load</h2>
    <p>{row.error.summary}{#if row.error.code} <span class="muted">({row.error.code})</span>{/if}</p>
    <pre class="message">{row.error.detail}</pre>
    <p class="muted">Press F5 on the parent to retry.</p>
  {:else if node}
    <header>
      <Icon icon={node.icon} />
      <h2>{node.label}</h2>
      <span class="kind">{label(node.kind)}</span>
    </header>
    {#if buttons.length}
      <div class="actions">
        {#each buttons as a}
          <button type="button" class:danger={a.danger} disabled={a.disabled} onclick={a.run}>{a.label}</button>
        {/each}
      </div>
    {/if}
    {#if fields.length}
      <dl>
        {#each fields as f}
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        {/each}
      </dl>
    {/if}
    {#if json}
      <pre class="json">{json}</pre>
    {/if}
  {/if}
</section>
{/if}

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
    font-size: var(--fs-xl);
    font-weight: 600;
    user-select: text;
  }
  .kind {
    color: var(--text-muted);
    font-size: var(--fs-sm);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 14px 0 0;
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
</style>
