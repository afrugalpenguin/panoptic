<script lang="ts">
  // A detail pane card: hairline border, card background, a 12px header row with its uppercase label.
  import type { Snippet } from "svelte";

  let {
    label,
    name = "",
    overflow = false,
    onkeydown,
    head,
    children,
  }: {
    /** The header label, also the card's accessible name. */
    label: string;
    /** Extra classes on the card. */
    name?: string;
    /** Lets popovers inside overflow the card (Properties). */
    overflow?: boolean;
    onkeydown?: (e: KeyboardEvent) => void;
    /** More of the header row after the label. */
    head?: Snippet;
    children: Snippet;
  } = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="card {name}" class:overflow aria-label={label} {onkeydown}>
  <div class="card-head"><span class="label">{label}</span>{@render head?.()}</div>
  {@render children()}
</section>

<style>
  .card {
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-pane);
    overflow: hidden;
  }
  .card.overflow {
    overflow: visible;
  }
  .card-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
  }
  .label {
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
</style>
