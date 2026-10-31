<script lang="ts">
  // Move to environment... on a connection's menu (docs/explorer-ux.md, "Grouping"). Remove from environment is its
  // own menu item, so None is not offered here, nor the environment the connection is already in.
  import type { Api, AppConfig, ConnectionConfig, EnvironmentConfig } from "./api";
  import Dialog from "./Dialog.svelte";
  import { NEW_ENV, pickerOptions } from "./env-picker";
  import EnvPicker from "./EnvPicker.svelte";

  let {
    api,
    environments,
    connection,
    from,
    onMove,
    onEnvironmentCreated,
    onClose,
  }: {
    api: Api;
    environments: EnvironmentConfig[];
    connection: ConnectionConfig;
    /** The environment it is in now, if any. */
    from?: string;
    onMove: (environmentId: string) => void | Promise<void>;
    onEnvironmentCreated: (config: AppConfig) => void | Promise<void>;
    onClose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let value = $state(pickerOptions(environments, { none: false, exclude: from })[0].value);
  let busy = $state(false);

  async function move() {
    if (value === NEW_ENV) return;
    busy = true;
    try {
      await onMove(value);
      onClose();
    } finally {
      busy = false;
    }
  }
</script>

<Dialog title="Move {connection.name}" {onClose}>
  <label for="m-env">Environment</label>
  <EnvPicker {api} {environments} bind:value id="m-env" none={false} exclude={from} onCreated={onEnvironmentCreated} />

  {#snippet footer()}
    <span style:flex="1"></span>
    <button type="button" onclick={onClose}>Cancel</button>
    <button type="button" class="primary" disabled={busy || value === NEW_ENV} onclick={move}>Move</button>
  {/snippet}
</Dialog>
