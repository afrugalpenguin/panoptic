<script lang="ts">
  // Ctrl+P while query tabs are open (docs/landing.md, "App shortcuts"): the landing's Seek box in a modal over the
  // workspace. Same index, rows and keys as on the landing; Enter or Ctrl+Enter acts and closes, Esc (with nothing
  // typed) or a click outside closes and hands focus back to where it was.
  import { onMount } from "svelte";
  import SeekBox from "./SeekBox.svelte";
  import type { SeekIndex, SeekRow } from "./seek";

  let {
    index,
    onOpen,
    onQuery,
    onClose,
  }: {
    index: SeekIndex;
    onOpen: (row: SeekRow) => void;
    onQuery: (row: SeekRow) => void;
    /** dismissed: closed without acting, and focus is back where it was. Otherwise the action decides focus. */
    onClose: (dismissed: boolean) => void;
  } = $props();

  let dialog: HTMLDialogElement;
  // Not reactive: only read when the overlay is dismissed.
  const previous = document.activeElement as HTMLElement | null;

  onMount(() => dialog.showModal());

  function dismiss() {
    // Close first: nothing outside an open modal can take focus.
    dialog.close();
    previous?.focus?.();
    onClose(true);
  }

  function act(run: (row: SeekRow) => void, row: SeekRow) {
    dialog.close();
    onClose(false);
    run(row);
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (Esc is the keyboard path) -->
<dialog
  bind:this={dialog}
  class="seek-overlay"
  aria-label="Seek"
  oncancel={(e) => (e.preventDefault(), dismiss())}
  onclick={(e) => e.target === dialog && dismiss()}
>
  <SeekBox
    {index}
    chip="Esc"
    autofocus
    placeholder="Seek anything, anywhere"
    label="Seek environments, connections and objects"
    onOpen={(row) => act(onOpen, row)}
    onQuery={(row) => act(onQuery, row)}
    onLeave={dismiss}
  />
</dialog>

<style>
  dialog {
    width: min(640px, calc(100vw - 32px));
    max-height: calc(100vh - 160px);
    margin: 96px auto auto;
    padding: 12px;
    overflow-y: auto;
    color: var(--text);
    background: var(--bg-pane);
    border: 1px solid var(--border);
    border-radius: 16px;
    box-shadow: 0 12px 48px rgb(0 0 0 / 0.35);
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
</style>
