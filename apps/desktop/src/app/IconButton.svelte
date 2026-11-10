
<script lang="ts">
  import { FILLED, GLYPHS, type GlyphName as IconName } from "./glyphs";
  let {
    icon,
    label,
    tooltip = label,
    disabled = false,
    onclick,
  }: { icon: IconName; label: string; /** Defaults to the label; set it to add a shortcut hint. */ tooltip?: string; disabled?: boolean; onclick: () => void } = $props();
</script>

<button class="icon-button ghost" type="button" aria-label={label} title={tooltip} {disabled} {onclick}>
  <svg viewBox="0 0 16 16" aria-hidden="true">
    {#if FILLED.has(icon)}
      <path d={GLYPHS[icon]} fill="currentColor" fill-rule="evenodd" />
    {:else}
      <path d={GLYPHS[icon]} fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
    {/if}
  </svg>
</button>

<style>
  .icon-button {
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border-radius: 5px;
    color: var(--text-muted);
  }
  .icon-button:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text);
  }
  svg {
    width: 16px;
    height: 16px;
  }
</style>
