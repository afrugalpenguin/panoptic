<script lang="ts">
  // A property value that opens a popover below-right: a menu of choices or a small editor. A click elsewhere or
  // Escape closes it.
  import type { Snippet } from "svelte";
  import Glyph from "./Glyph.svelte";

  let {
    label,
    popup,
    popoverLabel,
    open = $bindable(false),
    value,
    children,
  }: {
    /** The button's accessible name, e.g. "Write policy Allowed". */
    label: string;
    /** A menu of choices, or a dialog (an editor). */
    popup: "menu" | "dialog";
    /** The popover's accessible name. */
    popoverLabel: string;
    open?: boolean;
    /** What the button shows, before its chevron. */
    value: Snippet;
    /** The popover's content; the caller closes it by setting open to false. */
    children: Snippet;
  } = $props();

  let root = $state<HTMLElement>();

  function onWindowPointer(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key !== "Escape" || !open) return;
    e.preventDefault();
    e.stopPropagation();
    open = false;
  }
</script>

<svelte:window onpointerdown={onWindowPointer} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span class="anchor" bind:this={root} {onkeydown}>
  <button type="button" class="ghost value" aria-label={label} aria-haspopup={popup} aria-expanded={open} onclick={() => (open = !open)}>
    {@render value()}<Glyph name="chevron" />
  </button>
  {#if open}
    <div class="popover" class:menu={popup === "menu"} role={popup} aria-label={popoverLabel}>
      {@render children()}
    </div>
  {/if}
</span>

<style>
  .anchor {
    position: relative;
    display: inline-flex;
    min-width: 0;
  }
  button.value {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    height: 22px;
    padding: 0 4px 0 6px;
    border-radius: 4px;
    color: var(--text);
  }
  button.value:hover {
    background: var(--bg-hover);
  }
  button.value > :global(svg:last-child) {
    color: var(--text-muted);
  }
  .popover {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 10;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--bg-pane);
    box-shadow: var(--shadow-popover);
  }
  .menu {
    display: flex;
    flex-direction: column;
    min-width: 140px;
    padding: 4px;
  }
  .menu :global(button) {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 4px;
    text-align: left;
    white-space: nowrap;
  }
  .menu :global(button:hover:not(:disabled)) {
    background: var(--bg-hover);
  }
  .menu :global(hr) {
    width: 100%;
    margin: 4px 0;
    border: none;
    border-top: 1px solid var(--border);
  }
</style>
