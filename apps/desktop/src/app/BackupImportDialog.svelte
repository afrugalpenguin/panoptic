<script lang="ts">
  // Import from a connections backup (#28, ADR 0008): what the file holds, what is already here, and the connections
  // to bring in. The sidecar read the file and does the import; passwords and keys were never in it.
  import type { Api } from "./api";
  import type { BackupImportResult, BackupPreview } from "../sidecar-types.generated";
  import Dialog from "./Dialog.svelte";

  let {
    api,
    path,
    preview,
    onImported,
    onClose,
  }: {
    api: Api;
    path: string;
    preview: BackupPreview;
    onImported: (result: BackupImportResult) => void;
    onClose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let chosen = $state<Record<number, boolean>>(Object.fromEntries(preview.connections.filter((c) => !c.skip).map((c) => [c.index, true])));
  let importing = $state(false);
  let error = $state("");

  const count = $derived(preview.connections.filter((c) => !c.skip && chosen[c.index]).length);
  const fileName = $derived(path.split(/[\\/]/).pop());

  async function run() {
    importing = true;
    error = "";
    try {
      const indexes = preview.connections.filter((c) => !c.skip && chosen[c.index]).map((c) => c.index);
      onImported(await api.importBackup(path, indexes));
      onClose();
    } catch (e) {
      error = String(e instanceof Error ? e.message : e);
    } finally {
      importing = false;
    }
  }
</script>

<Dialog title="Import from a backup" wide {onClose}>
  <p class="full muted">
    From {fileName}. Passwords and keys are not in backups: enter them when you first connect.
  </p>

  {#if preview.environments.length}
    <h3 class="full">Environments</h3>
    <ul class="full envs">
      {#each preview.environments as env}
        <li>
          <span class="swatch" style:background={env.color}></span>
          {env.name}{#if env.readOnly} <span class="muted">(read-only)</span>{/if}
          <span class="muted">{env.exists ? "already here: its connections join it" : "new"}</span>
        </li>
      {/each}
    </ul>
  {/if}

  <h3 class="full">Connections</h3>
  <ul class="full connections">
    {#each preview.connections as c (c.index)}
      <li class:skipped={!!c.skip}>
        <label>
          <input type="checkbox" disabled={!!c.skip} checked={!c.skip && !!chosen[c.index]} onchange={(e) => (chosen[c.index] = e.currentTarget.checked)} />
          <span class="name">{c.name}</span>
          <span class="muted mono">{c.endpoint}</span>
          <span class="muted">{c.environment ?? "no environment"}</span>
        </label>
        {#if c.skip}<span class="why muted">{c.skip}</span>{/if}
      </li>
    {:else}
      <li class="muted">The file has no connections.</li>
    {/each}
  </ul>

  {#if error}<p class="full error">{error}</p>{/if}

  {#snippet footer()}
    <span style:flex="1"></span>
    <button type="button" onclick={onClose}>Cancel</button>
    <button type="button" class="primary" disabled={importing || count === 0} onclick={run}>Import {count}</button>
  {/snippet}
</Dialog>

<style>
  h3 {
    margin: var(--space-4) 0 0;
    font-size: var(--fs-md);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .envs li {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-1) 0;
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 3px;
  }
  .connections {
    max-height: 280px;
    overflow: auto;
  }
  .connections li {
    padding: var(--space-2) 0;
    border-bottom: 1px solid var(--border);
  }
  .connections label {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .skipped .name {
    color: var(--text-muted);
  }
  .why {
    display: block;
    padding-left: 22px;
    font-size: var(--fs-xs);
  }
  .mono {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }
  .error {
    margin: 0;
    color: var(--bad);
  }
</style>
