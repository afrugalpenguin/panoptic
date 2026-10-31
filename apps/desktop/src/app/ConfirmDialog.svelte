<script lang="ts">
  // Asks before a destructive action (docs/explorer-ux.md, "Destructive actions"). Tauri's webview has no
  // window.confirm, so this is the only way to ask. Cancel is the default: Enter, Esc and a backdrop click all cancel.
  import { onMount } from "svelte";
  import type { ConfirmText } from "./confirm";
  import Dialog from "./Dialog.svelte";

  let { text, onResult }: { text: ConfirmText; onResult: (confirmed: boolean) => void } = $props();

  let cancel: HTMLButtonElement;
  onMount(() => cancel.focus());
</script>

<Dialog title={text.title} onClose={() => onResult(false)} closeOnBackdrop>
  <p class="full">{text.body}</p>

  {#snippet footer()}
    <span style:flex="1"></span>
    <button type="button" bind:this={cancel} onclick={() => onResult(false)}>Cancel</button>
    <button type="button" class="danger" onclick={() => onResult(true)}>{text.action}</button>
  {/snippet}
</Dialog>

<style>
  p {
    margin: 0;
  }
</style>
