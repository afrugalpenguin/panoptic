<script lang="ts">
  import type { EnvironmentConfig } from "./api";
  import Dialog from "./Dialog.svelte";

  const COLORS = ["#2f9e44", "#1971c2", "#f08c00", "#e03131", "#7048e8", "#0c8599", "#868e96"];

  let {
    initial,
    onSave,
    onClose,
  }: {
    initial?: EnvironmentConfig;
    onSave: (env: EnvironmentConfig) => Promise<void>;
    onClose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let name = $state(initial?.name ?? "");
  // svelte-ignore state_referenced_locally
  let color = $state(initial?.color ?? COLORS[0]);
  // svelte-ignore state_referenced_locally
  let readOnly = $state(initial?.readOnly ?? false);
  let error = $state("");
  let saving = $state(false);

  async function save() {
    if (!name.trim()) {
      error = "Name is required";
      return;
    }
    saving = true;
    try {
      await onSave({ id: initial?.id ?? crypto.randomUUID(), name: name.trim(), color, readOnly, connections: initial?.connections ?? [] });
      onClose();
    } catch (e) {
      error = String(e instanceof Error ? e.message : e);
    } finally {
      saving = false;
    }
  }
</script>

<Dialog title={initial ? "Edit environment" : "New environment"} {onClose}>
  <label for="env-name">Name</label>
  <input id="env-name" bind:value={name} placeholder="dev, UAT, prod, client sandbox" onkeydown={(e) => e.key === "Enter" && save()} />

  <span class="muted">Colour</span>
  <div class="swatches" role="radiogroup" aria-label="Colour">
    {#each COLORS as c}
      <button
        type="button"
        class="swatch"
        class:chosen={c === color}
        style:background={c}
        role="radio"
        aria-checked={c === color}
        aria-label={c}
        onclick={() => (color = c)}
      ></button>
    {/each}
  </div>

  <span></span>
  <label class="check"><input type="checkbox" bind:checked={readOnly} /> Read-only (disables every write action beneath it)</label>

  {#if error}<p class="full error">{error}</p>{/if}

  {#snippet footer()}
    <span style:flex="1"></span>
    <button type="button" onclick={onClose}>Cancel</button>
    <button type="button" class="primary" disabled={saving} onclick={save}>Save</button>
  {/snippet}
</Dialog>

<style>
  .swatches {
    display: flex;
    gap: 6px;
  }
  .swatch {
    width: 22px;
    height: 22px;
    padding: 0;
    border-radius: 50%;
    border: 2px solid transparent;
  }
  .swatch.chosen {
    border-color: var(--text);
  }
  .check {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--text) !important;
  }
  .error {
    margin: 0;
    color: var(--bad);
  }
</style>
