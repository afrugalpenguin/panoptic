<script lang="ts">
  import { onMount, type Snippet } from "svelte";

  let {
    title,
    onClose,
    children,
    footer,
    wide = false,
    closeOnBackdrop = false,
  }: {
    title: string;
    onClose: () => void;
    children: Snippet;
    footer: Snippet;
    wide?: boolean;
    /** Off by default: a click outside a form dialog would lose what was typed. */
    closeOnBackdrop?: boolean;
  } = $props();

  let dialog: HTMLDialogElement;

  onMount(() => {
    dialog.showModal();
    dialog.querySelector<HTMLElement>("input, select")?.focus();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (Esc is the keyboard path) -->
<dialog
  bind:this={dialog}
  class:wide
  oncancel={(e) => (e.preventDefault(), onClose())}
  onclick={(e) => closeOnBackdrop && e.target === dialog && onClose()}
>
  <form method="dialog" onsubmit={(e) => e.preventDefault()}>
    <h2>{title}</h2>
    <div class="body">{@render children()}</div>
    <footer>{@render footer()}</footer>
  </form>
</dialog>

<style>
  dialog {
    width: min(520px, calc(100vw - 32px));
    padding: 0;
    color: var(--text);
    background: var(--bg-pane);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 12px 48px rgb(0 0 0 / 0.35);
    user-select: none;
  }
  dialog.wide {
    width: min(760px, calc(100vw - 32px));
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
  h2 {
    margin: 0;
    padding: 14px 18px 0;
    font-size: 15px;
    font-weight: 600;
  }
  .body {
    display: grid;
    grid-template-columns: 130px 1fr;
    align-items: center;
    gap: 10px 12px;
    padding: 16px 18px;
  }
  footer {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid var(--border);
  }
  .body :global(label) {
    color: var(--text-muted);
  }
  .body :global(.full) {
    grid-column: 1 / -1;
  }
</style>
