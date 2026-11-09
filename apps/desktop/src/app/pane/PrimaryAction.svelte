<script lang="ts">
  // A detail pane's primary header action (amber, dark text) with its key chip inside.
  import Kbd from "../Kbd.svelte";

  let { label, keys, disabled = false, onclick }: { label: string; keys: string; disabled?: boolean; onclick: () => void } = $props();
</script>

<button type="button" class="new" {disabled} {onclick}>{label} <Kbd {keys} /></button>

<style>
  button.new {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 8px 0 12px;
    border: none;
    border-radius: 6px;
    background: var(--action-primary);
    color: var(--on-action-primary);
    font-weight: 600;
  }
  button.new:hover:not(:disabled) {
    background: var(--action-primary);
    filter: brightness(1.08);
  }
  button.new :global(kbd) {
    background: rgb(0 0 0 / 0.12);
    border-color: rgb(0 0 0 / 0.2);
    color: var(--on-action-primary);
  }
</style>
