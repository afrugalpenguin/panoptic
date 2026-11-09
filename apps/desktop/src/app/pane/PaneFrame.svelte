<script lang="ts">
  // The detail panes' frame (docs/environment-pane.md, "Layout"; docs/connection-pane.md): the 3px colour rule, the
  // scrolling header and two-column body, and the 30px footer with the measured list time.
  import type { Snippet } from "svelte";

  let {
    color,
    name,
    label,
    timing,
    onkeydown,
    header,
    main,
    rail,
  }: {
    /** The environment colour, set once as --env; none (a loose connection) has no rule. */
    color?: string;
    /** The root's class, e.g. "env-pane". */
    name: string;
    /** The section's accessible name. */
    label: string;
    /** The footer's "<core>: n items in x ms". */
    timing: string;
    onkeydown?: (e: KeyboardEvent) => void;
    header: Snippet;
    main: Snippet;
    rail: Snippet;
  } = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="pane {name}" style:--env={color} aria-label={label} {onkeydown}>
  {#if color}<div class="rule"></div>{/if}
  <div class="scroll">
    {@render header()}
    <div class="body">
      {@render main()}
      <div class="rail">{@render rail()}</div>
    </div>
  </div>

  <footer>
    <span class="ready"><span class="ok-dot"></span>Ready</span>
    <span class="mono">{timing}</span>
    <span class="saves">Changes save as you make them</span>
  </footer>
</section>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
  }
  .rule {
    flex: none;
    height: 3px;
    background: linear-gradient(90deg, var(--env) 0 40%, transparent 100%);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
    padding: 22px 28px;
  }
  .body {
    flex: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 320px;
    gap: 24px;
    margin-top: 24px;
    min-height: 0;
  }
  /* The left column is top-aligned; the rail stretches so its last block can pin to the bottom. */
  .body > :global(:first-child) {
    align-self: start;
  }
  .rail {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-height: 0;
  }
  .mono {
    font-family: var(--font-mono);
  }
  footer {
    flex: none;
    display: flex;
    align-items: center;
    gap: 14px;
    height: 30px;
    padding: 0 28px;
    border-top: 1px solid var(--border);
    font-size: 11.5px;
    color: var(--tree-dim);
  }
  .ready {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .ok-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
  }
  .saves {
    margin-left: auto;
  }
</style>
