<script lang="ts">
  // The rail's destructive action, pinned to its bottom: a full-width ghost danger button and a short note under it.
  let { label, note, onclick }: { label: string; note: string; onclick: () => void } = $props();
</script>

<div class="delete">
  <button type="button" class="ghost danger" {onclick}>{label}</button>
  <p>{note}</p>
</div>

<style>
  .delete {
    margin-top: auto;
  }
  button {
    width: 100%;
    height: 32px;
    border: 1px solid color-mix(in srgb, var(--bad) 45%, transparent);
    border-radius: 6px;
    color: var(--bad);
  }
  button:hover {
    background: color-mix(in srgb, var(--bad) 12%, transparent);
  }
  p {
    margin: 8px 0 0;
    font-size: var(--fs-sm);
    text-align: center;
    color: var(--tree-dim);
  }
</style>
