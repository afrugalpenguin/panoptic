<script lang="ts">
  // The environment picker (docs/explorer-ux.md, "Grouping"): None, the environments, New environment...
  // New environment... creates the environment in place and selects it; the environment dialog never opens.
  import { tick } from "svelte";
  import type { Api, AppConfig, EnvironmentConfig } from "./api";
  import { NEW_ENV, newEnvironment, pickerOptions } from "./env-picker";

  let {
    api,
    environments,
    value = $bindable(),
    id,
    none = true,
    exclude,
    onCreated,
  }: {
    api: Api;
    environments: EnvironmentConfig[];
    /** NO_ENV, an environment id, or NEW_ENV while naming one. */
    value: string;
    id: string;
    none?: boolean;
    exclude?: string;
    /** A new environment was saved: the caller takes the new config, so the picker lists it. */
    onCreated: (config: AppConfig) => void | Promise<void>;
  } = $props();

  const options = $derived(pickerOptions(environments, { none, exclude }));
  let name = $state("");
  let error = $state("");
  let busy = $state(false);

  async function create() {
    const result = newEnvironment(name, environments);
    if ("error" in result) {
      error = result.error;
      return;
    }
    error = "";
    if (result.created) {
      busy = true;
      try {
        await onCreated(await api.saveEnvironment(result.environment));
      } catch (e) {
        error = String(e instanceof Error ? e.message : e);
        return;
      } finally {
        busy = false;
      }
    }
    // Let the new environment's option render before selecting it.
    await tick();
    value = result.environment.id;
    name = "";
  }
</script>

<div class="picker">
  <select {id} bind:value>
    {#each options as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
  </select>
  {#if value === NEW_ENV}
    <input
      bind:value={name}
      aria-label="New environment name"
      placeholder="Name"
      onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), create())}
    />
    <button type="button" disabled={busy} onclick={create}>Create</button>
  {/if}
</div>
{#if error}<p class="error">{error}</p>{/if}

<style>
  .picker {
    display: flex;
    gap: 6px;
    min-width: 0;
  }
  .picker select {
    flex: 1;
    min-width: 0;
  }
  .picker input {
    flex: 1;
    min-width: 0;
  }
  .error {
    grid-column: 2;
    margin: 0;
    color: var(--bad);
    font-size: 12px;
  }
</style>
